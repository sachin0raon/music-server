"""Uploading a video to Telegram, through the user's own account.

Nothing here keeps a connection open between requests except the one case
that genuinely needs it: the middle of a phone-number login, where Telegram's
code is tied to the specific connection that requested it. Everything else --
fetching chats, uploading a file -- connects fresh and disconnects when done,
the same way medialink.py builds a throwaway YoutubeDL per job rather than
keeping one resident.

session_string is a live Telegram login: full account control, not the
single-site access cookies.txt grants. Stored plaintext anyway, by the same
call as cookies.txt -- whoever reaches the database already reaches
everything else on this server -- but it is a materially larger thing to
leak, and that is worth saying once rather than treating as equivalent.
"""

import logging
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .access import resolve_file
from .auth import current_user
from .db import get_db
from .models import TelegramAccount, User, Video

log = logging.getLogger("telegram")

router = APIRouter(prefix="/api/telegram", tags=["telegram"])

# Matches the TTL already used for jobs and the probe cache elsewhere: one
# idea of "how long something unfinished is allowed to sit around" rather than
# a new number invented for this feature.
PENDING_LOGIN_TTL_SECONDS = 10 * 60
JOB_TTL_SECONDS = 30 * 60

# Approximate: Telegram's per-file ceiling for an ordinary account versus a
# Premium one. Not independently verified against a live account in this
# session -- there is no Telegram account reachable from this environment --
# so this is a courtesy refusal, not an authority. Telegram's own rejection is
# the real backstop if these numbers are wrong.
SIZE_CEILING_FREE = 2000 * 1024 * 1024
SIZE_CEILING_PREMIUM = 4000 * 1024 * 1024

_upload_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="telegram")


# ---------- errors ----------

def _explain(exc: Exception) -> str:
    """Telegram's error, turned into something worth reading.

    FloodWait carries a wait time that is the one thing actually worth saying
    differently -- everything else is shown close to as Telegram sent it,
    since these are protocol-level errors a generic rewrite would only blur.
    """
    from pyrogram.errors import FloodWait

    if isinstance(exc, FloodWait):
        return f"Telegram asked to wait {exc.seconds}s before trying again."
    return str(exc) or type(exc).__name__


# ---------- pending logins ----------
#
# The one place in this feature that holds a live connection across requests.
# Telegram's confirmation code is bound to the connection that requested it --
# a fresh Client later cannot redeem a code sent to a different one -- so the
# connected-but-unauthenticated Client has to live somewhere between the
# browser's "send code" and "enter code" requests. In-memory, behind a lock,
# with a TTL sweep: the same shape as medialink.py's job registry and probe
# cache, not a new idea.

@dataclass
class PendingLogin:
    client: object
    owner_id: int
    phone_number: str
    phone_code_hash: str
    created_at: float = field(default_factory=time.monotonic)


_pending: dict[str, PendingLogin] = {}
_pending_lock = threading.Lock()


def _sweep_pending() -> None:
    cutoff = time.monotonic() - PENDING_LOGIN_TTL_SECONDS
    for token in [t for t, p in _pending.items() if p.created_at < cutoff]:
        stale = _pending.pop(token)
        _disconnect_quietly(stale.client)


def _disconnect_quietly(client) -> None:
    """Best-effort: a pending login being swept or replaced must not leak a
    socket, but a failure to close one is not worth surfacing to anyone."""
    import asyncio
    try:
        asyncio.run(client.disconnect())
    except Exception as exc:  # noqa: BLE001 -- genuinely don't care why
        log.debug("Disconnecting an abandoned Telegram client: %s", exc)


def _drop_pending_for(owner_id: int) -> None:
    """Replacing rather than accumulating: a second 'send code' click, or a
    second browser tab, must not leave the first half-open client connected
    forever alongside the new one."""
    with _pending_lock:
        for token in [t for t, p in _pending.items() if p.owner_id == owner_id]:
            stale = _pending.pop(token)
            _disconnect_quietly(stale.client)


# ---------- upload jobs ----------
#
# Deliberately not shared with medialink._jobs: a separate registry per
# feature module is the pattern downloads.py/videos.py already follow, and
# this one has its own worker pool besides.

@dataclass
class Job:
    id: str
    owner_id: int
    video_id: int
    state: str = "queued"  # queued | uploading | done | error
    percent: float = 0.0
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
                "id": self.id, "video_id": self.video_id, "state": self.state,
                "percent": round(self.percent, 1), "error": self.error,
            }


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
    if job is None or job.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Not found")
    return job


# ---------- request bodies ----------

