import base64
import hashlib
import hmac
import json
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()

# Verified against when a username doesn't exist, so response time doesn't reveal it
DUMMY_HASH = _ph.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    # Only this hash is stored, so a database leak can't be replayed as cookies
    return hashlib.sha256(token.encode()).hexdigest()


# ---- signed payloads ----
#
# Different in kind from the session tokens above. Those are opaque and random,
# and the server stores a hash to recognise them. These carry their own
# contents and prove them with a signature, so nothing has to be stored and
# nothing has to be cleaned up -- at the cost of being unrevokable before they
# expire, which is why the lifetime is the thing worth being careful about.


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(body: str) -> str:
    from .config import settings  # imported here: config reads the environment
    return _b64(hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).digest())


def sign_payload(data: dict, ttl_seconds: int) -> tuple[str, int]:
    """A token carrying `data` and an expiry, and the expiry itself."""
    expires = int(time.time()) + ttl_seconds
    body = _b64(json.dumps({**data, "exp": expires}, separators=(",", ":"), sort_keys=True).encode())
    return f"{body}.{_mac(body)}", expires


def verify_payload(token: str) -> dict | None:
    """The data a token carries, or None if it is forged, damaged or expired."""
    body, _, mac = (token or "").partition(".")
    if not body or not mac:
        return None
    # Constant time: a comparison that stops at the first wrong byte tells an
    # attacker how much of a guess was right.
    if not hmac.compare_digest(mac, _mac(body)):
        return None
    try:
        data = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("exp"), int):
        return None
    if data["exp"] < time.time():
        return None
    return data
