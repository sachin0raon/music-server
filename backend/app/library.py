"""Browse and preview a mounted music folder (MUSIC_DIR).

Files are read in place: nothing is copied or stored until the user chooses to
import, which then runs the normal upload pipeline. Any signed-in user may
browse; an imported track is private to that user until they share it. The
folder is treated as read-only and a file is only ever served if it really
resolves inside MUSIC_DIR."""
import base64
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .config import settings
from .db import get_db
from .models import Track, User
from .tracks import (
    ALLOWED_EXT,
    IMAGE_TYPES,
    MEDIA_TYPES,
    FileUpload,
    _cover_ext,
    _read_meta,
    walk_files,
)
from .tracks import _process as process_file

router = APIRouter(prefix="/api/library", tags=["library"])

MAX_SELECT = 500  # files a single import request may carry
_MTIME = "_mtime"  # internal sort key, stripped before a row is returned
_index: dict[str, dict] = {}  # relative path -> parsed tags, keyed by path
_index_lock = threading.Lock()


# ---------- the folder ----------

def _source_state() -> dict:
    root = settings.music_dir
    if root is None:
        return {"configured": False, "path": None, "exists": False, "readable": False}
    exists = root.is_dir()
    return {"configured": True, "path": str(root), "exists": exists,
            "readable": exists and os.access(root, os.R_OK)}


def _require_source() -> Path:
    source = _source_state()
    if not source["configured"]:
        raise HTTPException(status_code=400, detail="No music folder is set up. Ask the server owner to set MUSIC_DIR and mount it.")
    if not source["exists"]:
        raise HTTPException(status_code=400, detail=f"The folder is not there: {source['path']}")
    if not source["readable"]:
        raise HTTPException(status_code=400, detail=f"The folder cannot be read: {source['path']}")
    return settings.music_dir


@router.get("/source")
def folder_source(user: User = Depends(current_user)):
    """Where the server looks for music, and whether it is reachable right now."""
    return _source_state()


# ---------- tokens: an opaque name for one file ----------
# The path never leaves the server as a path; the client only ever holds a token,
# and a token is only honoured after it resolves back inside MUSIC_DIR.

def _token(rel: str) -> str:
    return base64.urlsafe_b64encode(rel.encode("utf-8")).decode("ascii").rstrip("=")


def _path_for(token: str) -> Path | None:
    root = settings.music_dir
    if root is None:
        return None
    try:
        rel = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode("utf-8")
    except Exception:
        return None
    if not rel or rel.startswith("/") or "\x00" in rel:
        return None
    try:
        resolved = (root / rel).resolve()
        root_resolved = root.resolve()
    except OSError:
        return None
    if root_resolved not in resolved.parents:  # must be a real file inside the mount
        return None
    if resolved.suffix.lower() not in ALLOWED_EXT or not resolved.is_file():
        return None
    return resolved


# ---------- reading the folder ----------

def _meta_for(rel: str, path: Path, mtime: float, size: int) -> dict:
    """Tags for one file, cached by path and refreshed when the file changes."""
    with _index_lock:
        hit = _index.get(rel)
        if hit and hit["mtime"] == mtime and hit["size"] == size:
            return hit["meta"]
    try:
        meta = _read_meta(path, Path(rel).stem[:255])
    except ValueError:  # unreadable tags still list and still play
        meta = {"title": Path(rel).stem[:255], "artist": "Unknown Artist", "album": None,
                "duration": None, "cover": None}
    entry = {
        "title": meta["title"], "artist": meta["artist"], "album": meta["album"],
        "duration": meta["duration"], "has_cover": bool(meta.get("cover")),
        "bitrate": meta.get("bitrate"), "sample_rate": meta.get("sample_rate"),
        "channels": meta.get("channels"), "format": meta.get("format"),
        "year": meta.get("year"), "genre": meta.get("genre"),
        "track_number": meta.get("track_number"), "disc_number": meta.get("disc_number"),
        "composer": meta.get("composer"),
    }
    with _index_lock:
        _index[rel] = {"mtime": mtime, "size": size, "meta": entry}
    return entry


