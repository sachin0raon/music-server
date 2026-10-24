import base64
import hashlib
import http.client
import ipaddress
import logging
import os
import re
import secrets
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import mutagen
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from mutagen.flac import Picture
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from .access import get_visible_track, resolve_file, visible_filter
from .auth import current_user
from .config import settings
from .db import get_db
from .itunes import (
    embed_cover_in_file,
    enqueue_cover_fetch,
    invalidate_negative_cache,
    search_itunes_cover,
)
from .models import PlaylistTrack, Track, User
from .ratelimit import RateLimiter
log = logging.getLogger("tracks")
router = APIRouter(prefix="/api/tracks", tags=["tracks"])

ALLOWED_EXT = {".mp3", ".flac", ".m4a", ".ogg", ".opus", ".wav"}
CHUNK = 1024 * 1024
MAX_COVER_BYTES = 8 * 1024 * 1024


def track_out(t: Track, me_id: int | None = None, owner: str | None = None, detail: bool = False) -> dict:
    # Never includes file_path or cover_path
    out = {
        "id": t.id, "title": t.title, "artist": t.artist, "album": t.album,
        "duration": t.duration, "has_cover": bool(t.cover_path),
        "is_shared": t.is_shared, "original_name": t.original_name, "created_at": t.created_at,
    }
    if me_id is not None:
        out["owned"] = t.owner_id == me_id
        out["owner"] = owner
    if detail:  # only the single-track endpoint, so list rows stay light
        out.update({
            "bitrate": t.bitrate, "sample_rate": t.sample_rate, "channels": t.channels,
            "format": t.format, "year": t.year, "genre": t.genre,
            "track_number": t.track_number, "disc_number": t.disc_number, "composer": t.composer,
            "file_size": t.file_size,
        })
    return out


# ---------- helpers ----------

class FileUpload:
    """Looks like an uploaded file to the processing pipeline.

    Lets a plain file handle (the folder scan, the CLI) or a network response
    (the link import) go through the exact same pipeline as a browser upload."""
    def __init__(self, filename: str, file):
        self.filename = filename
        self.file = file