class LoginStartBody(BaseModel):
    api_id: int
    api_hash: str = Field(min_length=1, max_length=64)
    phone_number: str = Field(min_length=1, max_length=32)


class LoginCodeBody(BaseModel):
    token: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=32)


class LoginPasswordBody(BaseModel):
    token: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class TargetBody(BaseModel):
    chat_id: int
    title: str = Field(min_length=1, max_length=255)
    type: str = Field(pattern="^(channel|group|saved)$")


class UploadBody(BaseModel):
    video_id: int


# ---------- account status ----------

def _account_for(db: DbSession, owner_id: int) -> TelegramAccount | None:
    return db.scalar(select(TelegramAccount).where(TelegramAccount.owner_id == owner_id))


def _status_out(account: TelegramAccount | None) -> dict:
    if account is None:
        return {
            "is_connected": False, "has_session": False, "phone_number": None,
            "target_chat_id": None, "target_chat_title": None, "target_chat_type": None,
        }
    return {
        "is_connected": account.is_connected,
        "has_session": bool(account.session_string),
        "phone_number": account.phone_number,
        "target_chat_id": account.target_chat_id,
        "target_chat_title": account.target_chat_title,
        "target_chat_type": account.target_chat_type,
    }


@router.get("/account")
def get_account(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    return _status_out(_account_for(db, user.id))


# ---------- login ----------

@router.post("/login/start")
def login_start(body: LoginStartBody, user: User = Depends(current_user)):
    """Connects and requests a code. The connection stays open, held in
    _pending, because Telegram ties the code to it."""
    from pyrogram import Client
    from pyrogram.errors import RPCError

    _drop_pending_for(user.id)

    client = Client(f"pending-{user.id}", api_id=body.api_id, api_hash=body.api_hash, in_memory=True)
    _async(client.connect())
    try:
        sent = _async(client.send_phone_number_code(body.phone_number))
    except RPCError as exc:
        _disconnect_quietly(client)
        raise HTTPException(status_code=400, detail=_explain(exc)) from exc

    token = secrets.token_urlsafe(24)
    with _pending_lock:
        _sweep_pending()
        _pending[token] = PendingLogin(
            client=client, owner_id=user.id, phone_number=body.phone_number,
            phone_code_hash=sent.phone_code_hash,
        )
    return {"token": token}


def _async(coro):
    """Runs one coroutine to completion. Each request handler and each worker
    thread gets its own throwaway loop -- there is no shared asyncio runtime
    to coordinate with, since FastAPI's own loop never touches these calls
    directly (they run via Depends-free, plain sync route functions)."""
    import asyncio
    return asyncio.run(coro)


def _take_pending(token: str, owner_id: int) -> PendingLogin:
    with _pending_lock:
        _sweep_pending()
        entry = _pending.get(token)
    if entry is None or entry.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="That login has expired. Start again.")
    return entry


def _finish_login(token: str, entry: PendingLogin, api_id: int, api_hash: str,
                   db: DbSession, owner_id: int) -> dict:
    session_string = _async(entry.client.export_session_string())
    _disconnect_quietly(entry.client)
    with _pending_lock:
        _pending.pop(token, None)

    account = _account_for(db, owner_id)
    if account is None:
        account = TelegramAccount(owner_id=owner_id)
        db.add(account)
    account.api_id = api_id
    account.api_hash = api_hash
    account.phone_number = entry.phone_number
    account.session_string = session_string
    account.is_connected = True
    # A fresh login may be a different account entirely; a target chosen
    # under the old one would otherwise silently carry over.
    account.target_chat_id = None
    account.target_chat_title = None
    account.target_chat_type = None
    db.commit()
    return _status_out(account)


