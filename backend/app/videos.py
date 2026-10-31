"""Downloaded videos: private files, kept until their owner deletes them.

Deliberately thin. A video here is a file with a label on it -- there is no
playback, no sharing and no playlists, so there is none of the machinery tracks
need. What it does have is an owner, and every route in this module filters on
that owner. There is no scope parameter to widen and no `is_shared` column to
set, which is what makes "private" a property of the schema rather than of
remembering to write the right WHERE clause.
"""

import json
import logging
import os
import secrets
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .access import resolve_file
from .auth import current_user
from .config import settings
from .db import get_db
from .models import User, Video

log = logging.getLogger("videos")

router = APIRouter(prefix="/api/videos", tags=["videos"])

# Served as a download rather than for playback, so the exact type matters less
# than the browser not trying to render it in a tab.
DOWNLOAD_TYPE = "application/octet-stream"

# What Apple devices play. Deliberately conservative: the point of reading the
# codecs at all is to stop promising a file will open when it will not, so a
# codec that only newer hardware decodes (AV1) is left out and flagged rather
# than waved through.
APPLE_VIDEO = {"h264", "avc1", "hevc", "h265"}
APPLE_AUDIO = {"aac", "mp3", "alac", "mp4a"}

CODEC_TIMEOUT = 30


def read_codecs(path: Path) -> tuple[str | None, str | None]:
    """The finished file's video and audio codecs, or (None, None).

    Never fatal: a missing or unhappy ffprobe costs a badge, not a download
    that already succeeded.
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=CODEC_TIMEOUT,
        )
        streams = json.loads(out.stdout or "{}").get("streams", [])
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        log.warning("Could not read codecs from %s: %s", path.name, exc)
        return None, None
    vcodec = next((s.get("codec_name") for s in streams if s.get("codec_type") == "video"), None)
    acodec = next((s.get("codec_name") for s in streams if s.get("codec_type") == "audio"), None)
    return vcodec, acodec


def plays_on_apple(vcodec: str | None, acodec: str | None) -> bool | None:
    """None when we could not tell, rather than a confident guess either way."""
    if not vcodec and not acodec:
        return None
    return ((vcodec or "").lower() in APPLE_VIDEO) and ((acodec or "").lower() in APPLE_AUDIO)


def video_out(v: Video) -> dict:
    """Never file_path or thumb_path: bytes are reachable only through a route
    that checks who is asking."""
    return {
        "id": v.id,
        "title": v.title,
        "uploader": v.uploader,
        "duration": v.duration,
        "width": v.width,
        "height": v.height,
        "container": v.container,
        "vcodec": v.vcodec,
        "acodec": v.acodec,
        # The container cannot answer this: an mp4 holding VP9 and Opus is
        # still an mp4, and still will not open on a phone.
        "apple_ok": plays_on_apple(v.vcodec, v.acodec),
        "file_size": v.file_size,
        "source_url": v.source_url,
        "has_thumb": bool(v.thumb_path),
        "created_at": v.created_at,
    }


def _own(db: DbSession, user: User, video_id: int) -> Video:
    video = db.get(Video, video_id)
    # 404 rather than 403 for someone else's: a wrong id and a forbidden id
    # should be indistinguishable, or the response tells you what exists.
    if video is None or video.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    return video


def store_video(db: DbSession, user: User, url: str, item: dict, fmt: dict,
                path: Path, thumb: Path | None, digest: str) -> Video:
    """Move a finished download into the library and record it.

    Called from the job thread once yt-dlp is done. The file is moved rather
    than copied -- it is already on the same volume, and a multi-gigabyte copy
    would double both the time and the disk high-water mark.
    """
    ext = path.suffix.lower()
    rel = f"users/{user.id}/{secrets.token_hex(16)}{ext}"
    final = settings.data_dir / rel
    final.parent.mkdir(parents=True, exist_ok=True)
    size = path.stat().st_size
    vcodec, acodec = read_codecs(path)
    os.replace(path, final)

    thumb_rel = None
    if thumb is not None and thumb.is_file():
        thumb_rel = f"users/{user.id}/covers/{secrets.token_hex(16)}.jpg"
        thumb_final = settings.data_dir / thumb_rel
        thumb_final.parent.mkdir(parents=True, exist_ok=True)
        os.replace(thumb, thumb_final)

    video = Video(
        owner_id=user.id,
        file_path=rel,
        original_name=(item.get("title") or "video")[:255],
        file_size=size,
        title=(item.get("title") or "Untitled")[:255],
        uploader=(item.get("uploader") or None),
        duration=item.get("duration"),
        width=fmt.get("width"),
        height=fmt.get("height"),
        # What the merge actually produced, not what it was asked for.
        container=ext.lstrip(".")[:16],
        vcodec=(vcodec or None),
        acodec=(acodec or None),
        source_url=url[:2048],
        format_id=str(fmt.get("id"))[:64],
        source_hash=digest,
        thumb_path=thumb_rel,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return video


@router.get("")
def list_videos(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Your videos, newest first. There is no scope: only ever your own."""
    where = Video.owner_id == user.id
    total = db.scalar(select(func.count()).select_from(Video).where(where))
    rows = db.scalars(
        select(Video).where(where).order_by(Video.created_at.desc(), Video.id.desc())
        .limit(limit).offset(offset)
    ).all()
    return {"total": total, "items": [video_out(v) for v in rows]}


@router.get("/{video_id}/file")
def download_video(video_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """The file itself, as an attachment.

    A plain <a href download> reaches this: the session cookie already
    authenticates it, so the browser does the transfer with a real progress
    bar instead of the page buffering it into memory first.
    """
    video = _own(db, user, video_id)
    path = resolve_file(video.file_path)
    name = f"{video.title[:120]}.{video.container or 'mp4'}".replace("/", "-").replace("\\", "-")
    return FileResponse(
        path,
        media_type=DOWNLOAD_TYPE,
        filename=name,
        headers={"Cache-Control": "private, no-cache"},
    )


@router.get("/{video_id}/thumb")
def video_thumb(video_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    video = _own(db, user, video_id)
    if not video.thumb_path:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        resolve_file(video.thumb_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.delete("/{video_id}")
def delete_video(video_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    video = _own(db, user, video_id)
    paths = [video.file_path, video.thumb_path]
    db.delete(video)
    db.commit()
    # After the commit: a file removed before one that failed would leave a row
    # pointing at nothing, which reads as corruption rather than a failed delete.
    for rel in paths:
        if not rel:
            continue
        try:
            (settings.data_dir / rel).unlink(missing_ok=True)
        except OSError as exc:
            log.warning("Could not remove %s for deleted video %s: %s", rel, video_id, exc)
    return {"status": "ok"}
