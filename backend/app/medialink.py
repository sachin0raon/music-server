"""Add a track from a page yt-dlp understands, rather than a direct file link.

Two steps, deliberately. Probing a link is a few seconds of network round trips
and answers synchronously. Downloading is minutes: long enough that holding the
request open loses to proxy timeouts and backgrounded tabs, and long enough that
occupying a worker would starve everything else the server does, playback
included. So a download is a job, and the browser polls it.

What lands on disk is a stream the site actually serves. The alternative --
re-encoding to MP3 by default -- makes a bigger file out of a lossy source and
sounds slightly worse for it, so conversion is offered rather than assumed.
"""

import secrets
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import current_user
from .config import settings
from .db import SessionLocal
from .models import User
from .ratelimit import RateLimiter
from .tracks import ALLOWED_EXT, FileUpload, _process, _result

# Its own prefix, not /api/tracks: that router ends in a catch-all GET
# /{track_id} parsed as an int, so any literal path added under it is shadowed
# unless the include order happens to be right. These are links and jobs rather
# than tracks in any case.
router = APIRouter(prefix="/api/media", tags=["medialink"])

YTDLP_PINNED = "2026.10.26"  # keep in step with requirements.txt

# Shared with the direct-link import: both are "fetch something from the
# internet on the user's behalf", and one budget covers both.
_link_limiter = RateLimiter(limit=30, window_seconds=3600)

# Two at once. Downloading is I/O bound but converting is not, and this machine
# is also streaming audio to whoever is listening.
MAX_CONCURRENT = 2
_pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENT, thread_name_prefix="medialink")

JOB_TTL_SECONDS = 30 * 60  # how long a finished job stays readable
PROBE_TIMEOUT_SECONDS = 30
PROBE_CACHE_SECONDS = 5 * 60
PROBE_CACHE_MAX = 64
MP3_BITRATES = (128, 192, 256, 320)


# ---------- errors ----------

class LinkError(Exception):
    """Carries a message that is safe to put in front of the user."""


def _explain(exc: Exception) -> str:
    """Turn yt-dlp's one catch-all exception into something actionable.

    Worth the trouble for the middle case: an extractor that has fallen behind
    the site reads exactly like a bug in this app, and the fix is a version
    bump. Saying so here is the difference between a one-line fix and an
    afternoon.
    """
    text = str(exc).lower()
    if "unsupported url" in text or "no video formats" in text:
        return "That link is not supported."
    if any(s in text for s in ("nsig", "signature", "player", "unable to extract", "precondition check")):
        return (
            f"The site has changed and the installed yt-dlp ({YTDLP_PINNED}) can no longer read it. "
            "Updating yt-dlp should fix this."
        )
    if "private" in text or "members-only" in text or "sign in" in text:
        return "That item is private or needs an account."
    if "unavailable" in text or "removed" in text:
        return "That item is unavailable."
    return "Could not read that link."


# ---------- probing ----------

# Starting a download needs the same answer the probe just produced: the title
# and uploader become the file's tags, and the chosen format has to still be on
# offer. Reading it from here rather than the request keeps both server-side
# without making the user wait through a second extraction after they click.
_probe_cache: dict[str, tuple[float, dict]] = {}
_probe_cache_lock = threading.Lock()


def _cached_probe(url: str) -> dict:
    now = time.monotonic()
    with _probe_cache_lock:
        hit = _probe_cache.get(url)
        if hit and now - hit[0] < PROBE_CACHE_SECONDS:
            return hit[1]
    item = _probe(url)
    with _probe_cache_lock:
        for key in [k for k, (at, _) in _probe_cache.items() if now - at >= PROBE_CACHE_SECONDS]:
            del _probe_cache[key]
        if len(_probe_cache) >= PROBE_CACHE_MAX:  # bounded: oldest first
            oldest = min(_probe_cache, key=lambda k: _probe_cache[k][0])
            del _probe_cache[oldest]
        _probe_cache[url] = (now, item)
    return item

# Containers that only ever carry audio. Consulted only when an extractor says
# nothing about codecs at all; webm is left out because it is usually video, and
# a webm that is audio-only says so through vcodec.
AUDIO_EXTS = {"m4a", "mp3", "opus", "ogg", "oga", "aac", "flac", "wav", "mka", "weba"}


def _formats_of(info: dict) -> list[dict]:
    """Every format, including the shape where there is only one.

    An extractor that yields a single format leaves `formats` unset and puts the
    fields at the top level; yt-dlp's own _get_formats does exactly this, and
    reading `info["formats"]` alone finds nothing for those sites.
    """
    if info.get("formats"):
        return info["formats"]
    return [info] if info.get("url") else []


def _is_audio_only(f: dict) -> bool:
    """Whether a format carries sound and no picture.

    Deliberately not a test for `acodec != "none"`: plenty of extractors fill in
    neither codec, and treating a missing acodec as "no audio" threw away every
    format they offered and reported the link as having no audio at all.
    """
    if f.get("height") or f.get("width") or f.get("fps"):
        return False  # it has a picture whatever the codecs claim
    vcodec, acodec = f.get("vcodec"), f.get("acodec")
    if vcodec and vcodec != "none":
        return False
    if acodec == "none":
        return False
    if acodec:
        return True
    return (f.get("ext") or "").lower() in AUDIO_EXTS  # nothing declared: trust the container


