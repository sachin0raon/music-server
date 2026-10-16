"""Scan a mounted music folder (MUSIC_DIR) on demand.

Any signed-in user can scan for themselves. New files are copied into that user's
own storage through the same pipeline as an upload, so a file they already have is
skipped, and a scanned track is private to them until they share it."""
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from .auth import current_user
from .config import settings
from .db import SessionLocal
from .models import User
from .tracks import ALLOWED_EXT, FileUpload, walk_files
from .tracks import _process as process_file

log = logging.getLogger("library")
router = APIRouter(prefix="/api/library", tags=["library"])

MAX_RESULTS = 1000  # cap on the per-file list kept in memory for one job
_jobs: dict[int, dict] = {}  # user id -> that user's latest scan job
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(job: dict) -> dict:
    """A JSON-safe snapshot for the client."""
    out = dict(job)
    out["results"] = job["results"][:MAX_RESULTS]
    out["truncated"] = job["processed"] > len(out["results"])
    return out


def _record(job: dict, root: Path, path: Path, result: dict) -> None:
    with _lock:
        job["processed"] += 1
        job[{"ok": "added", "duplicate": "skipped", "error": "failed"}[result["status"]]] += 1
        if len(job["results"]) < MAX_RESULTS:
            try:
                shown = str(path.relative_to(root))
            except ValueError:
                shown = path.name
            job["results"].append({"filename": shown, "status": result["status"], "detail": result.get("detail")})


def _run(user_id: int, root: Path, job: dict) -> None:
    """Runs in a worker thread, with its own database session."""
    limit = settings.max_import_mb * 1024 * 1024
    try:
        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None:
                raise RuntimeError("This account no longer exists")
            files = [p for p in walk_files(root) if p.suffix.lower() in ALLOWED_EXT]
            with _lock:
                job["found"] = len(files)
            for path in files:
                try:
                    with open(path, "rb") as fh:
                        res = process_file(FileUpload(path.name, fh), user, db, max_bytes=limit)
                except OSError as exc:  # one unreadable file must not stop the run
                    res = {"status": "error", "detail": exc.strerror or str(exc)}
                _record(job, root, path, res)
    except Exception as exc:  # a broken run must still leave the job readable
        log.exception("Scan failed for user %s", user_id)
        with _lock:
            job["state"] = "error"
            job["error"] = str(exc)
            job["finished_at"] = _now()
        return
    with _lock:
        job["state"] = "done"
        job["finished_at"] = _now()


def _source_state() -> dict:
    root = settings.music_dir
    if root is None:
        return {"configured": False, "path": None, "exists": False, "readable": False}
    exists = root.is_dir()
    return {"configured": True, "path": str(root), "exists": exists,
            "readable": exists and os.access(root, os.R_OK)}


@router.get("/source")
def scan_source(user: User = Depends(current_user)):
    """Where the server looks for music, and whether it is reachable right now."""
    return _source_state()


@router.get("/scan")
def scan_status(user: User = Depends(current_user)):
    """The latest scan for this user, so the page can pick a running one back up."""
    with _lock:
        job = _jobs.get(user.id)
        return {"job": _public(job) if job else None}


@router.post("/scan")
def start_scan(user: User = Depends(current_user)):
    source = _source_state()
    if not source["configured"]:
        raise HTTPException(status_code=400, detail="No music folder is set up. Ask the server owner to set MUSIC_DIR and mount it.")
    if not source["exists"]:
        raise HTTPException(status_code=400, detail=f"The folder is not there inside the container: {source['path']}")
    if not source["readable"]:
        raise HTTPException(status_code=400, detail=f"The folder cannot be read: {source['path']}")
    root = settings.music_dir
    with _lock:
        job = _jobs.get(user.id)
        if job is not None and job["state"] == "running":
            return {"job": _public(job), "started": False}
        job = {"state": "running", "source": str(root), "started_at": _now(), "finished_at": None,
               "found": 0, "processed": 0, "added": 0, "skipped": 0, "failed": 0,
               "results": [], "truncated": False, "error": None}
        _jobs[user.id] = job
    threading.Thread(target=_run, args=(user.id, root, job), name=f"scan-user-{user.id}", daemon=True).start()
    return {"job": _public(job), "started": True}
