"""Getting files back out: one at a time, or a selection as one archive.

No new access. Everything reachable here is already served by an existing
stream route to exactly the same people -- this adds a Content-Disposition and
a filename worth keeping. Anything the caller cannot see is skipped rather than
refused, so an id that is not theirs looks identical to one that never existed.

The archive is streamed. Audio does not compress, so entries are stored rather
than deflated, and the zip is written into a small sink that is drained after
every chunk: peak memory is one chunk, not one archive, and nothing touches the
disk we spent a feature protecting.
"""

import re
import zipfile
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DbSession

from .access import get_visible_track, resolve_file
from .auth import current_user
from .db import get_db
from .models import User

router = APIRouter(prefix="/api/downloads", tags=["downloads"])

CHUNK = 256 * 1024
# Not a feature limit -- the design deliberately has none -- just a refusal to
# resolve an absurd query string.
MAX_ITEMS = 500

# Everything a filename must not carry: path separators, the characters Windows
# forbids, and control characters.
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
_SPACES = re.compile(r"\s+")
NAME_LIMIT = 120


def download_name(title: str | None, artist: str | None, ext: str, fallback: str = "track") -> str:
    """"Title - Artist.ext", reduced to something safe to write to a disk.

    Tags are user-editable, and a zip entry name is a path on whoever unpacks
    it. A title of "../../etc/cron.d/x" must not become one, so separators are
    removed rather than escaped and the result can never be ".." or start with
    a dot.
    """
    parts = [p.strip() for p in (title, artist) if p and p.strip()]
    stem = " - ".join(parts) or Path(fallback).stem or "track"
    stem = _SPACES.sub(" ", _UNSAFE.sub("", stem)).strip(" .")
    if not stem or set(stem) <= {"."}:
        stem = "track"
    return f"{stem[:NAME_LIMIT].strip()}{ext}"


def _unique(name: str, taken: set[str]) -> str:
    """Two tracks sharing a title and artist is ordinary, so suffix rather than
    overwrite -- a zip with a duplicate entry name silently loses one."""
    if name not in taken:
        taken.add(name)
        return name
    stem, dot, ext = name.rpartition(".")
    stem, ext = (stem, f".{ext}") if dot else (name, "")
    n = 2
    while f"{stem} ({n}){ext}" in taken:
        n += 1
    out = f"{stem} ({n}){ext}"
    taken.add(out)
    return out


def _collect(tracks: list[int], folders: list[str], user: User, db: DbSession):
    """(entries, skipped). Resolution failures are skipped, never fatal."""
    entries: list[tuple[Path, str]] = []
    skipped: list[str] = []
    taken: set[str] = set()

    for track_id in dict.fromkeys(tracks):  # de-duplicated, order kept
        try:
            track = get_visible_track(db, user, track_id)
            path = resolve_file(track.file_path)
        except HTTPException:
            # Covers gone, never visible, and missing from disk alike. Saying
            # which would answer a question the caller is not entitled to ask.
            skipped.append(f"track {track_id} (no longer available)")
            continue
        ext = Path(track.file_path).suffix.lower()
        entries.append((path, _unique(download_name(track.title, track.artist, ext,
                                                    track.original_name), taken)))

    if folders:
        # Deferred: library imports download_name from this module, so a
        # top-level import here would close the circle.
        from .library import _path_for

        for token in dict.fromkeys(folders):
            path = _path_for(token)
            if path is None or not path.is_file():
                skipped.append("a folder file (no longer available)")
                continue
            entries.append((path, _unique(download_name(None, None, path.suffix.lower(),
                                                        path.name), taken)))

    return entries, skipped


def _readme(skipped: list[str]) -> str:
    return (
        "Some files could not be included in this download:\n\n"
        + "\n".join(f"  - {s}" for s in skipped)
        + "\n\nThey may have been deleted, or stopped being shared, since you "
          "made the selection.\n"
    )


class _Sink:
    """A write-only file for zipfile, drained after every chunk.

    seekable() is False on purpose: zipfile then writes data descriptors after
    each entry instead of seeking back to patch its header, which is what makes
    the archive streamable at all.
    """

    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._pos = 0

    def write(self, data) -> int:
        self._chunks.append(bytes(data))
        self._pos += len(data)
        return len(data)

    def tell(self) -> int:
        return self._pos

    def flush(self) -> None:
        pass

    def seekable(self) -> bool:
        return False

    def drain(self) -> bytes:
        out = b"".join(self._chunks)
        self._chunks.clear()
        return out


def _zip_stream(entries: list[tuple[Path, str]], skipped: list[str]):
    sink = _Sink()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as zf:
        for path, name in entries:
            # The source is opened first: if it fails there is no half-created
            # entry in the archive to explain.
            with path.open("rb") as src, zf.open(name, "w") as dest:
                while True:
                    chunk = src.read(CHUNK)
                    if not chunk:
                        break
                    dest.write(chunk)
                    if data := sink.drain():
                        yield data
            if data := sink.drain():
                yield data
        # Last, because what was skipped is only known once everything else has
        # been attempted.
        if skipped:
            zf.writestr("README.txt", _readme(skipped))
    yield sink.drain()  # central directory


@router.get("/zip")
async def download_zip(
    track: list[int] = Query(default=[]),
    folder: list[str] = Query(default=[]),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """A selection as one archive.

    GET rather than POST so <a href download> reaches it: the browser then owns
    the transfer, and the page never holds the archive in memory.
    """
    if not track and not folder:
        raise HTTPException(status_code=400, detail="Nothing selected to download")
    if len(track) + len(folder) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail="Too many items in one download")

    entries, skipped = _collect(track, folder, user, db)
    if not entries and not skipped:
        raise HTTPException(status_code=404, detail="Nothing to download")

    # A sync generator: Starlette iterates it in the threadpool, so a long
    # transfer holds neither the event loop nor one worker for its duration.
    return StreamingResponse(
        _zip_stream(entries, skipped),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="music-{date.today().isoformat()}.zip"',
            "Cache-Control": "private, no-store",
        },
    )