def _entry(f: dict, muxed: bool) -> dict:
    return {
        "id": f.get("format_id"),
        "ext": f.get("ext"),
        "codec": (f.get("acodec") or "").split(".")[0],
        "abr": round(f["abr"]) if f.get("abr") else None,
        "size": f.get("filesize") or f.get("filesize_approx"),
        "note": f.get("format_note") or (f"{f['height']}p" if f.get("height") else ""),
        "muxed": muxed,
    }


def _audio_formats(info: dict) -> list[dict]:
    """Audio-only streams, best first."""
    out = [_entry(f, False) for f in _formats_of(info) if _is_audio_only(f)]
    out.sort(key=lambda f: (f["abr"] or 0), reverse=True)
    return out


def _muxed_formats(info: dict) -> list[dict]:
    """Streams carrying both picture and sound, as a fallback.

    Plenty of sites serve nothing else, and refusing those outright would reject
    links that yt-dlp handles perfectly well -- the audio is simply copied out
    and the picture discarded. The cost is downloading a video to keep the sound
    from it, so these are offered only when there is no audio-only stream, and
    the smallest picture wins once the audio is as good as it gets.
    """
    out = []
    for f in _formats_of(info):
        if _is_audio_only(f) or f.get("acodec") == "none":
            continue
        has_picture = f.get("height") or f.get("width") or (f.get("vcodec") not in (None, "none"))
        if not has_picture:
            continue
        out.append(_entry(f, True))
    out.sort(key=lambda f: (-(f["abr"] or 0), f["size"] or 0))
    return out


def _probe(url: str) -> dict:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,  # a link copied from the address bar often carries ?list=
        "skip_download": True,
        "socket_timeout": PROBE_TIMEOUT_SECONDS,
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        raise LinkError(_explain(exc)) from exc
    except Exception as exc:  # an extractor can raise almost anything
        raise LinkError(_explain(exc)) from exc

    if info is None:
        raise LinkError("Could not read that link.")
    if info.get("_type") == "playlist":
        # noplaylist should have prevented this; a bare playlist URL still reaches it.
        raise LinkError("That link is a playlist. Paste a link to a single track.")

    formats = _audio_formats(info) or _muxed_formats(info)
    if not formats:
        raise LinkError("That link has no audio this app can download.")

    return {
        "title": info.get("title") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
    }


# ---------- jobs ----------

@dataclass
class Job:
    id: str
    owner_id: int
    title: str
    state: str = "queued"  # queued | downloading | converting | importing | done | error
    percent: float = 0.0
    result: dict | None = None
    error: str | None = None
    finished_at: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set(self, **changes) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(self, key, value)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "id": self.id,
                "state": self.state,
                "percent": round(self.percent, 1),
                "title": self.title,
                "result": self.result,
                "error": self.error,
            }


# Touched from the request threadpool and from the job pool, so a threading
# lock, not an asyncio one: none of this runs on the event loop.
_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def _sweep_jobs() -> None:
    cutoff = time.monotonic() - JOB_TTL_SECONDS
    for job_id in [i for i, j in _jobs.items() if j.finished_at and j.finished_at < cutoff]:
        del _jobs[job_id]


def _put_job(job: Job) -> None:
    with _jobs_lock:
        _sweep_jobs()
        _jobs[job.id] = job


def _get_job(job_id: str, owner_id: int) -> Job:
    with _jobs_lock:
        _sweep_jobs()
        job = _jobs.get(job_id)
    # 404 rather than 403 for someone else's job: the answer should not confirm
    # that it exists.
    if job is None or job.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="No such job")
    return job


# ---------- the work ----------

def _postprocessors(convert: str | None, bitrate: int | None) -> list[dict]:
    """Extraction, tags, then artwork.

    `preferredcodec: best` is what keeps this lossless, and its behaviour is
    worth stating because it is not obvious. Opus arrives from YouTube inside
    WebM, and `webm` is not one of yt-dlp's COMMON_AUDIO_EXTS, so `best` takes
    the copy branch and remuxes it to .opus with the stream untouched. An m4a
    download is in that list, so it is skipped and passes through as it is.
    Either way nothing is re-encoded.

    FFmpegMetadata makes the file carry its own title and artist: the ingest
    reads tags and these streams have none.

    The thumbnail is converted to JPEG before being embedded, because the cover
    check accepts only JPEG and PNG by magic bytes and would drop a WebP one
    without a word. That conversion is a postprocessor, not an option --
    `convert_thumbnails` is CLI-only sugar and is ignored here.
    """
    steps: list[dict] = [{
        "key": "FFmpegExtractAudio",
        "preferredcodec": convert or "best",
        **({"preferredquality": str(bitrate)} if convert == "mp3" and bitrate else {}),
    }]
    steps.append({"key": "FFmpegMetadata", "add_metadata": True})
    steps.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg"})
    steps.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
    return steps


