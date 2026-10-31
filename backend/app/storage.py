"""How much room is left, and what is using it.

Two different questions with two different costs. Whether the volume is filling
up is one statvfs, so it is answered fresh every time. What is using the space
means walking every file under the data directory, so it is answered from a
cache -- stale by minutes, which for disk usage is nothing.

Keeping them apart is the point: free space, the number that decides whether a
download is refused, is never the stale one.
"""

import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .config import settings
from .db import get_db
from .models import User

router = APIRouter(prefix="/api/storage", tags=["storage"])

# Matches PROBE_CACHE_SECONDS so the codebase has one idea of "recent enough".
CACHE_SECONDS = 5 * 60

_lock = threading.Lock()
_cached: tuple[float, dict] | None = None


def _dir_size(path: str) -> int:
    """Bytes under a directory, following nothing.

    follow_symlinks=False throughout: a link is counted as the few bytes it
    occupies rather than as its target, which keeps the walk inside the data
    directory and incapable of looping.
    """
    total = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        # Vanished mid-walk, most likely a temp file from a
                        # download that just finished. Costs a byte count.
                        continue
        except OSError:
            continue
    return total


def _walk(root: Path) -> dict[str, int]:
    """Bytes per bucket, taken from the layout rather than a mapping table.

    users/<id> per person, then whatever other top-level directories exist
    (shared, tmp), and loose top-level files as "other".
    """
    buckets: dict[str, int] = {}
    other = 0
    try:
        entries = list(os.scandir(root))
    except OSError:
        return {}

    for entry in entries:
        try:
            if not entry.is_dir(follow_symlinks=False):
                other += entry.stat(follow_symlinks=False).st_size
                continue
            if entry.name != "users":
                buckets[entry.name] = _dir_size(entry.path)
                continue
            with os.scandir(entry.path) as people:
                for person in people:
                    try:
                        if person.is_dir(follow_symlinks=False):
                            buckets[f"users/{person.name}"] = _dir_size(person.path)
                        else:
                            other += person.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue

    buckets["other"] = other
    return buckets


def usage(refresh: bool = False) -> dict:
    """The cached walk. One request computes it; the rest wait for that answer.

    The lock spans the walk deliberately. Letting every expired request start
    its own would turn a cold cache into several concurrent walks of the same
    tree, which is the one case where this is expensive.
    """
    global _cached
    with _lock:
        now = time.monotonic()
        if not refresh and _cached and now - _cached[0] < CACHE_SECONDS:
            return _cached[1]
        result = {
            "buckets": _walk(settings.data_dir),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
        # monotonic for the TTL, wall clock for display: a clock change must not
        # freeze or expire the cache.
        _cached = (now, result)
        return result


def _volume() -> dict | None:
    """Always fresh -- one statvfs. None when the volume cannot be read at all,
    which is exactly when someone would be looking at this panel."""
    try:
        du = shutil.disk_usage(settings.data_dir)
    except OSError:
        return None
    return {
        "total": du.total,
        "used": du.used,
        "free": du.free,
        # The same number that refuses a download, so the two cannot drift.
        "reserve": settings.disk_reserve_mb * 1024 * 1024,
    }


@router.get("")
def storage_summary(
    brief: bool = Query(default=False),
    refresh: bool = Query(default=False),
    user: User = Depends(current_user),
):
    """Volume figures for anyone, plus their own usage and the totals.

    Never another user's figures -- those live on /users, which is admin-only.
    `brief` skips the walk entirely, for the free-space line on the upload page.
    """
    out: dict = {"volume": _volume()}
    if brief:
        return out

    data = usage(refresh)
    buckets = data["buckets"]
    mine = buckets.get(f"users/{user.id}", 0)
    out.update({
        "you": {"bytes": mine},
        "library": {
            "total": sum(buckets.values()),
            "shared": buckets.get("shared", 0),
            "tmp": buckets.get("tmp", 0),
            "other": buckets.get("other", 0),
        },
        "computed_at": data["computed_at"],
    })
    return out


@router.get("/users")
def storage_by_user(
    refresh: bool = Query(default=False),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Per-user usage, fetched only when an admin asks for it.

    A route that exists solely for admins, so refusing is clearer than an empty
    list that reads as "nobody is using anything".
    """
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")

    data = usage(refresh)
    names = dict(db.execute(select(User.id, User.username)).all())

    rows = []
    for bucket, size in data["buckets"].items():
        if not bucket.startswith("users/"):
            continue
        raw = bucket.split("/", 1)[1]
        uid = int(raw) if raw.isdigit() else None
        rows.append({
            "id": uid,
            # A directory left behind by a deleted account. Shown rather than
            # hidden: it is reclaimable space, and nothing removes it today.
            "username": names.get(uid) if uid in names else None,
            "orphan": uid not in names,
            "bytes": size,
        })
    rows.sort(key=lambda r: r["bytes"], reverse=True)
    return {"users": rows, "computed_at": data["computed_at"]}
