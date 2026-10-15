from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .db import get_db
from .models import Session as LoginSession
from .models import User
from .ratelimit import RateLimiter
from .security import DUMMY_HASH, hash_password, new_token, token_hash, verify_password

COOKIE = "session"

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

# Failed logins: 10 per 15 min per IP. Registrations: 5 per hour per IP.
login_failures = RateLimiter(limit=10, window_seconds=15 * 60)
registrations = RateLimiter(limit=5, window_seconds=60 * 60)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ---------- schemas ----------

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)


class LoginBody(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class ChangePasswordBody(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ResetPasswordBody(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


def user_out(user: User) -> dict:
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin}


# ---------- sessions ----------

def _start_session(db: DbSession, response: Response, user: User) -> None:
    now = _now()
    db.execute(delete(LoginSession).where(LoginSession.expires_at < now))  # purge expired
    token = new_token()
    db.add(LoginSession(id=token_hash(token), user_id=user.id, expires_at=now + timedelta(days=settings.session_days)))
    db.commit()
    response.set_cookie(
        COOKIE, token,
        max_age=settings.session_days * 86400,
        httponly=True, secure=settings.cookie_secure, samesite="lax", path="/",
    )


def current_user(request: Request, db: DbSession = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    login = db.get(LoginSession, token_hash(token))
    if not login or login.expires_at < _now():
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, login.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ---------- routes ----------

@router.post("/register", status_code=201)
def register(body: Credentials, request: Request, response: Response, db: DbSession = Depends(get_db)):
    ip = _ip(request)
    registrations.check(ip)
    registrations.hit(ip)

    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")
    db.refresh(user)
    _start_session(db, response, user)
    return user_out(user)


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: DbSession = Depends(get_db)):
    ip = _ip(request)
    login_failures.check(ip)

    user = db.scalar(select(User).where(User.username == body.username))
    ok = verify_password(user.password_hash if user else DUMMY_HASH, body.password)
    if not user or not ok:
        login_failures.hit(ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    _start_session(db, response, user)
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(LoginSession).where(LoginSession.id == token_hash(token)))
        db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.post("/change-password", status_code=204)
def change_password(
    body: ChangePasswordBody, request: Request,
    user: User = Depends(current_user), db: DbSession = Depends(get_db),
):
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    # Sign out every other device, keep this one
    keep = token_hash(request.cookies.get(COOKIE, ""))
    db.execute(delete(LoginSession).where(LoginSession.user_id == user.id, LoginSession.id != keep))
    db.commit()


# ---------- admin ----------

@admin_router.get("/users")
def list_users(_: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    users = db.scalars(select(User).order_by(User.id)).all()
    return [{**user_out(u), "created_at": u.created_at} for u in users]


@admin_router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int, body: ResetPasswordBody,
    _: User = Depends(require_admin), db: DbSession = Depends(get_db),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.password_hash = hash_password(body.new_password)
    db.execute(delete(LoginSession).where(LoginSession.user_id == target.id))  # force re-login
    db.commit()
