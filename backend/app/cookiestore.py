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


def copy_for_use(user_id: int, work_dir: Path) -> Path | None:
    """A throwaway copy for yt-dlp, or None when nothing is saved.

    yt-dlp rewrites whatever cookie file it is given -- close() calls
    cookiejar.save() -- so handing it the stored path would mutate it on every
    probe and let two jobs race on the same truncate-and-rewrite. It only ever
    sees a copy, which the caller's temporary directory takes away afterwards.
    """
    source = path_for(user_id)
    if not source.is_file():
        return None
    dest = work_dir / COOKIE_FILE
    shutil.copyfile(source, dest)
    return dest
