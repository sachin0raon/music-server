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

import hashlib
import logging
import secrets
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import cookiestore
from .auth import current_user
from .config import settings
from .db import SessionLocal, get_db
from .models import User, Video
from .videos import store_video, video_out
from .ratelimit import RateLimiter
from .tracks import ALLOWED_EXT, FileUpload, _process, _result

# Its own prefix, not /api/tracks: that router ends in a catch-all GET
# /{track_id} parsed as an int, so any literal path added under it is shadowed
# unless the include order happens to be right. These are links and jobs rather
# than tracks in any case.
log = logging.getLogger("medialink")

router = APIRouter(prefix="/api/media", tags=["medialink"])

YTDLP_PINNED = "2026.10.26"  # keep in step with requirements.txt

# Shared with the direct-link import: both are "fetch something from the
# internet on the user's behalf", and one budget covers both.
_link_limiter = RateLimiter(limit=30, window_seconds=3600)

# Two at once. Downloading is I/O bound but converting is not, and this machine
# is also streaming audio to whoever is listening.
MAX_CONCURRENT = 2
_pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENT, thread_name_prefix="medialink")

# Its own worker, and only one. A multi-gigabyte download holds a slot for a
# long time, and on the shared pool two of them would block every audio import
# behind them. One at a time also keeps concurrent ffmpeg merges off a machine
# that is streaming audio to whoever is listening.
_video_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="videolink")

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
    # Reachable in ordinary use: a probe result is cached for minutes, so the
    # stream picked from it can be gone by the time Download is pressed.
    if "requested format is not available" in text:
        return "That stream is no longer on offer. Check the link again and pick a format."
    if "private" in text or "members-only" in text or "sign in" in text:
        return "That item is private or needs an account."
    if "unavailable" in text or "removed" in text:
        return "That item is unavailable."
    return "Could not read that link."


# ---------- cookies ----------

@contextmanager
def _cookie_opts(user_id: int, use_cookies: bool):
    """yt-dlp options carrying this user's cookies, and nothing left behind.

    The copy, and the keeping of what yt-dlp writes into it, both belong to
    cookiestore.lend -- see it for why a rotated cookie has to survive the
    operation. Nested inside the temporary directory so the swap happens while
    the file yt-dlp wrote still exists.

    Yields empty options when the user has nothing saved, so a stale toggle
    degrades to an anonymous attempt rather than an error.
    """
    if not use_cookies:
        yield {}
        return
    base = settings.data_dir / "tmp"
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=base, prefix="ck-") as tmp:
        with cookiestore.lend(user_id, Path(tmp)) as copy:
            yield {"cookiefile": str(copy)} if copy else {}


# ---------- probing ----------

# Starting a download needs the same answer the probe just produced: the title
# and uploader become the file's tags, and the chosen format has to still be on
# offer. Reading it from here rather than the request keeps both server-side
# without making the user wait through a second extraction after they click.
#
# Keyed by identity as well as URL: a signed-in probe can see formats, or a
# whole item, that an anonymous one cannot, so one user's result must never be
# served to another. Anonymous probes share a single key because they are
# genuinely the same request.
_probe_cache: dict[tuple[int, str], tuple[float, dict]] = {}
_probe_cache_lock = threading.Lock()


def _cached_probe(url: str, user_id: int = 0, use_cookies: bool = False) -> dict:
    key = (user_id if use_cookies else 0, url)
    now = time.monotonic()
    with _probe_cache_lock:
        hit = _probe_cache.get(key)
        if hit and now - hit[0] < PROBE_CACHE_SECONDS:
            return hit[1]
    item = _probe(url, user_id, use_cookies)
    with _probe_cache_lock:
        for stale in [k for k, (at, _) in _probe_cache.items() if now - at >= PROBE_CACHE_SECONDS]:
            del _probe_cache[stale]
        if len(_probe_cache) >= PROBE_CACHE_MAX:  # bounded: oldest first
            oldest = min(_probe_cache, key=lambda k: _probe_cache[k][0])
            del _probe_cache[oldest]
        _probe_cache[key] = (now, item)
    return item

# Containers that only ever carry audio. Consulted only when an extractor says
# nothing about codecs at all; webm is left out because it is usually video, and
# a webm that is audio-only says so through vcodec.
AUDIO_EXTS = {"m4a", "mp3", "opus", "ogg", "oga", "aac", "flac", "wav", "mka", "weba"}