def _index_folder(root: Path) -> list[dict]:
    """Every audio file under root, with its cached tags. Deleted files are dropped."""
    root_resolved = root.resolve()
    entries, seen = [], set()
    for path in walk_files(root):
        if path.suffix.lower() not in ALLOWED_EXT:
            continue
        try:
            resolved = path.resolve()
            stat = resolved.stat()
        except OSError:
            continue
        if root_resolved not in resolved.parents:  # a symlink pointing outside the mount
            continue
        rel = str(resolved.relative_to(root_resolved))
        seen.add(rel)
        entries.append({"rel": rel, "name": path.name, "size": stat.st_size,
                        "mtime": stat.st_mtime, "meta": _meta_for(rel, resolved, stat.st_mtime, stat.st_size)})
    with _index_lock:
        for rel in [r for r in _index if r not in seen]:
            _index.pop(rel, None)
    return entries


def _norm(value: str | None) -> str:
    return " ".join((value or "").lower().split())


def _library_keys(db: DbSession, user_id: int) -> tuple[set, set]:
    """Two cheap fingerprints of what this user already owns: one from tags, one
    from the file the track was imported from. A folder file counts as already
    owned if it matches either."""
    tag_keys, name_keys = set(), set()
    rows = db.execute(
        select(Track.title, Track.artist, Track.duration, Track.original_name, Track.file_size)
        .where(Track.owner_id == user_id)
    ).all()
    for title, artist, duration, original_name, file_size in rows:
        if duration:
            tag_keys.add((_norm(title), _norm(artist), round(float(duration))))
        if original_name:
            name_keys.add((original_name.strip().lower(), file_size))
    return tag_keys, name_keys


def _rows(user_id: int, db: DbSession) -> list[dict]:
    root = _require_source()
    tag_keys, name_keys = _library_keys(db, user_id)
    out = []
    for entry in _index_folder(root):
        meta = entry["meta"]
        in_library = False
        if meta["duration"]:  # tags first: robust to renamed files
            in_library = (_norm(meta["title"]), _norm(meta["artist"]), round(float(meta["duration"]))) in tag_keys
        if not in_library:  # fall back to the file it came from
            in_library = (entry["name"].lower(), entry["size"]) in name_keys
        token = _token(entry["rel"])
        out.append({
            "id": token, "title": meta["title"], "artist": meta["artist"], "album": meta["album"],
            "duration": meta["duration"], "has_cover": meta["has_cover"], "source": "folder",
            "in_library": in_library, "created_at": datetime.fromtimestamp(entry["mtime"], timezone.utc),
            "stream_url": f"/api/library/file/{token}/stream",
            "cover_url": f"/api/library/file/{token}/cover" if meta["has_cover"] else None,
            "bitrate": meta.get("bitrate"), "sample_rate": meta.get("sample_rate"),
            "channels": meta.get("channels"), "format": meta.get("format"),
            "year": meta.get("year"), "genre": meta.get("genre"),
            "track_number": meta.get("track_number"), "disc_number": meta.get("disc_number"),
            "composer": meta.get("composer"), "file_size": entry["size"],
            _MTIME: entry["mtime"],
        })
    return out


def _sorted(rows: list[dict], sort: str) -> list[dict]:
    if sort == "title_desc":
        rows.sort(key=lambda r: (r["title"].lower(), r[_MTIME]), reverse=True)
    elif sort == "added_asc":
        rows.sort(key=lambda r: r[_MTIME])
    elif sort == "added_desc":
        rows.sort(key=lambda r: r[_MTIME], reverse=True)
    else:  # title_asc
        rows.sort(key=lambda r: (r["title"].lower(), r[_MTIME]))
    return rows


def _clean(rows: list[dict]) -> list[dict]:
    for row in rows:
        row.pop(_MTIME, None)
    return rows


# ---------- routes ----------

@router.get("/files")
def folder_files(
    sort: str = Query("title_asc", pattern="^(title_asc|title_desc|added_asc|added_desc)$"),
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """One page of the folder, newest state on every call (nothing is cached client-side)."""
    rows = _sorted(_rows(user.id, db), sort)
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows
                if needle in r["title"].lower()
                or needle in (r["artist"] or "").lower()
                or needle in (r["album"] or "").lower()]
    return {"total": len(rows), "items": _clean(rows[offset:offset + limit])}