def walk_files(root: Path):
    """Every non-hidden file under root, in a stable order. Hidden folders and files
    (names starting with a dot) are skipped."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if not name.startswith("."):
                yield Path(dirpath) / name


def _save_temp(upload: UploadFile, dest: Path, limit_bytes: int) -> tuple[int, str]:
    """Copy to a temp file in chunks, hashing and enforcing the size limit."""
    h, size = hashlib.sha256(), 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as out:
        while chunk := upload.file.read(CHUNK):
            size += len(chunk)
            if size > limit_bytes:
                raise ValueError(f"File too large (max {limit_bytes // (1024 * 1024)} MB)")
            h.update(chunk)
            out.write(chunk)
    return size, h.hexdigest()


def _first(tags, key: str) -> str | None:
    try:
        value = tags.get(key)
    except Exception:
        return None
    if not value:
        return None
    text = str(value[0] if isinstance(value, (list, tuple)) else value).strip()
    return text or None


def _extract_cover(audio) -> bytes | None:
    """Best-effort embedded cover art across the supported formats."""
    try:
        pictures = getattr(audio, "pictures", None)  # FLAC
        if pictures:
            return pictures[0].data
        tags = audio.tags
        if tags is None:
            return None
        if hasattr(tags, "getall"):  # MP3 / WAV (ID3)
            apic = tags.getall("APIC")
            if apic:
                return apic[0].data
        covr = tags.get("covr") if hasattr(tags, "get") else None  # M4A
        if covr:
            return bytes(covr[0])
        blocks = tags.get("metadata_block_picture") if hasattr(tags, "get") else None  # OGG / Opus
        if blocks:
            return Picture(base64.b64decode(blocks[0])).data
    except Exception:
        return None
    return None


def _cover_ext(data: bytes) -> str | None:
    if len(data) > MAX_COVER_BYTES:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    return None  # unknown formats are ignored rather than stored


# Friendly codec/container labels; ".ogg" can hide Vorbis or Opus, so it is resolved per file
FORMATS = {
    "mp3": "MP3", "flac": "FLAC", "m4a": "AAC (M4A)", "ogg": "Vorbis (OGG)",
    "opus": "Opus", "wav": "WAV",
}


def _format_label(audio, ext: str) -> str:
    if ext == ".ogg":  # tell Opus-in-OGG apart from Vorbis-in-OGG
        name = type(audio).__name__.lower()
        return "Opus (OGG)" if "opus" in name else "Vorbis (OGG)"
    return FORMATS.get(ext.lstrip("."), ext.lstrip(".").upper() or None)


def _leading_int(value) -> int | None:
    """Tags hold '3' or '3/12'; take the leading number."""
    try:
        return int(str(value).split("/")[0].strip())
    except (ValueError, IndexError, AttributeError):
        return None


def _year(value) -> int | None:
    """Tags hold '2020', '2020-05-01' or '2020-05-01T…'; take the first 4-digit year."""
    text = str(value or "")
    year = text[:4]
    return int(year) if year.isdigit() and 1000 <= int(year) <= 3000 else None


def _read_meta(path: Path, fallback_title: str) -> dict:
    try:
        audio = mutagen.File(path)
        if audio is None or getattr(audio, "info", None) is None:
            raise ValueError("Not a readable audio file")
        easy = mutagen.File(path, easy=True)
    except mutagen.MutagenError:
        raise ValueError("Not a readable audio file")
    tags = easy.tags if easy is not None and easy.tags is not None else {}
    info = audio.info
    return {
        "title": (_first(tags, "title") or fallback_title)[:255],
        "artist": (_first(tags, "artist") or "Unknown Artist")[:255],
        "album": (_first(tags, "album") or None),
        "duration": float(info.length) if getattr(info, "length", None) else None,
        "cover": _extract_cover(audio),
        "bitrate": getattr(info, "bitrate", None) or None,  # WAV reports none
        "sample_rate": getattr(info, "sample_rate", None) or None,
        "channels": getattr(info, "channels", None) or None,
        "format": _format_label(audio, path.suffix.lower()),
        "year": _year(_first(tags, "date")),
        "genre": (_first(tags, "genre") or None)[:64] if _first(tags, "genre") else None,
        "track_number": _leading_int(_first(tags, "tracknumber")),
        "disc_number": _leading_int(_first(tags, "discnumber")),
        "composer": (_first(tags, "composer") or None)[:255] if _first(tags, "composer") else None,
    }


def _result(name: str, status: str, detail: str | None = None, track: Track | None = None) -> dict:
    return {"filename": name, "status": status, "detail": detail, "track": track_out(track) if track else None}


# ---------- one file ----------

def _process(upload: UploadFile, user: User, db: DbSession, max_bytes: int | None = None) -> dict:
    name = (Path(upload.filename or "").name or "unnamed")[:255]
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        return _result(name, "error", "Unsupported file type")

    limit = settings.max_upload_mb * 1024 * 1024 if max_bytes is None else max_bytes
    tmp = settings.data_dir / "tmp" / f"{secrets.token_hex(16)}{ext}"
    final = cover_final = None
    committed = False
    try:
        size, digest = _save_temp(upload, tmp, limit)
        if size == 0:
            return _result(name, "error", "Empty file")
        if db.scalar(select(Track.id).where(Track.owner_id == user.id, Track.content_hash == digest)):
            return _result(name, "duplicate", "You already uploaded this file")

        meta = _read_meta(tmp, Path(name).stem[:255])

        # Server-generated names only; the user's filename is never used on disk
        rel = f"users/{user.id}/{secrets.token_hex(16)}{ext}"
        final = settings.data_dir / rel
        final.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp, final)

        cover_rel = None
        cover_ext = _cover_ext(meta["cover"]) if meta["cover"] else None
        if cover_ext:
            cover_rel = f"users/{user.id}/covers/{secrets.token_hex(16)}{cover_ext}"
            cover_final = settings.data_dir / cover_rel
            cover_final.parent.mkdir(parents=True, exist_ok=True)
            cover_final.write_bytes(meta["cover"])

        track = Track(
            owner_id=user.id, file_path=rel, original_name=name, file_size=size, content_hash=digest,
            title=meta["title"], artist=meta["artist"], album=meta["album"],
            duration=meta["duration"], cover_path=cover_rel,
            bitrate=meta["bitrate"], sample_rate=meta["sample_rate"], channels=meta["channels"],
            format=meta["format"], year=meta["year"], genre=meta["genre"],
            track_number=meta["track_number"], disc_number=meta["disc_number"],
            composer=meta["composer"],
        )
        db.add(track)
        db.commit()
        db.refresh(track)
        committed = True
        return _result(name, "ok", track=track)

    except IntegrityError:  # two identical uploads racing
        db.rollback()
        return _result(name, "duplicate", "You already uploaded this file")
    except ValueError as exc:
        db.rollback()
        return _result(name, "error", str(exc))
    except Exception:
        db.rollback()
        log.exception("Upload failed for %s", name)
        return _result(name, "error", "Could not process this file")
    finally:
        tmp.unlink(missing_ok=True)
        if not committed:  # never leave orphan files behind
            for p in (final, cover_final):
                if p:
                    p.unlink(missing_ok=True)


# ---------- route ----------

@router.post("")
def upload_tracks(
    files: list[UploadFile] = File(...),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Each file gets its own result, so one bad file never fails the batch."""
    return {"results": [_process(f, user, db) for f in files]}