# The mirror of AUDIO_EXTS, for the same reason: an extractor that declares no
# codecs at all leaves the container as the only evidence. webm is here rather
# than in AUDIO_EXTS because it is usually video; an audio-only webm says so
# through vcodec, which is checked first.
VIDEO_EXTS = {"mp4", "webm", "mkv", "mov", "m4v", "avi", "flv", "ts", "3gp"}


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
        if not _has_picture(f):
            continue
        out.append(_entry(f, True))
    out.sort(key=lambda f: (-(f["abr"] or 0), f["size"] or 0))
    return out


def _video_entry(f: dict) -> dict:
    height, width = f.get("height"), f.get("width")
    return {
        "id": f.get("format_id"),
        "ext": f.get("ext"),
        "codec": (f.get("vcodec") or "").split(".")[0],
        "width": width,
        "height": height,
        "fps": round(f["fps"]) if f.get("fps") else None,
        "size": f.get("filesize") or f.get("filesize_approx"),
        "note": f.get("format_note") or (f"{height}p" if height else ""),
        # Decides whether a second stream has to be merged in. Computed here,
        # from the probe, so the request never gets to say.
        "has_audio": bool(f.get("acodec") and f.get("acodec") != "none"),
    }


def _has_picture(f: dict) -> bool:
    """Whether a format carries a picture.

    Mirrors _is_audio_only, including its last resort: plenty of extractors fill
    in neither codec nor a height, and requiring one of those declared every
    such format invisible -- not audio, not video, and so a link that yt-dlp
    handles perfectly well reported as having nothing to download.
    """
    vcodec = f.get("vcodec")
    # Checked before the dimensions, not after: a storyboard declares no video
    # codec and still carries a height, so trusting the height first offered
    # YouTube's thumbnail sheets as a 27p download.
    if vcodec == "none":
        return False
    if f.get("height") or f.get("width") or f.get("fps"):
        return True
    if vcodec:
        return True
    if _is_audio_only(f):
        return False
    return (f.get("ext") or "").lower() in VIDEO_EXTS  # nothing declared: trust the container


def _video_formats(info: dict) -> list[dict]:
    """Streams carrying a picture, best first.

    Includes video-only streams: on most large sites those are the only way to
    get above 720p, and the audio is merged back in at download time.
    """
    out = []
    for f in _formats_of(info):
        if not _has_picture(f):
            continue
        out.append(_video_entry(f))
    out.sort(key=lambda f: (-(f["height"] or 0), -(f["fps"] or 0), f["size"] or 0))
    return out


def _probe(url: str, user_id: int = 0, use_cookies: bool = False) -> dict:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,  # a link copied from the address bar often carries ?list=
        "skip_download": True,
        # Probing does its own filtering of info["formats"], so yt-dlp's format
        # selection is a step we never use -- and it is fatal by default. A site
        # that returns only storyboards, or anything the default selector cannot
        # satisfy, killed the probe with "Requested format is not available"
        # while the formats we actually wanted were sitting in the result.
        "ignore_no_formats_error": True,
        "socket_timeout": PROBE_TIMEOUT_SECONDS,
    }
    try:
        with _cookie_opts(user_id, use_cookies) as cookie_opts:
            log.info("Probing %s (cookies: %s)", url, "yes" if cookie_opts else "no")
            with YoutubeDL({**opts, **cookie_opts}) as ydl:
                info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        # The message the user sees is deliberately vague; the real one is the
        # only thing that says whether a sign-in was the problem.
        log.warning("Probe failed for %s (cookies: %s): %s", url, use_cookies, exc)
        raise LinkError(_explain(exc)) from exc
    except Exception as exc:  # an extractor can raise almost anything
        log.warning("Probe failed for %s (cookies: %s): %s", url, use_cookies, exc)
        raise LinkError(_explain(exc)) from exc

    if info is None:
        raise LinkError("Could not read that link.")
    if info.get("_type") == "playlist":
        # noplaylist should have prevented this; a bare playlist URL still reaches it.
        raise LinkError("That link is a playlist. Paste a link to a single track.")
    # A live stream has no end, so it downloads until something stops it or the
    # disk is full, and its size cannot be estimated. Both disk guards are blind
    # to it, which makes refusing it here the only place that works.
    if info.get("is_live"):
        raise LinkError("That is a live stream. Wait until it has finished and try again.")

    formats = _audio_formats(info) or _muxed_formats(info)
    videos = _video_formats(info)
    if not formats and not videos:
        # Reached when the site answered but withheld the streams -- YouTube
        # does this to clients it does not trust, returning only storyboards.
        # Signed-in cookies from a datacenter address make that likelier, not
        # less, so the suggestion is worth making where it can be acted on.
        raise LinkError(
            "That link offered nothing downloadable. The site may be withholding it; "
            + ("try again with cookies turned off." if use_cookies
               else "signing in from Account settings and turning cookies on may help.")
        )

    return {
        "title": info.get("title") or "",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
        "video_formats": videos,
    }


