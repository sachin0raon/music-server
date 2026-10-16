from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from .access import get_visible_track, visible_filter
from .auth import current_user
from .db import get_db
from .models import Playlist, PlaylistTrack, Track, User
from .tracks import track_out

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class AddTrackBody(BaseModel):
    track_id: int


class OrderBody(BaseModel):
    # The tracks the user can see in this playlist, in the order they should play
    track_ids: list[int] = Field(max_length=1000)


def _get_playlist(db: DbSession, user: User, playlist_id: int) -> Playlist:
    playlist = db.scalar(select(Playlist).where(Playlist.id == playlist_id, Playlist.owner_id == user.id))
    if playlist is None:
        raise HTTPException(status_code=404, detail="Not found")  # others' playlists look nonexistent
    return playlist


def _playlist_out(p: Playlist, count: int) -> dict:
    return {"id": p.id, "name": p.name, "track_count": count, "created_at": p.created_at}


def _playlist_detail(db: DbSession, playlist: Playlist, user: User) -> dict:
    """The playlist plus its visible tracks, in stored order. Unchanged shape."""
    rows = db.execute(
        select(Track, User.username)
        .join(PlaylistTrack, PlaylistTrack.track_id == Track.id)
        .join(User, User.id == Track.owner_id)
        .where(PlaylistTrack.playlist_id == playlist.id, visible_filter(user))
        .order_by(PlaylistTrack.position, PlaylistTrack.id)
    ).all()
    items = [track_out(t, user.id, owner) for t, owner in rows]
    return {**_playlist_out(playlist, len(items)), "tracks": items}


def _count(db: DbSession, user: User, playlist_ids: list[int]) -> dict[int, int]:
    """Counts only tracks you can still see (an unshared track drops out quietly)."""
    if not playlist_ids:
        return {}
    rows = db.execute(
        select(PlaylistTrack.playlist_id, func.count())
        .join(Track, Track.id == PlaylistTrack.track_id)
        .where(PlaylistTrack.playlist_id.in_(playlist_ids), visible_filter(user))
        .group_by(PlaylistTrack.playlist_id)
    ).all()
    return dict(rows)


@router.get("")
def list_playlists(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlists = db.scalars(select(Playlist).where(Playlist.owner_id == user.id).order_by(Playlist.created_at.desc(), Playlist.id.desc())).all()
    counts = _count(db, user, [p.id for p in playlists])
    return [_playlist_out(p, counts.get(p.id, 0)) for p in playlists]


@router.post("", status_code=201)
def create_playlist(body: NameBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = Playlist(owner_id=user.id, name=body.name.strip() or "Untitled")
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return _playlist_out(playlist, 0)


@router.get("/{playlist_id}")
def get_playlist(playlist_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = _get_playlist(db, user, playlist_id)
    return _playlist_detail(db, playlist, user)


@router.patch("/{playlist_id}")
def rename_playlist(playlist_id: int, body: NameBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = _get_playlist(db, user, playlist_id)
    playlist.name = body.name.strip() or playlist.name
    db.commit()
    return _playlist_out(playlist, _count(db, user, [playlist.id]).get(playlist.id, 0))


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = _get_playlist(db, user, playlist_id)
    db.query(PlaylistTrack).filter(PlaylistTrack.playlist_id == playlist.id).delete()
    db.delete(playlist)  # the tracks themselves are untouched
    db.commit()


@router.post("/{playlist_id}/tracks", status_code=201)
def add_track(playlist_id: int, body: AddTrackBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = _get_playlist(db, user, playlist_id)
    track = get_visible_track(db, user, body.track_id)  # yours or shared, nothing else
    last = db.scalar(select(func.max(PlaylistTrack.position)).where(PlaylistTrack.playlist_id == playlist.id))
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=(last + 1) if last is not None else 0))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already in this playlist")
    return {"playlist_id": playlist.id, "track_id": track.id}


@router.delete("/{playlist_id}/tracks/{track_id}", status_code=204)
def remove_track(playlist_id: int, track_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    playlist = _get_playlist(db, user, playlist_id)
    db.query(PlaylistTrack).filter(PlaylistTrack.playlist_id == playlist.id, PlaylistTrack.track_id == track_id).delete()
    db.commit()


@router.put("/{playlist_id}/order")
def reorder_tracks(playlist_id: int, body: OrderBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Store a new play order. The body is every track the caller can see in the
    playlist, in the wanted order; the stored order is what GET returns.

    One uniform 400 covers a missing, extra, unknown or invisible id, so ids
    cannot be probed and another user's private track is never accepted."""
    playlist = _get_playlist(db, user, playlist_id)
    rows = db.execute(select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)).scalars().all()
    by_track = {row.track_id: row for row in rows}
    visible = db.execute(
        select(PlaylistTrack.track_id)
        .join(Track, Track.id == PlaylistTrack.track_id)
        .where(PlaylistTrack.playlist_id == playlist.id, visible_filter(user))
    ).scalars().all()
    if sorted(body.track_ids) != sorted(visible):
        raise HTTPException(status_code=400, detail="Send every track in the playlist, in order.")
    for position, track_id in enumerate(body.track_ids):
        by_track[track_id].position = position
    db.commit()
    return _playlist_detail(db, playlist, user)