@router.get("/scan")
def scan_files(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Every folder file that is not already in this user's library: the list to confirm."""
    rows = _sorted([r for r in _rows(user.id, db) if not r["in_library"]], "title_asc")
    return {"total": len(rows), "items": _clean(rows)}


def _file_details_dict(token: str, path: Path, user: User, db: DbSession, force_reload: bool = False) -> dict:
    try:
        stat = path.stat()
    except OSError:
        raise HTTPException(status_code=404, detail="Not found")
    root = _require_source()
    rel = str(path.relative_to(root.resolve()))
    if force_reload:
        with _index_lock:
            _index.pop(rel, None)
    meta = _meta_for(rel, path, stat.st_mtime, stat.st_size)
    tag_keys, name_keys = _library_keys(db, user.id)
    in_library = False
    if meta["duration"]:
        in_library = (_norm(meta["title"]), _norm(meta["artist"]), round(float(meta["duration"]))) in tag_keys
    if not in_library:
        in_library = (path.name.lower(), stat.st_size) in name_keys
    return {
        "id": token, "title": meta["title"], "artist": meta["artist"], "album": meta["album"],
        "duration": meta["duration"], "has_cover": meta["has_cover"], "source": "folder",
        "in_library": in_library, "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc),
        "stream_url": f"/api/library/file/{token}/stream",
        "cover_url": f"/api/library/file/{token}/cover" if meta["has_cover"] else None,
        "bitrate": meta.get("bitrate"), "sample_rate": meta.get("sample_rate"),
        "channels": meta.get("channels"), "format": meta.get("format"),
        "year": meta.get("year"), "genre": meta.get("genre"),
        "track_number": meta.get("track_number"), "disc_number": meta.get("disc_number"),
        "composer": meta.get("composer"), "file_size": stat.st_size,
    }


@router.get("/file/{token}")
def file_details(token: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Full metadata for a single folder file."""
    path = _path_for(token)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _file_details_dict(token, path, user, db)


@router.post("/file/{token}/refetch")
def refetch_file(token: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Re-reads tags and embedded cover for a single folder file, clearing cached metadata."""
    path = _path_for(token)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _file_details_dict(token, path, user, db, force_reload=True)

@router.get("/file/{token}/stream")
def stream_file(token: str, user: User = Depends(current_user)):
    """Serves a folder file with HTTP range support, so seeking works."""
    path = _path_for(token)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, no-cache"},
    )


@router.get("/file/{token}/cover")
def file_cover(token: str, user: User = Depends(current_user)):
    """The art embedded in a folder file, read on the fly and never stored."""
    path = _path_for(token)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        cover = _read_meta(path, path.stem)["cover"]
    except ValueError:
        cover = None
    if not cover:
        raise HTTPException(status_code=404, detail="Not found")
    ext = _cover_ext(cover)
    return Response(content=cover, media_type=IMAGE_TYPES.get(ext or "", "image/jpeg"),
                    headers={"Cache-Control": "private, no-cache"})


class ImportBody(BaseModel):
    tokens: list[str] = Field(min_length=1, max_length=MAX_SELECT)


@router.post("/import")
def import_files(body: ImportBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Copy the chosen folder files into this user's library, through the normal
    upload pipeline, so dedupe, size limits and per-file results all still apply."""
    limit = settings.max_import_mb * 1024 * 1024
    results = []
    for token in body.tokens:
        path = _path_for(token)
        if path is None:
            results.append({"filename": "unknown", "status": "error", "detail": "File not found", "track": None})
            continue
        try:
            with open(path, "rb") as fh:
                results.append(process_file(FileUpload(path.name, fh), user, db, max_bytes=limit))
        except OSError as exc:  # one unreadable file must not stop the batch
            results.append({"filename": path.name, "status": "error",
                            "detail": exc.strerror or str(exc), "track": None})
    return {"results": results}