# ---------- jobs ----------

@dataclass
class Job:
    id: str
    owner_id: int
    title: str
    kind: str = "audio"  # audio | video -- says which page the result belongs to
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
                "kind": self.kind,
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


def _download(job: Job, user_id: int, url: str, format_id: str, convert: str | None,
              bitrate: int | None, use_cookies: bool) -> Path:
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
        with _cookie_opts(user_id, use_cookies) as cookie_opts:
            log.info("Downloading %s format %s (cookies: %s)", url, format_id,
                     "yes" if cookie_opts else "no")
            with YoutubeDL({**opts, **cookie_opts}) as ydl:
                ydl.download([url])
    except DownloadError as exc:
        log.warning("Download failed for %s (cookies: %s): %s", url, use_cookies, exc)
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc
    except Exception as exc:
        log.warning("Download failed for %s (cookies: %s): %s", url, use_cookies, exc)
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc

    audio = sorted(p for p in work.iterdir() if p.is_file() and p.suffix.lower() in ALLOWED_EXT)
    if not audio:
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError("The download produced no audio file this library accepts.")
    return audio[0]


# ---------- video ----------

DISK_CHECK_SECONDS = 2  # a statvfs per progress callback would be per-chunk


def _free_bytes() -> int:
    return shutil.disk_usage(settings.data_dir).free


def _reserve_bytes() -> int:
    return settings.disk_reserve_mb * 1024 * 1024


def source_hash(url: str, format_id: str) -> str:
    """Identifies "this link at this quality", which is how a duplicate happens."""
    return hashlib.sha256(f"{url}\n{format_id}".encode()).hexdigest()


def check_disk(estimated: int | None) -> None:
    """Refuse before starting if finishing would eat into the reserve.

    The estimate understates a video, because the audio merged in afterwards is
    a second stream the format never counted. The mid-download check is what
    actually holds the line; this one just avoids starting the obviously
    hopeless.
    """
    free = _free_bytes()
    if free - (estimated or 0) < _reserve_bytes():
        mb = lambda n: f"{n // (1024 * 1024)} MB"  # noqa: E731 -- local shorthand
        need = f"needs about {mb(estimated)}" if estimated else "is too large"
        raise LinkError(
            f"Not enough disk space: this download {need}, {mb(free)} is free, "
            f"and {settings.disk_reserve_mb} MB is kept in reserve.")


def _video_selector(fmt: dict) -> str:
    """What to ask yt-dlp for, derived from the probe rather than the request.

    A video-only stream needs the best audio merged in or the file is silent.
    Appending it unconditionally would instead bolt a second audio track onto a
    stream that already had one, so the probe's own acodec decides.
    """
    fid = fmt["id"]
    return fid if fmt.get("has_audio") else f"{fid}+bestaudio/{fid}"