def _download(job: Job, url: str, format_id: str, convert: str | None, bitrate: int | None) -> Path:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    work = settings.data_dir / "tmp" / f"ytdlp-{secrets.token_hex(8)}"
    work.mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            got = d.get("downloaded_bytes") or 0
            if total:
                job.set(state="downloading", percent=min(99.0, got / total * 100))
        elif d.get("status") == "finished":
            # Converting reports no bytes, so the bar stops and the label carries it.
            job.set(state="converting", percent=100.0)

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": format_id,
        "outtmpl": str(work / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
        "postprocessors": _postprocessors(convert, bitrate),
        "writethumbnail": True,
        "socket_timeout": PROBE_TIMEOUT_SECONDS,
    }

    try:
        with YoutubeDL(opts) as ydl:
            ydl.download([url])
    except DownloadError as exc:
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc
    except Exception as exc:
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc

    audio = sorted(p for p in work.iterdir() if p.is_file() and p.suffix.lower() in ALLOWED_EXT)
    if not audio:
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError("The download produced no audio file this library accepts.")
    return audio[0]


def _safe_name(title: str, uploader: str, ext: str) -> str:
    """A readable filename. Only a fallback: the file carries real tags by now."""
    base = " - ".join(p for p in (title.strip(), uploader.strip()) if p) or "track"
    cleaned = "".join(c for c in base if c.isalnum() or c in " -_()[]").strip()
    return f"{(cleaned or 'track')[:200]}{ext}"


def _run_job(job: Job, user_id: int, url: str, item: dict, format_id: str,
             convert: str | None, bitrate: int | None) -> None:
    path = None
    try:
        path = _download(job, url, format_id, convert, bitrate)
        job.set(state="importing")
        name = _safe_name(item.get("title") or "", item.get("uploader") or "", path.suffix.lower())
        # The session is opened here and not before: holding one across a
        # download that takes minutes wastes a connection and risks a timeout.
        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None:
                raise LinkError("Your account is no longer available.")
            with path.open("rb") as fh:
                result = _process(FileUpload(name, fh), user, db,
                                  max_bytes=settings.max_import_mb * 1024 * 1024)
        job.set(state="done", percent=100.0, result=result, finished_at=time.monotonic())
    except LinkError as exc:
        job.set(state="error", error=str(exc), finished_at=time.monotonic(),
                result=_result(job.title or "track", "error", str(exc)))
    except Exception:
        job.set(state="error", error="Something went wrong during the download.",
                finished_at=time.monotonic(),
                result=_result(job.title or "track", "error", "Something went wrong during the download."))
        raise
    finally:
        if path is not None:
            shutil.rmtree(path.parent, ignore_errors=True)


# ---------- endpoints ----------

class ProbeBody(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class FetchBody(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    format_id: str = Field(min_length=1, max_length=64)
    convert: str | None = Field(default=None, pattern="^mp3$")
    bitrate: int | None = None


@router.post("/probe-link")
def probe_link(body: ProbeBody, user: User = Depends(current_user)):
    """What this link offers. Synchronous: it is seconds, not minutes."""
    _link_limiter.check(f"link:{user.id}")
    _link_limiter.hit(f"link:{user.id}")
    try:
        return _cached_probe(body.url.strip())
    except LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/fetch")
def from_media_link(body: FetchBody, user: User = Depends(current_user)):
    """Start a download. Returns at once; poll the job for the rest."""
    _link_limiter.check(f"link:{user.id}")
    _link_limiter.hit(f"link:{user.id}")
    if body.convert == "mp3" and body.bitrate not in MP3_BITRATES:
        raise HTTPException(status_code=400, detail="Unsupported bitrate")

    # Served from the probe the user just ran, so this is normally a lookup
    # rather than a second extraction. Still server-side: the title and uploader
    # that become the file's tags never come from the request body.
    try:
        item = _cached_probe(body.url.strip())
    except LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not any(f["id"] == body.format_id for f in item["formats"]):
        raise HTTPException(status_code=400, detail="That format is no longer available")

    job = Job(id=uuid.uuid4().hex, owner_id=user.id, title=item["title"])
    _put_job(job)
    _pool.submit(_run_job, job, user.id, body.url.strip(), item,
                 body.format_id, body.convert, body.bitrate)
    return job.snapshot()


@router.get("/jobs")
def list_media_jobs(user: User = Depends(current_user)):
    """Whatever this user still has running.

    The job id otherwise lives only in the tab that started it, so a reload
    halfway through would leave the download running with nothing watching it.
    """
    with _jobs_lock:
        _sweep_jobs()
        mine = [j for j in _jobs.values() if j.owner_id == user.id]
    return {"jobs": [j.snapshot() for j in mine]}


@router.get("/jobs/{job_id}")
def media_job(job_id: str, user: User = Depends(current_user)):
    return _get_job(job_id, user.id).snapshot()