@router.post("/login/code")
def login_code(body: LoginCodeBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    from pyrogram.errors import RPCError, SessionPasswordNeeded

    entry = _take_pending(body.token, user.id)
    try:
        _async(entry.client.sign_in(entry.phone_number, entry.phone_code_hash, body.code))
    except SessionPasswordNeeded:
        # The pending entry survives: the same connected client is reused for
        # the password step, and a wrong code does not force restarting the
        # whole phone-number flow.
        return {"status": "password_required"}
    except RPCError as exc:
        raise HTTPException(status_code=400, detail=_explain(exc)) from exc

    return {"status": "done", "account": _finish_login(
        body.token, entry, entry.client.api_id, entry.client.api_hash, db, user.id)}


@router.post("/login/password")
def login_password(body: LoginPasswordBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    from pyrogram.errors import RPCError

    entry = _take_pending(body.token, user.id)
    try:
        _async(entry.client.check_password(body.password))
    except RPCError as exc:
        raise HTTPException(status_code=400, detail=_explain(exc)) from exc

    return {"status": "done", "account": _finish_login(
        body.token, entry, entry.client.api_id, entry.client.api_hash, db, user.id)}


@router.post("/reconnect")
def reconnect(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """A cheap round trip against the stored string, so a transient network
    blip is not mistaken for a dead login and does not touch what is stored."""
    from pyrogram import Client
    from pyrogram.errors import RPCError

    account = _account_for(db, user.id)
    if account is None or not account.session_string:
        raise HTTPException(status_code=400, detail="No Telegram login saved yet.")

    client = Client(f"reconnect-{user.id}", api_id=account.api_id, api_hash=account.api_hash,
                     session_string=account.session_string, in_memory=True)
    try:
        _async(client.connect())
    except RPCError as exc:
        raise HTTPException(status_code=400, detail=f"That login no longer works: {_explain(exc)}") from exc
    finally:
        _disconnect_quietly(client)

    account.is_connected = True
    db.commit()
    return _status_out(account)


@router.post("/disconnect")
def disconnect(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Flips a status flag. Nothing is deleted -- there is no live connection
    to tear down, since nothing in this feature keeps one open."""
    account = _account_for(db, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="Not found")
    account.is_connected = False
    db.commit()
    return _status_out(account)


# ---------- chats ----------

MAX_CHANNEL_CHECKS = 200


def _client_from_account(account: TelegramAccount, name: str):
    from pyrogram import Client
    return Client(name, api_id=account.api_id, api_hash=account.api_hash,
                  session_string=account.session_string, in_memory=True)


def channel_can_post(status, privileges) -> bool:
    """Whether this membership status lets you post in a channel.

    Pulled out as a pure function so the one real decision in the chat list --
    who may post where -- can be checked without a Telegram connection.
    status/privileges are duck-typed against ChatMemberStatus/
    ChatAdministratorRights so a test can pass plain stand-ins.
    """
    from pyrogram.enums import ChatMemberStatus
    if status == ChatMemberStatus.OWNER:
        return True
    return status == ChatMemberStatus.ADMINISTRATOR and bool(privileges) and bool(
        getattr(privileges, "can_post_messages", False))


def classify_chat(chat, me_id: int) -> tuple[str, str] | None:
    """(kind, title) for a dialog's chat if it belongs on the list, else None.

    Only the cases that need no further API call: Saved Messages and
    groups/supergroups. A channel is reported separately by the caller, since
    deciding it needs get_chat_member -- a network call this function cannot
    make and should not pretend to.
    """
    from pyrogram.enums import ChatType
    if chat.id == me_id:
        return ("saved", "Saved Messages")
    if chat.type in (ChatType.GROUP, ChatType.SUPERGROUP):
        return ("group", chat.title)
    return None


@router.get("/chats")
def list_chats(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Channels and groups you can post in, plus Saved Messages.

    A channel needs a membership check -- an ordinary member cannot post in
    one at all, only an owner or an admin with post rights -- capped at
    MAX_CHANNEL_CHECKS so a very large dialog list cannot turn one click into
    hundreds of round trips. A group or supergroup is included on appearing in
    the dialog list at all: leaving or being banned already removes a chat
    from it, so the one gap this accepts is a member explicitly restricted
    from posting while still present -- that case surfaces as a failed
    upload rather than being filtered out upfront.
    """
    from pyrogram.enums import ChatType
    from pyrogram.errors import RPCError

    account = _account_for(db, user.id)
    if account is None or not account.is_connected:
        raise HTTPException(status_code=400, detail="Connect Telegram first.")

    client = _client_from_account(account, f"chats-{user.id}")

    async def run():
        await client.connect()
        try:
            me = await client.get_me()
            out = []
            checked_channels = 0
            async for dialog in client.get_dialogs():
                chat = dialog.chat
                direct = classify_chat(chat, me.id)
                if direct is not None:
                    kind, title = direct
                    out.append({"id": chat.id, "title": title, "type": kind})
                    continue
                if chat.type != ChatType.CHANNEL or checked_channels >= MAX_CHANNEL_CHECKS:
                    continue
                checked_channels += 1
                try:
                    member = await client.get_chat_member(chat.id, "me")
                except RPCError:
                    continue
                if channel_can_post(member.status, member.privileges):
                    out.append({"id": chat.id, "title": chat.title, "type": "channel"})
            return out
        finally:
            await client.disconnect()

    try:
        chats = _async(run())
    except RPCError as exc:
        raise HTTPException(status_code=400, detail=_explain(exc)) from exc
    return {"chats": chats}


@router.post("/target")
def set_target(body: TargetBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Saves directly: the list this came from only ever contained chats
    already confirmed postable, moments earlier. A permission revoked in that
    gap is not guarded against -- the next upload attempt would simply fail
    and say so, the same as a chat left after being set as the target."""
    account = _account_for(db, user.id)
    if account is None or not account.is_connected:
        raise HTTPException(status_code=400, detail="Connect Telegram first.")
    account.target_chat_id = body.chat_id
    account.target_chat_title = body.title
    account.target_chat_type = body.type
    db.commit()
    return _status_out(account)


# ---------- upload ----------

def _link_for(chat_type: str, chat_id: int, message_id: int) -> str | None:
    """A t.me link, or None when one cannot honestly be formed.

    Saved Messages has no shareable link -- it is a private chat with
    yourself. A private channel/group (no public username) still gets the
    internal-id form Telegram's own clients use.
    """
    if chat_type == "saved":
        return None
    internal = str(chat_id)
    if internal.startswith("-100"):
        internal = internal[4:]
    elif internal.startswith("-"):
        internal = internal[1:]
    return f"https://t.me/c/{internal}/{message_id}"


def _run_upload(job: Job, owner_id: int, video_id: int) -> None:
    from pyrogram.errors import RPCError

    try:
        from .db import SessionLocal
        with SessionLocal() as db:
            account = _account_for(db, owner_id)
            video = db.get(Video, video_id)
            # Checked here, not only at the request: a video deleted while the
            # job sat queued must not be treated as a crash.
            if video is None or video.owner_id != owner_id:
                job.set(state="error", error="Video no longer available.", finished_at=time.monotonic())
                return
            if account is None or not account.is_connected:
                job.set(state="error", error="Telegram is not connected.", finished_at=time.monotonic())
                return
            if not account.target_chat_id:
                job.set(state="error", error="No upload target is set.", finished_at=time.monotonic())
                return

            path = resolve_file(video.file_path)
            client = _client_from_account(account, f"upload-{owner_id}")

            def progress(current: int, total: int) -> None:
                if total:
                    job.set(state="uploading", percent=min(99.0, current / total * 100))

            async def run():
                await client.connect()
                try:
                    me = await client.get_me()
                    ceiling = SIZE_CEILING_PREMIUM if me.is_premium else SIZE_CEILING_FREE
                    if video.file_size > ceiling:
                        limit = "4000 MB (Premium)" if me.is_premium else "2000 MB"
                        raise ValueError(f"This video is larger than Telegram's limit for this account (~{limit}).")
                    return await client.send_document(
                        account.target_chat_id, str(path),
                        file_name=Path(video.file_path).name,
                        caption=video.title, progress=progress,
                    )
                finally:
                    await client.disconnect()

            job.set(state="uploading", percent=0.0)
            message = _async(run())

            video.telegram_uploaded_at = datetime.now(timezone.utc)
            video.telegram_chat_title = account.target_chat_title
            video.telegram_chat_id = account.target_chat_id
            video.telegram_chat_type = account.target_chat_type
            video.telegram_message_id = message.id
            db.commit()
            job.set(state="done", percent=100.0, finished_at=time.monotonic())
    except (RPCError, ValueError) as exc:
        log.warning("Telegram upload failed for video %s: %s", video_id, exc)
        job.set(state="error", error=_explain(exc), finished_at=time.monotonic())
    except Exception:
        log.exception("Telegram upload failed for video %s", video_id)
        job.set(state="error", error="Something went wrong during the upload.", finished_at=time.monotonic())


@router.post("/upload")
def start_upload(body: UploadBody, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    account = _account_for(db, user.id)
    if account is None or not account.is_connected or not account.target_chat_id:
        raise HTTPException(status_code=400, detail="Set up Telegram in Account settings first.")
    video = db.get(Video, body.video_id)
    if video is None or video.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Not found")

    job = Job(id=secrets.token_hex(8), owner_id=user.id, video_id=video.id)
    _put_job(job)
    _upload_pool.submit(_run_upload, job, user.id, video.id)
    return job.snapshot()


@router.get("/jobs")
def list_jobs(user: User = Depends(current_user)):
    """Whatever this user still has uploading. Adopted on mount by the Videos
    page, the same reason medialink's job list exists: the id otherwise lives
    only in the tab that started it."""
    with _jobs_lock:
        _sweep_jobs()
        mine = [j for j in _jobs.values() if j.owner_id == user.id]
    return {"jobs": [j.snapshot() for j in mine]}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user: User = Depends(current_user)):
    return _get_job(job_id, user.id).snapshot()
