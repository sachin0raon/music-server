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
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from .access import get_visible_track, resolve_file
from .auth import current_user
from .config import settings
from .db import get_db
from .models import User, Video
from .security import sign_payload, verify_payload

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


MEDIA_TYPES = {
    ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
}
ATTACHMENT = {"Cache-Control": "private, no-store"}


def serve_track(db: DbSession, user: User, track_id: int) -> FileResponse:
    """One track as an attachment, for whoever may already stream it."""
    track = get_visible_track(db, user, track_id)
    path = resolve_file(track.file_path)
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        filename=download_name(track.title, track.artist, path.suffix.lower(), track.original_name),
        headers=ATTACHMENT,
    )


def serve_folder(token: str) -> FileResponse:
    from .library import _path_for, folder_tags

    path = _path_for(token)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    title, artist = folder_tags(token)
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        filename=download_name(title, artist, path.suffix.lower(), path.name),
        headers=ATTACHMENT,
    )


def serve_video(db: DbSession, user: User, video_id: int) -> FileResponse:
    video = db.get(Video, video_id)
    # 404 rather than 403: a wrong id and someone else's should be
    # indistinguishable, or the answer says what exists.
    if video is None or video.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    path = resolve_file(video.file_path)
    name = download_name(video.title, video.uploader, f".{video.container or 'mp4'}", video.original_name)
    return FileResponse(path, media_type="application/octet-stream", filename=name, headers=ATTACHMENT)


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
        from .library import _path_for, folder_tags

        for token in dict.fromkeys(folders):
            path = _path_for(token)
            if path is None or not path.is_file():
                skipped.append("a folder file (no longer available)")
                continue
            # Named from its tags like everything else, so the same file does
            # not come out differently depending on whether it arrived alone or
            # in an archive. Untagged files fall back to the name on disk.
            title, artist = folder_tags(token)
            entries.append((path, _unique(download_name(title, artist, path.suffix.lower(),
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

    return _zip_response(track, folder, user, db)


def _zip_response(tracks: list[int], folders: list[str], user: User, db: DbSession) -> StreamingResponse:
    entries, skipped = _collect(tracks, folders, user, db)
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


# ---------- copied links ----------
#
# These carry their own authorisation, which is the point and the cost: anyone
# holding one can fetch that file without an account, because a download
# manager on another machine has no session to present.
#
# Two things keep the blast radius down. The link expires, and redeeming it
# re-runs the same visibility check against the user who made it -- so a track
# that stops being shared, or an account that is deleted, takes its links with
# it rather than leaving them working.

class LinkBody(BaseModel):
    kind: str = Field(pattern="^(track|folder|video|zip)$")
    id: int | None = None
    token: str | None = Field(default=None, max_length=512)
    tracks: list[int] = Field(default_factory=list)
    folders: list[str] = Field(default_factory=list)


@router.post("/link")
def create_link(body: LinkBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """A link to something the caller can already download.

    Checked now as well as at redemption: issuing a link for a track you cannot
    see should fail where you can see it fail, not silently produce a URL that
    404s for whoever you send it to.
    """
    payload: dict = {"k": body.kind, "u": user.id}
    if body.kind == "track":
        if body.id is None:
            raise HTTPException(status_code=400, detail="Missing track")
        get_visible_track(db, user, body.id)
        payload["id"] = body.id
    elif body.kind == "video":
        if body.id is None:
            raise HTTPException(status_code=400, detail="Missing video")
        serve_video(db, user, body.id)  # raises 404 unless it is theirs
        payload["id"] = body.id
    elif body.kind == "folder":
        if not body.token:
            raise HTTPException(status_code=400, detail="Missing file")
        serve_folder(body.token)
        payload["t"] = body.token
    else:
        if not body.tracks and not body.folders:
            raise HTTPException(status_code=400, detail="Nothing selected")
        if len(body.tracks) + len(body.folders) > MAX_ITEMS:
            raise HTTPException(status_code=400, detail="Too many items in one download")
        payload["ts"] = body.tracks
        payload["fs"] = body.folders

    token, expires = sign_payload(payload, settings.download_link_days * 24 * 3600)
    return {"token": token, "expires_at": expires, "days": settings.download_link_days}


@router.get("/open")
def open_link(token: str = Query(max_length=8192), db: DbSession = Depends(get_db)):
    """Redeem a copied link. Deliberately the one route with no session.

    Everything is re-resolved as the user who created the link, so the link
    grants what they could reach at this moment -- not what they could reach
    when they copied it.
    """
    data = verify_payload(token)
    if data is None:
        # One answer for forged, damaged and expired alike: distinguishing them
        # tells whoever is probing which part to keep trying.
        raise HTTPException(status_code=404, detail="This link is no longer valid")

    issuer = db.get(User, data.get("u"))
    if issuer is None:
        raise HTTPException(status_code=404, detail="This link is no longer valid")

    kind = data.get("k")
    if kind == "track":
        return serve_track(db, issuer, data["id"])
    if kind == "video":
        return serve_video(db, issuer, data["id"])
    if kind == "folder":
        return serve_folder(data["t"])
    if kind == "zip":
        return _zip_response(data.get("ts") or [], data.get("fs") or [], issuer, db)
    raise HTTPException(status_code=404, detail="This link is no longer valid")
