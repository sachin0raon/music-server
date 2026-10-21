import base64
import json
import logging
import os
import queue
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import settings

log = logging.getLogger("itunes")

# Outbound rate limiting: Apple Search API is capped at ~20 calls per minute
MIN_INTERVAL = 3.0  # seconds between consecutive outbound iTunes calls
MAX_COVER_BYTES = 8 * 1024 * 1024  # 8 MB max

_miss_cache: set[str] = set()
_miss_lock = threading.Lock()

_pending_keys: set[str] = set()
_queue: queue.Queue = queue.Queue()
_queue_lock = threading.Lock()
_last_call_time = 0.0
_worker_started = False
_worker_lock = threading.Lock()


def is_miss(key: str) -> bool:
    with _miss_lock:
        return key in _miss_cache


def record_miss(key: str) -> None:
    with _miss_lock:
        _miss_cache.add(key)


def invalidate_negative_cache(key: str) -> None:
    with _miss_lock:
        _miss_cache.discard(key)


def _cover_ext(data: bytes) -> str | None:
    if len(data) > MAX_COVER_BYTES:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    return None


def _clean_query_term(text: str) -> str:
    # Remove bracketed extras like (From "...") or [Songspk.LINK] or bitrates
    cleaned = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", text)
    cleaned = re.sub(r"\b(128|146|192|256|320|kbps)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or text.strip()


def _call_itunes_api(term: str) -> dict | None:
    global _last_call_time
    now = time.time()
    elapsed = now - _last_call_time
    if elapsed < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - elapsed)

    country = os.getenv("ITUNES_COUNTRY", "IN").strip() or "IN"
    params = {
        "media": "music",
        "entity": "song",
        "limit": "1",
        "country": country,
        "term": term,
    }
    url = f"https://itunes.apple.com/search?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "music-server"})
    try:
        _last_call_time = time.time()
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            return json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            log.warning("iTunes rate limit reached (HTTP 429). Backing off.")
            time.sleep(60.0)
        else:
            log.warning("iTunes search HTTP %s: %s", exc.code, exc)
    except Exception as exc:
        log.warning("iTunes search failed for '%s': %s", term, exc)
    return None


