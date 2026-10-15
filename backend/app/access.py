"""The single place that decides who may see a track.
Every listing, detail, stream and cover request goes through these functions."""
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .models import Track, User


def visible_filter(user: User):
    """A track is visible if you own it OR it is shared."""
    return or_(Track.owner_id == user.id, Track.is_shared.is_(True))


def get_visible_track(db: DbSession, user: User, track_id: int) -> Track:
    track = db.scalar(select(Track).where(Track.id == track_id, visible_filter(user)))
    if track is None:
        # Same answer for "doesn't exist" and "not yours", so ids can't be probed
        raise HTTPException(status_code=404, detail="Not found")
    return track


def resolve_file(rel_path: str) -> Path:
    """Turn a stored relative path into a real file, refusing anything outside the data dir."""
    root = settings.data_dir.resolve()
    path = (root / rel_path).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return path