def _download_video(job: Job, user_id: int, url: str, fmt: dict, use_cookies: bool) -> tuple[Path, Path | None]:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    work = settings.data_dir / "tmp" / f"ytdlp-{secrets.token_hex(8)}"
    work.mkdir(parents=True, exist_ok=True)
    last_check = [0.0]

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            now = time.monotonic()
            if now - last_check[0] > DISK_CHECK_SECONDS:
                last_check[0] = now
                # The estimate was only ever a guess; this is the measurement.
                if _free_bytes() < _reserve_bytes():
                    raise LinkError("Ran out of disk space, so the download was stopped.")
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            got = d.get("downloaded_bytes") or 0
            if total:
                job.set(state="downloading", percent=min(99.0, got / total * 100))
        elif d.get("status") == "finished":
            # Merging reports no bytes, so the bar stops and the label carries it.
            job.set(state="converting", percent=100.0)

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": _video_selector(fmt),
        # Naming a format disables yt-dlp's mkv fallback (get_compatible_ext:
        # allow_mkv is false once preferences are set), so this always produces
        # mp4 -- ffmpeg will put even VP9 and Opus inside it. That makes the
        # container useless as a compatibility signal, which is why the codecs
        # are read off the finished file instead.
        "merge_output_format": "mp4",
        "outtmpl": str(work / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
        "writethumbnail": True,
        # Converted but deliberately not embedded: the Videos page wants a file
        # it can serve, not a picture buried in the container.
        "postprocessors": [{"key": "FFmpegThumbnailsConvertor", "format": "jpg"}],
        "socket_timeout": PROBE_TIMEOUT_SECONDS,
    }

    try:
        with _cookie_opts(user_id, use_cookies) as cookie_opts:
            log.info("Downloading video %s format %s (cookies: %s)", url, fmt["id"],
                     "yes" if cookie_opts else "no")
            with YoutubeDL({**opts, **cookie_opts}) as ydl:
                ydl.download([url])
    except LinkError:
        shutil.rmtree(work, ignore_errors=True)
        raise  # already carries a message meant for the user
    except DownloadError as exc:
        log.warning("Video download failed for %s: %s", url, exc)
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc
    except Exception as exc:
        log.warning("Video download failed for %s: %s", url, exc)
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError(_explain(exc)) from exc

    files = [p for p in work.iterdir() if p.is_file()]
    thumb = next((p for p in files if p.suffix.lower() == ".jpg"), None)
    # The video is whatever is left and largest: the merge output's extension
    # depends on what the codecs allowed.
    rest = [p for p in files if p is not thumb]
    if not rest:
        shutil.rmtree(work, ignore_errors=True)
        raise LinkError("The download produced no video file.")
    return max(rest, key=lambda p: p.stat().st_size), thumb


def _safe_name(title: str, uploader: str, ext: str) -> str:
    """A readable filename. Only a fallback: the file carries real tags by now."""
    base = " - ".join(p for p in (title.strip(), uploader.strip()) if p) or "track"
    cleaned = "".join(c for c in base if c.isalnum() or c in " -_()[]").strip()
    return f"{(cleaned or 'track')[:200]}{ext}"


def _run_video_job(job: Job, user_id: int, url: str, item: dict, fmt: dict, use_cookies: bool) -> None:
    work = None
    try:
        path, thumb = _download_video(job, user_id, url, fmt, use_cookies)
        work = path.parent
        job.set(state="importing")
        # Opened here rather than before: holding a connection across a download
        # that runs for minutes wastes one and risks a timeout.
        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None:
                raise LinkError("Your account is no longer available.")
            video = store_video(db, user, url, item, fmt, path, thumb,
                                source_hash(url, str(fmt.get("id"))))
            # "filename" rather than "name": ImportResults renders both the
            # audio and video outcomes, and keys off that.
            result = {"filename": video.title, "status": "ok", "detail": "Saved to Videos",
                      "kind": "video", "video": video_out(video)}
        job.set(state="done", percent=100.0, result=result, finished_at=time.monotonic())
    except LinkError as exc:
        job.set(state="error", error=str(exc), finished_at=time.monotonic(),
                result=_result(job.title or "video", "error", str(exc)))
    except Exception:
        log.exception("Video job failed for %s", url)
        job.set(state="error", error="Something went wrong during the download.",
                finished_at=time.monotonic(),
                result=_result(job.title or "video", "error", "Something went wrong during the download."))
    finally:
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)


def _run_job(job: Job, user_id: int, url: str, item: dict, format_id: str,
             convert: str | None, bitrate: int | None, use_cookies: bool) -> None:
    path = None
    try:
        path = _download(job, user_id, url, format_id, convert, bitrate, use_cookies)
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
    # Off unless asked for, every time. Cookies are a live credential, and
    # sending them to a site that does not need them is a cost with no benefit.
    use_cookies: bool = False