def search_itunes_cover(title: str, album: str | None = None, artist: str | None = None) -> bytes | None:
    """Queries iTunes Search API using query priority (album+title, fallback title+artist),
    downloads 600x600 high-resolution artwork, and returns JPEG/PNG bytes."""
    t = title.strip() if title else ""
    al = album.strip() if album and album.strip() else None
    ar = artist.strip() if artist and artist.strip() and artist.strip().lower() != "unknown artist" else None

    queries = []
    # 1. Priority: Album + Title
    if al and t:
        queries.append(f"{_clean_query_term(al)} {_clean_query_term(t)}")
        queries.append(f"{al} {t}")
    # 2. Priority: Title + Artist
    if ar and t:
        queries.append(f"{_clean_query_term(t)} {_clean_query_term(ar)}")
        queries.append(f"{t} {ar}")

    if not queries:
        return None

    results = []
    seen_queries = set()
    for q_term in queries:
        q_norm = " ".join(q_term.lower().split())
        if q_norm in seen_queries:
            continue
        seen_queries.add(q_norm)
        data = _call_itunes_api(q_term)
        if data and data.get("resultCount", 0) > 0 and data.get("results"):
            results = data["results"]
            break

    if not results:
        return None

    art100 = results[0].get("artworkUrl100")
    if not art100:
        return None

    # Replace 100x100 with 600x600 on Apple's CDN
    art600 = re.sub(r"100x100([a-z0-9\-_]*)", r"600x600\1", art100)
    req = urllib.request.Request(art600, headers={"User-Agent": "music-server"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            image_data = resp.read()
            ext = _cover_ext(image_data)
            if ext:
                return image_data
    except Exception as exc:
        log.warning("Could not download iTunes artwork %s: %s", art600, exc)
    return None


def embed_cover_in_file(path: Path, image_bytes: bytes) -> bool:
    """Best-effort embedding of artwork directly into the audio file container on disk."""
    if not path.is_file():
        return False
    ext = path.suffix.lower()
    mime = "image/png" if image_bytes[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    try:
        if ext in (".mp3", ".wav"):
            import mutagen.id3
            try:
                tags = mutagen.id3.ID3(path)
            except mutagen.id3.ID3NoHeaderError:
                tags = mutagen.id3.ID3()
            tags.delall("APIC")
            tags.add(mutagen.id3.APIC(encoding=3, mime=mime, type=3, desc="Cover", data=image_bytes))
            tags.save(path, v2_version=3)
            return True
        elif ext == ".flac":
            import mutagen.flac
            audio = mutagen.flac.FLAC(path)
            pic = mutagen.flac.Picture()
            pic.data = image_bytes
            pic.type = 3
            pic.mime = mime
            audio.clear_pictures()
            audio.add_picture(pic)
            audio.save()
            return True
        elif ext in (".m4a", ".aac"):
            import mutagen.mp4
            audio = mutagen.mp4.MP4(path)
            img_fmt = mutagen.mp4.MP4Cover.FORMAT_PNG if mime == "image/png" else mutagen.mp4.MP4Cover.FORMAT_JPEG
            audio["covr"] = [mutagen.mp4.MP4Cover(image_bytes, imageformat=img_fmt)]
            audio.save()
            return True
        elif ext in (".ogg", ".opus"):
            import mutagen.flac
            import mutagen.oggvorbis
            audio = mutagen.oggvorbis.OggVorbis(path)
            pic = mutagen.flac.Picture()
            pic.data = image_bytes
            pic.type = 3
            pic.mime = mime
            audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode("ascii")]
            audio.save()
            return True
    except (OSError, PermissionError) as exc:
        log.warning("Storage is not writable for embedding cover into %s: %s", path, exc)
    except Exception as exc:
        log.warning("Could not embed cover into %s: %s", path, exc)
    return False


def apply_cover_to_library_track(track_id: int, image_bytes: bytes, owner_id: int, file_path: str) -> str | None:
    """Saves cover file to data/users/<id>/covers/ and updates Track in database."""
    from .access import resolve_file
    from .db import SessionLocal
    from .models import Track

    ext = _cover_ext(image_bytes)
    if not ext:
        return None

    # 1. Embed directly into audio file
    try:
        path = resolve_file(file_path)
        embed_cover_in_file(path, image_bytes)
    except Exception as exc:
        log.warning("Could not embed cover into library track file %s: %s", file_path, exc)

    # 2. Write cover image file for fast web serving
    cover_rel = f"users/{owner_id}/covers/{secrets.token_hex(16)}{ext}"
    cover_final = settings.data_dir / cover_rel
    cover_final.parent.mkdir(parents=True, exist_ok=True)
    cover_final.write_bytes(image_bytes)

    # 3. Update database row
    old_cover = None
    with SessionLocal() as db:
        track = db.get(Track, track_id)
        if track:
            old_cover = track.cover_path
            track.cover_path = cover_rel
            db.commit()

    if old_cover and old_cover != cover_rel:
        try:
            (settings.data_dir / old_cover).resolve().unlink(missing_ok=True)
        except OSError:
            pass

    return cover_rel


def apply_cover_to_server_file(token: str, image_bytes: bytes) -> bool:
    """Embeds cover directly into server file in MUSIC_DIR and clears _index cache."""
    from .library import _index, _index_lock, _path_for, _require_source

    path = _path_for(token)
    if not path or not path.is_file():
        return False

    success = embed_cover_in_file(path, image_bytes)
    try:
        root = _require_source()
        rel = str(path.relative_to(root.resolve()))
        with _index_lock:
            _index.pop(rel, None)
    except Exception:
        pass
    return success


def _worker_loop():
    while True:
        job = _queue.get()
        if job is None:
            break
        key, target_type, target_id, title, album, artist, file_path, owner_id = job
        try:
            if is_miss(key):
                continue
            image_bytes = search_itunes_cover(title, album, artist)
            if image_bytes:
                if target_type == "track" and owner_id and file_path:
                    apply_cover_to_library_track(int(target_id), image_bytes, int(owner_id), file_path)
                    log.info("Cover art fetched and applied for library track %s (%s)", target_id, title)
                elif target_type == "folder":
                    apply_cover_to_server_file(str(target_id), image_bytes)
                    log.info("Cover art fetched and applied for server file %s (%s)", target_id, title)
            else:
                record_miss(key)
        except Exception as exc:
            log.exception("Error in iTunes cover worker for %s: %s", key, exc)
        finally:
            with _queue_lock:
                _pending_keys.discard(key)
            _queue.task_done()


def ensure_worker_started():
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            t = threading.Thread(target=_worker_loop, daemon=True, name="itunes-cover-worker")
            t.start()
            _worker_started = True


def enqueue_cover_fetch(
    target_type: str,
    target_id: int | str,
    title: str,
    album: str | None = None,
    artist: str | None = None,
    file_path: str = "",
    owner_id: int | None = None,
) -> bool:
    """Asynchronously enqueues a track for iTunes cover fetching if not already in negative cache or queue."""
    key = f"{target_type}:{target_id}"
    if is_miss(key):
        return False

    # Check if we have enough metadata to query iTunes (skip if neither album nor known artist)
    has_album = bool(album and album.strip())
    has_artist = bool(artist and artist.strip() and artist.strip().lower() != "unknown artist")
    if not has_album and not has_artist:
        record_miss(key)
        return False

    with _queue_lock:
        if key in _pending_keys:
            return False
        _pending_keys.add(key)

    ensure_worker_started()
    _queue.put((key, target_type, target_id, title, album, artist, file_path, owner_id))
    return True
