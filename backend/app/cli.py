"""Admin commands, run inside the container:

    docker compose exec music-server python -m app.cli make-admin USERNAME
    docker compose exec music-server python -m app.cli reset-password USERNAME
    docker compose exec music-server python -m app.cli import USERNAME /music [--dry-run]
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

from sqlalchemy import delete, select

from .config import settings
from .db import SessionLocal
from .models import Session as LoginSession
from .models import User
from .security import hash_password
from .tracks import ALLOWED_EXT, _process


# ---------- reset-password ----------

def reset_password(username: str) -> int:
    pw = getpass.getpass("New password (min 8 chars): ")
    if len(pw) < 8:
        print("Password too short.")
        return 1
    if pw != getpass.getpass("Repeat password: "):
        print("Passwords do not match.")
        return 1
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            print(f"No such user: {username}")
            return 1
        user.password_hash = hash_password(pw)
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        db.commit()
    print(f"Password reset for {username}. All their sessions were signed out.")
    return 0


# ---------- make-admin ----------

def make_admin(username: str) -> int:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            print(f"No such user: {username}")
            return 1
        user.is_admin = True
        db.commit()
    print(f"Granted administrator privileges to {username}.")
    return 0


# ---------- import ----------

class _FileUpload:
    """Looks enough like an uploaded file for the normal upload pipeline to process it."""
    def __init__(self, name: str, fh):
        self.filename = name
        self.file = fh


def _walk(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))  # skip hidden folders
        for name in sorted(filenames):
            if not name.startswith("."):
                yield Path(dirpath) / name


def import_music(username: str, folder: str, dry_run: bool = False) -> int:
    root = Path(folder)
    if not root.is_dir():
        print(f"Not a folder: {folder}")
        print("Is it mounted into the container? See the README, section 'Importing an existing folder'.")
        return 1

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            print(f"No such user: {username}. Register the account in the app first.")
            return 1

        everything = list(_walk(root))
        audio = [p for p in everything if p.suffix.lower() in ALLOWED_EXT]
        print(f"Found {len(audio)} audio files in {root} ({len(everything) - len(audio)} other files ignored).")
        if dry_run or not audio:
            if dry_run:
                print("Dry run: nothing was imported.")
            return 0

        settings.max_upload_mb = 4096  # the web upload limit doesn't apply to imports
        counts = {"ok": 0, "duplicate": 0, "error": 0}
        failures = []
        try:
            for i, path in enumerate(audio, 1):
                rel = path.relative_to(root)
                try:
                    with open(path, "rb") as fh:
                        res = _process(_FileUpload(path.name, fh), user, db)
                except OSError as exc:
                    res = {"status": "error", "detail": exc.strerror or str(exc)}
                counts[res["status"]] += 1
                label = {"ok": "added", "duplicate": "skipped", "error": "failed"}[res["status"]]
                detail = "already in the library" if res["status"] == "duplicate" else res.get("detail")
                note = f"  ({detail})" if res["status"] != "ok" and detail else ""
                print(f"[{i}/{len(audio)}] {label:<8} {rel}{note}", flush=True)
                if res["status"] == "error":
                    failures.append((rel, res.get("detail")))
        except KeyboardInterrupt:
            print("\nStopped early. Run the same command again to continue; finished tracks are skipped.")

    print(f"\nAdded {counts['ok']}, skipped {counts['duplicate']} already in the library, {counts['error']} failed.")
    for rel, detail in failures[:20]:
        print(f"  failed: {rel}: {detail}")
    if len(failures) > 20:
        print(f"  ...and {len(failures) - 20} more")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    ma = sub.add_parser("make-admin", help="grant administrator privileges to a user")
    ma.add_argument("username")
    rp = sub.add_parser("reset-password", help="set a new password for a user")
    rp.add_argument("username")
    im = sub.add_parser("import", help="add a folder of music files to a user's library")
    im.add_argument("username")
    im.add_argument("folder")
    im.add_argument("--dry-run", action="store_true", help="count files without importing")
    args = parser.parse_args()
    if args.cmd == "make-admin":
        return make_admin(args.username)
    if args.cmd == "reset-password":
        return reset_password(args.username)
    return import_music(args.username, args.folder, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