class FetchBody(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    format_id: str = Field(min_length=1, max_length=64)
    convert: str | None = Field(default=None, pattern="^mp3$")
    bitrate: int | None = None
    use_cookies: bool = False
    # Which library the result belongs in. Defaults to audio so every existing
    # caller keeps working unchanged.
    kind: str = Field(default="audio", pattern="^(audio|video)$")


class CookieBody(BaseModel):
    text: str = Field(min_length=1, max_length=cookiestore.MAX_BYTES)


def _require_cookies(user_id: int, use_cookies: bool) -> None:
    """Say so up front rather than letting it fail as 'this needs an account'.

    Only reachable by a direct call or a toggle left on while the file was
    cleared elsewhere: the form hides the toggle when nothing is saved.
    """
    if use_cookies and not cookiestore.status(user_id)["saved"]:
        raise HTTPException(
            status_code=400,
            detail="No cookies saved. Add them in Account settings, or turn the option off.")


@router.post("/probe-link")
def probe_link(body: ProbeBody, user: User = Depends(current_user)):
    """What this link offers. Synchronous: it is seconds, not minutes."""
    _require_cookies(user.id, body.use_cookies)
    _link_limiter.check(f"link:{user.id}")
    _link_limiter.hit(f"link:{user.id}")
    try:
        return _cached_probe(body.url.strip(), user.id, body.use_cookies)
    except LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/fetch")
def from_media_link(body: FetchBody, user: User = Depends(current_user),
                    db: DbSession = Depends(get_db)):
    """Start a download. Returns at once; poll the job for the rest."""
    _require_cookies(user.id, body.use_cookies)
    _link_limiter.check(f"link:{user.id}")
    _link_limiter.hit(f"link:{user.id}")
    if body.convert == "mp3" and body.bitrate not in MP3_BITRATES:
        raise HTTPException(status_code=400, detail="Unsupported bitrate")

    # Served from the probe the user just ran, so this is normally a lookup
    # rather than a second extraction. Still server-side: the title and uploader
    # that become the file's tags never come from the request body.
    try:
        item = _cached_probe(body.url.strip(), user.id, body.use_cookies)
    except LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.kind == "video":
        return _start_video(body, item, user, db)

    if not any(f["id"] == body.format_id for f in item["formats"]):
        raise HTTPException(status_code=400, detail="That format is no longer available")

    job = Job(id=uuid.uuid4().hex, owner_id=user.id, title=item["title"])
    _put_job(job)
    _pool.submit(_run_job, job, user.id, body.url.strip(), item,
                 body.format_id, body.convert, body.bitrate, body.use_cookies)
    return job.snapshot()


def _start_video(body: "FetchBody", item: dict, user: User, db: DbSession) -> dict:
    url = body.url.strip()
    fmt = next((f for f in item.get("video_formats", []) if f["id"] == body.format_id), None)
    if fmt is None:
        raise HTTPException(status_code=400, detail="That format is no longer available")

    # Checked before the bandwidth is spent. The unique constraint is still the
    # backstop for two requests racing each other.
    digest = source_hash(url, body.format_id)
    if db.scalar(select(Video.id).where(Video.owner_id == user.id, Video.source_hash == digest)):
        raise HTTPException(status_code=409, detail="You already downloaded this video at this quality.")

    try:
        check_disk(fmt.get("size"))
    except LinkError as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc

    job = Job(id=uuid.uuid4().hex, owner_id=user.id, title=item["title"], kind="video")
    _put_job(job)
    _video_pool.submit(_run_video_job, job, user.id, url, item, fmt, body.use_cookies)
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


# ---------- cookie file ----------

# Saved rather than sent per link: a cookies.txt export is thousands of
# characters, and pasting it into the download form for every link is the kind
# of friction that stops the feature being used. Managed from Account instead,
# where it reads as what it is -- a credential you keep.

@router.get("/cookies")
def cookie_status(user: User = Depends(current_user)):
    """Whether a file is saved and when. Deliberately never its contents.

    Nothing reads the cookies back out to the browser, so a stolen session on
    this app cannot be turned into the sessions inside the file.
    """
    return cookiestore.status(user.id)


@router.put("/cookies")
def save_cookies(body: CookieBody, user: User = Depends(current_user)):
    try:
        cookiestore.save(user.id, body.text)
    except ValueError as exc:
        log.warning("User %s: rejected a pasted cookies file: %s", user.id, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log.info("User %s: saved cookies -- %s", user.id,
             cookiestore.describe(cookiestore.path_for(user.id)))
    return cookiestore.status(user.id)


@router.delete("/cookies")
def delete_cookies(user: User = Depends(current_user)):
    cookiestore.clear(user.id)
    return cookiestore.status(user.id)
