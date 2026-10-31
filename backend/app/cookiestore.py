"""Per-user cookies.txt, for the sites that refuse anonymous extraction.

Kept apart from the rest of the download code because what it holds is a live
session credential: whoever reads the file can act as that account until the
cookies lapse. Worth being able to read the handling of it on its own.

A page cannot read another origin's cookies -- that is the same-origin policy
doing its main job -- so the file comes from a browser extension export and is
pasted in. Nothing here ever sends it back to the browser.
"""

import os
import shutil
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

COOKIE_FILE = "cookies.txt"
MAX_BYTES = 256 * 1024

# A line starting with this is an entry, not a comment. Auth cookies are
# precisely the ones flagged HttpOnly, so treating every '#' line as a comment
# would reject the files that matter most.
HTTPONLY_PREFIX = "#HttpOnly_"
ENTRY_FIELDS = 7

# The parser refuses a file without one of these outright, so a paste missing it
# is rejected here rather than at download time, where it would surface as "this
# item is private" with nothing pointing back at the cause.
HEADERS = ("# netscape http cookie file", "# http cookie file")

BAD_FORMAT = (
    "That does not look like a cookies.txt file. Export one with a cookies.txt "
    "browser extension and paste the whole file."
)

NO_HEADER = (
    "That paste is missing its first line. Copy the whole export, starting with "
    "\"# Netscape HTTP Cookie File\"."
)


def path_for(user_id: int) -> Path:
    return settings.data_dir / "users" / str(user_id) / COOKIE_FILE


def _is_entry(line: str) -> bool:
    body = line[len(HTTPONLY_PREFIX):] if line.startswith(HTTPONLY_PREFIX) else line
    if body.startswith("#"):
        return False
    return len(body.split("\t")) == ENTRY_FIELDS


def validate(text: str) -> str:
    """Normalised file contents, or ValueError carrying a message for the user.

    Pure, so it can be exercised without a server or a filesystem.
    """
    if text is None or not text.strip():
        raise ValueError("Paste the contents of a cookies.txt file.")
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise ValueError(f"That file is too large (limit {MAX_BYTES // 1024} KB).")

    body = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    lines = [ln for ln in body.split("\n") if ln.strip()]
    if not any(_is_entry(ln) for ln in lines):
        raise ValueError(BAD_FORMAT)
    # Checked rather than supplied: the header is what makes the file a
    # cookies.txt, and a paste without it is a partial copy, which is just as
    # likely to be missing cookies as it is to be missing a line.
    if not lines[0].lower().startswith(HEADERS):
        raise ValueError(NO_HEADER)
    return "\n".join(lines) + "\n"


def save(user_id: int, text: str) -> None:
    content = validate(text)
    target = path_for(user_id)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Opened with the mode rather than chmod'ed afterwards: a credential should
    # never exist, even briefly, with the default permissions.
    fd = os.open(target, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(content)


def status(user_id: int) -> dict:
    """Whether a file exists and when it was written. Never its contents."""
    target = path_for(user_id)
    try:
        saved_at = datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.utc)
    except OSError:
        return {"saved": False, "saved_at": None}
    return {"saved": True, "saved_at": saved_at.isoformat()}


def clear(user_id: int) -> None:
    path_for(user_id).unlink(missing_ok=True)


# One lock per user, held only across the swap itself. Downloads run for
# minutes; locking one out for that long would let a single user's queue block
# a worker that everyone else is waiting on.
_locks_guard = threading.Lock()
_locks: dict[int, threading.Lock] = {}


def _lock_for(user_id: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(user_id, threading.Lock())


def _stamp(path: Path) -> tuple[int, int] | None:
    """Enough to tell whether the file changed under us."""
    try:
        st = path.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


@contextmanager
def lend(user_id: int, work_dir: Path):
    """Hand yt-dlp a private copy, then keep whatever it wrote back.

    yt-dlp rewrites whatever cookie file it is given -- close() calls
    cookiejar.save() -- so it gets a copy rather than the stored path: two jobs
    pointed at one file would race on the same truncate-and-rewrite.

    Keeping the result matters as much as isolating it. Sites rotate session
    cookies as they are used, and the rotated ones come back through that same
    write. Throwing the copy away unread left every request replaying the
    original export, which the site had already retired -- so the cookies worked
    once and then looked like a bot forever after.

    Yields None when nothing is saved, so a stale toggle degrades to an
    anonymous attempt rather than an error.
    """
    source = path_for(user_id)
    before = _stamp(source)
    if before is None:
        yield None
        return
    dest = work_dir / COOKIE_FILE
    shutil.copyfile(source, dest)
    try:
        yield dest
    finally:
        _adopt(user_id, dest, before)


def _adopt(user_id: int, used: Path, before: tuple[int, int]) -> None:
    """Replace the stored file with the one yt-dlp just finished with.

    Deliberately forgiving: this runs even when the operation failed, because
    the rotation happened at the site regardless of whether the download did.
    Anything unreadable or no longer a cookies.txt is dropped instead, so a run
    that ended with an empty jar cannot wipe a working file.
    """
    try:
        content = validate(used.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return
    target = path_for(user_id)
    with _lock_for(user_id):
        # Someone else finished while we were running, so their cookies came
        # from a later rotation than ours. Ours are already dead; leave theirs.
        if _stamp(target) != before:
            return
        tmp = target.with_name(f".{COOKIE_FILE}.{os.getpid()}.{threading.get_ident()}")
        try:
            fd = os.open(tmp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            os.replace(tmp, target)  # atomic: a reader sees one file or the other
        except OSError:
            tmp.unlink(missing_ok=True)