# ---------- import from a link ----------
# The server fetches a URL the user gives us and adds the file to their library.
# The link is validated first so this can't be turned into a way to reach the
# server itself, the local network, or cloud metadata addresses.

FETCH_TIMEOUT = 30      # seconds a single request may take
MAX_REDIRECTS = 3
_url_limiter = RateLimiter(limit=30, window_seconds=3600)  # per user, per hour

# Content-Type -> extension, for links whose URL path carries no usable extension
CONTENT_TYPE_EXT = {
    "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/x-mpeg": ".mp3",
    "audio/flac": ".flac", "audio/x-flac": ".flac",
    "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".m4a", "audio/x-aac": ".m4a",
    "audio/ogg": ".ogg", "application/ogg": ".ogg", "audio/vorbis": ".ogg",
    "audio/opus": ".opus",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
}


class _BlockedLink(ValueError):
    """A link we refuse to follow. The message is safe to show the user."""


def _local_address(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped  # ::ffff:127.0.0.1 and the like
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast
            or addr.is_reserved or addr.is_unspecified)


def _check_host(host: str, port: int) -> None:
    """Refuse hosts that resolve to a private, loopback or otherwise local address."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except OSError:
        raise _BlockedLink("Could not find that host")
    if not infos or any(_local_address(info[4][0]) for info in infos):
        raise _BlockedLink("That address is not allowed")


def _check_link(url: str) -> None:
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise _BlockedLink("Only http and https links are allowed")
    if not parts.hostname:
        raise _BlockedLink("That link is missing a host")
    if parts.username or parts.password:
        raise _BlockedLink("Links that carry a username or password are not allowed")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        raise _BlockedLink("That link is not a valid address")
    _check_host(parts.hostname, port)


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Re-checks every redirect target, so a safe link can't hop to an internal one."""
    max_redirections = MAX_REDIRECTS

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_link(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _cd_filename(header: str | None) -> str | None:
    if not header:
        return None
    m_star = re.search(r"filename\*\s*=\s*utf-8''([^;\r\n]+)", header, re.IGNORECASE)
    if m_star:
        raw = urllib.parse.unquote(m_star.group(1).strip().strip('"\''))
        return Path(raw).name
    m = re.search(r'filename\s*=\s*(?:"([^"]+)"|([^;\s\r\n]+))', header, re.IGNORECASE)
    if m:
        raw = urllib.parse.unquote((m.group(1) or m.group(2)).strip().strip('"\''))
        return Path(raw).name
    return None


def _query_filename(query_str: str) -> str | None:
    query = urllib.parse.parse_qs(query_str)
    for key in ("path", "file", "filename", "name", "song", "track"):
        for val in query.get(key, []):
            unquoted = Path(urllib.parse.unquote(val)).name
            if Path(unquoted).suffix.lower() in ALLOWED_EXT:
                return unquoted
    return None


def _clean_custom_filename(custom: str | None, detected_ext: str | None) -> str | None:
    if not custom or not custom.strip():
        return None
    cleaned = Path(custom.strip()).name
    if not cleaned:
        return None
    if Path(cleaned).suffix.lower() in ALLOWED_EXT:
        return cleaned[:255]
    if detected_ext and detected_ext.lower() in ALLOWED_EXT:
        return (Path(cleaned).stem or "download")[:250] + detected_ext.lower()
    return cleaned[:255]


def _detect_ext(parts, content_type: str, cd_name: str | None = None) -> str | None:
    if cd_name and Path(cd_name).suffix.lower() in ALLOWED_EXT:
        return Path(cd_name).suffix.lower()
    path_suffix = Path(urllib.parse.unquote(parts.path)).suffix.lower()
    if path_suffix in ALLOWED_EXT:
        return path_suffix
    q_name = _query_filename(parts.query)
    if q_name and Path(q_name).suffix.lower() in ALLOWED_EXT:
        return Path(q_name).suffix.lower()
    return CONTENT_TYPE_EXT.get(content_type)


def _link_filename(parts, content_type: str, cd_name: str | None = None, custom_name: str | None = None) -> str | None:
    """A name the pipeline can trust: custom user-given name wins, then Content-Disposition,
    then query parameter, then URL path, with Content-Type supplying the extension if needed."""
    ext = _detect_ext(parts, content_type, cd_name)

    if custom_name and custom_name.strip():
        cleaned = _clean_custom_filename(custom_name, ext)
        if cleaned and Path(cleaned).suffix.lower() in ALLOWED_EXT:
            return cleaned[:255]

    if cd_name:
        if Path(cd_name).suffix.lower() in ALLOWED_EXT:
            return cd_name[:255]
        if ext:
            return (Path(cd_name).stem or "download")[:250] + ext

    q_name = _query_filename(parts.query)
    if q_name:
        return q_name[:255]

    base = Path(urllib.parse.unquote(parts.path)).name or "download"
    if Path(base).suffix.lower() in ALLOWED_EXT:
        return base[:255]
    if ext:
        return (Path(base).stem or "download")[:250] + ext
    return None


def _name_hint(url: str, custom_filename: str | None = None) -> str:
    """A readable label for a result, used even when the link is rejected."""
    if custom_filename and custom_filename.strip():
        return Path(custom_filename.strip()).name[:255]
    parts = urllib.parse.urlsplit(url)
    q_name = _query_filename(parts.query)
    if q_name:
        return q_name[:255]
    base = Path(urllib.parse.unquote(parts.path)).name
    return base[:255] or "link"


def _open_link(url: str, custom_filename: str | None = None):
    """Validate the link and return (filename, open response). Raises ValueError with a
    message that is safe to show the user."""
    _check_link(url)
    req = urllib.request.Request(url.strip(), headers={"User-Agent": "music-server", "Accept": "audio/*;q=0.9,*/*;q=0.5"})
    try:
        resp = urllib.request.build_opener(_SafeRedirect()).open(req, timeout=FETCH_TIMEOUT)
    except urllib.error.HTTPError as exc:
        raise ValueError(f"The server replied with {exc.code} for that link")
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        # URLError covers connection problems; HTTPException covers a URL the HTTP layer rejects
        raise ValueError("Could not reach that link")
    declared = resp.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > settings.max_import_mb * 1024 * 1024:
        resp.close()
        raise ValueError(f"File too large (max {settings.max_import_mb} MB)")
    content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    cd_name = _cd_filename(resp.headers.get("Content-Disposition"))
    parts = urllib.parse.urlsplit(url.strip())
    name = _link_filename(parts, content_type, cd_name=cd_name, custom_name=custom_filename)
    if name is None:
        resp.close()
        raise ValueError("That link does not point to a supported audio file")
    return name, resp


class UrlBody(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    filename: str | None = Field(default=None, max_length=255)


@router.post("/from-url")
def import_from_url(body: UrlBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Add a track by fetching a link the user gives us. Any signed-in user may use it."""
    _url_limiter.check(f"url:{user.id}")
    _url_limiter.hit(f"url:{user.id}")
    try:
        name, resp = _open_link(body.url, custom_filename=body.filename)
    except ValueError as exc:
        return _result(_name_hint(body.url, custom_filename=body.filename), "error", str(exc))
    try:
        return _process(FileUpload(name, resp), user, db, max_bytes=settings.max_import_mb * 1024 * 1024)
    finally:
        resp.close()


# ---------- library ----------

MEDIA_TYPES = {
    ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4",
    ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
}
IMAGE_TYPES = {".jpg": "image/jpeg", ".png": "image/png"}


SORT_ORDER = {
    "added_desc": (Track.created_at.desc(), Track.id.desc()),
    "added_asc": (Track.created_at.asc(), Track.id.asc()),
    "title_asc": (Track.title.asc(), Track.id.asc()),
    "title_desc": (Track.title.desc(), Track.id.desc()),
}


@router.get("")
def list_tracks(
    scope: str = Query("mine", pattern="^(mine|shared|all)$"),
    q: str | None = Query(None, max_length=100),
    sort: str = Query("added_desc", pattern="^(added_desc|added_asc|title_asc|title_desc)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """mine = your own tracks, shared = everything shared (yours included), all = both.
    sort is whitelisted, so only the fixed orders above reach ORDER BY. The id tiebreaker
    keeps paging stable when two tracks share a title or upload time."""
    where = [visible_filter(user)]  # always applied, whatever the scope
    if scope == "mine":
        where.append(Track.owner_id == user.id)
    elif scope == "shared":
        where.append(Track.is_shared.is_(True))
    if q and q.strip():
        like = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append(
            Track.title.ilike(like, escape="\\") | Track.artist.ilike(like, escape="\\") | Track.album.ilike(like, escape="\\")
        )

    total = db.scalar(select(func.count()).select_from(Track).where(*where))
    rows = db.execute(
        select(Track, User.username)
        .join(User, User.id == Track.owner_id)
        .where(*where)
        .order_by(*SORT_ORDER[sort])
        .limit(limit).offset(offset)
    ).all()
    return {"total": total, "items": [track_out(t, user.id, owner) for t, owner in rows]}


@router.get("/{track_id}")
def get_track(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    track = get_visible_track(db, user, track_id)
    owner = db.scalar(select(User.username).where(User.id == track.owner_id))
    return track_out(track, user.id, owner, detail=True)


@router.get("/{track_id}/stream")
def stream_track(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Serves the audio with HTTP range support, so seeking and phone buffering work."""
    track = get_visible_track(db, user, track_id)
    if not track.cover_path:
        enqueue_cover_fetch("track", track.id, track.title, track.album, track.artist, track.file_path, track.owner_id)
    path = resolve_file(track.file_path)
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, no-cache"},
    )


@router.get("/{track_id}/cover")
def track_cover(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    track = get_visible_track(db, user, track_id)
    if not track.cover_path:
        raise HTTPException(status_code=404, detail="Not found")
    path = resolve_file(track.cover_path)
    return FileResponse(
        path,
        media_type=IMAGE_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, no-cache"},
    )

@router.delete("/{track_id}/cover")
def delete_track_cover(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Removes cover art from a library track. Admin only."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    track = get_visible_track(db, user, track_id)
    if track.owner_id != user.id:
        raise HTTPException(status_code=403, detail="You can only change your own tracks")
    # Strip embedded artwork first: if the audio file cannot be rewritten, leave the
    # track (and its served cover) untouched and report the failure.
    from .itunes import strip_cover_from_file
    audio_path = resolve_file(track.file_path)
    try:
        stripped = strip_cover_from_file(audio_path)
    except (OSError, PermissionError) as exc:
        log.warning("Storage is not writable for stripping cover from %s: %s", track.file_path, exc)
        raise HTTPException(status_code=400, detail="Cannot modify file: permission denied")
    except Exception as exc:
        log.warning("Could not read audio file for stripping cover from %s: %s", track.file_path, exc)
        raise HTTPException(status_code=422, detail="Could not read this track's audio file")
    if not stripped:
        raise HTTPException(status_code=422, detail="Could not remove embedded cover art from this file")
    if track.cover_path:
        try:
            resolve_file(track.cover_path).unlink(missing_ok=True)
        except (OSError, HTTPException) as exc:
            log.warning("Could not unlink cover file %s: %s", track.cover_path, exc)
        track.cover_path = None
        db.commit()
        db.refresh(track)
    owner = db.scalar(select(User.username).where(User.id == track.owner_id)) or "unknown"
    return track_out(track, user.id, owner, detail=True)

# ---------- share / unshare / delete (owner only) ----------

class ShareBody(BaseModel):
    shared: bool


def _get_owned(db: DbSession, user: User, track_id: int) -> Track:
    track = get_visible_track(db, user, track_id)  # 404 if you can't even see it
    if track.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only the owner can do that")
    return track


@router.put("/{track_id}/share")
def set_shared(track_id: int, body: ShareBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Sharing is a flag, not a copy, so unsharing takes effect instantly for everyone."""
    track = _get_owned(db, user, track_id)
    if track.is_shared != body.shared:
        track.is_shared = body.shared
        track.shared_at = datetime.now(timezone.utc).replace(tzinfo=None) if body.shared else None
        db.commit()
        db.refresh(track)
    return track_out(track, user.id, user.username)


class TrackEditBody(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    artist: str = Field(default="Unknown Artist", max_length=255)
    album: str | None = Field(default=None, max_length=255)
    composer: str | None = Field(default=None, max_length=255)
    genre: str | None = Field(default=None, max_length=64)
    year: int | None = Field(default=None, ge=1000, le=3000)


def _write_file_tags(path: Path, data: dict) -> None:
    """Write tags directly to the audio file on disk."""
    easy = mutagen.File(path, easy=True)
    if easy is None:
        return
    if easy.tags is None:
        try:
            easy.add_tags()
        except Exception:
            pass

    def set_or_pop(key: str, val):
        if val is not None and str(val).strip():
            easy[key] = str(val).strip()
        else:
            easy.pop(key, None)

    set_or_pop("title", data.get("title"))
    set_or_pop("artist", data.get("artist"))
    set_or_pop("album", data.get("album"))
    set_or_pop("composer", data.get("composer"))
    set_or_pop("genre", data.get("genre"))
    set_or_pop("date", str(data["year"]) if data.get("year") else None)
    easy.save()


@router.patch("/{track_id}")
def update_track(track_id: int, body: TrackEditBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Update title, artist, album, composer, genre, and year for an owned track."""
    track = _get_owned(db, user, track_id)
    track.title = body.title.strip()
    track.artist = body.artist.strip() or "Unknown Artist"
    track.album = body.album.strip() if body.album and body.album.strip() else None
    track.composer = body.composer.strip() if body.composer and body.composer.strip() else None
    track.genre = body.genre.strip() if body.genre and body.genre.strip() else None
    track.year = body.year

    db.commit()
    db.refresh(track)
    invalidate_negative_cache(f"track:{track.id}")

    try:
        path = resolve_file(track.file_path)
        _write_file_tags(path, {
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "composer": track.composer,
            "genre": track.genre,
            "year": track.year,
        })
    except Exception as exc:
        log.warning("Could not write tags to %s: %s", track.file_path, exc)

    return track_out(track, user.id, user.username, detail=True)

@router.post("/{track_id}/refetch")
def refetch_track(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Re-reads tags and embedded cover from the audio file on disk and updates the track."""
    track = _get_owned(db, user, track_id)
    path = resolve_file(track.file_path)
    try:
        stat = path.stat()
        meta = _read_meta(path, Path(track.original_name).stem[:255])
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not read audio file: {exc}")

    new_cover = meta.get("cover")
    if not new_cover:
        itunes_art = search_itunes_cover(meta["title"], meta.get("album"), meta.get("artist"))
        if itunes_art:
            new_cover = itunes_art
            embed_cover_in_file(path, new_cover)
    cover_ext = _cover_ext(new_cover) if new_cover else None
    old_cover = track.cover_path
    cover_to_unlink = None

    if cover_ext:
        cover_rel = f"users/{user.id}/covers/{secrets.token_hex(16)}{cover_ext}"
        cover_final = settings.data_dir / cover_rel
        cover_final.parent.mkdir(parents=True, exist_ok=True)
        cover_final.write_bytes(new_cover)
        track.cover_path = cover_rel
        if old_cover and old_cover != cover_rel:
            cover_to_unlink = old_cover
    elif old_cover and not new_cover:
        track.cover_path = None
        cover_to_unlink = old_cover

    track.title = meta["title"]
    track.artist = meta["artist"]
    track.album = meta["album"]
    track.duration = meta["duration"]
    track.bitrate = meta.get("bitrate")
    track.sample_rate = meta.get("sample_rate")
    track.channels = meta.get("channels")
    track.format = meta.get("format")
    track.year = meta.get("year")
    track.genre = meta.get("genre")
    track.track_number = meta.get("track_number")
    track.disc_number = meta.get("disc_number")
    track.composer = meta.get("composer")

    if stat.st_size != track.file_size:
        try:
            with path.open("rb") as f:
                h = hashlib.sha256()
                while chunk := f.read(CHUNK):
                    h.update(chunk)
                new_digest = h.hexdigest()
            clash = db.scalar(
                select(Track.id).where(
                    Track.owner_id == user.id,
                    Track.content_hash == new_digest,
                    Track.id != track.id
                )
            )
            if not clash:
                track.content_hash = new_digest
        except OSError:
            pass
    track.file_size = stat.st_size

    db.commit()
    db.refresh(track)

    if cover_to_unlink:
        root = settings.data_dir.resolve()
        try:
            p = (root / cover_to_unlink).resolve()
            if root in p.parents:
                p.unlink(missing_ok=True)
        except OSError:
            log.exception("Could not remove old cover %s", cover_to_unlink)

    return track_out(track, user.id, user.username, detail=True)


@router.delete("/{track_id}", status_code=204)
def delete_track(track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Deletes the track for everyone, including from every playlist."""
    track = _get_owned(db, user, track_id)
    files = [track.file_path, track.cover_path]
    db.execute(delete(PlaylistTrack).where(PlaylistTrack.track_id == track.id))
    db.delete(track)
    db.commit()
    # Files go after the commit: a failure here leaves a stray file, never a broken row
    root = settings.data_dir.resolve()
    for rel in files:
        if not rel:
            continue
        try:
            path = (root / rel).resolve()
            if root in path.parents:
                path.unlink(missing_ok=True)
        except OSError:
            log.exception("Could not remove %s", rel)
