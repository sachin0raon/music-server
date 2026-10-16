"""Admin commands, run inside the container:

    docker compose exec music-server python -m app.cli make-admin USERNAME
    docker compose exec music-server python -m app.cli reset-password USERNAME
    docker compose exec music-server python -m app.cli import USERNAME /music [--dry-run]
    docker compose exec music-server python -m app.cli migrate
    docker compose exec music-server python -m app.cli backfill-tags [--dry-run] [--force]
"""
import argparse
import getpass
import sys
from pathlib import Path

from sqlalchemy import delete, select

from .config import settings
from .db import SessionLocal, engine
from .models import Session as LoginSession
from .models import Track, User
from .schema import ensure_columns
from .security import hash_password
from .tracks import ALLOWED_EXT, FileUpload, _process, _read_meta, walk_files


# ---------- migrate ----------

def migrate() -> int:
    """Adds model columns missing from existing tables (same check as startup).

    Only needed to apply a schema change without restarting the app.
    Idempotent: safe to run any number of times.
    """
    added = ensure_columns(engine)
    if not added:
        print("Nothing to migrate: all model columns already exist.")
        return 0
    for table, col in added:
        print(f"Added {table}.{col}")
    print("Migration complete. Run `backfill-tags` if the update also extracts new metadata.")
    return 0


# ---------- backfill-tags ----------

# The metadata fields _read_meta extracts beyond the core title/artist/album/duration
META_FIELDS = ("bitrate", "sample_rate", "channels", "format", "year", "genre",
               "track_number", "disc_number", "composer")


def backfill_tags(dry_run: bool = False, force: bool = False) -> int:
    """Re-reads file tags and fills the audio-metadata columns for existing tracks.

    By default only empty values are filled, so re-running after a partial
    failure never loses data. `--force` overwrites existing values too.
    """
    with SessionLocal() as db:
        tracks = db.scalars(select(Track).order_by(Track.id)).all()
        print(f"Reading tags for {len(tracks)} tracks.")
        updated = skipped = failed = 0
        for i, track in enumerate(tracks, 1):
            try:
                path = (settings.data_dir / track.file_path).resolve()
                if settings.data_dir.resolve() not in path.parents or not path.is_file():
                    raise OSError("file missing")
                meta = _read_meta(path, track.title)
            except (OSError, ValueError) as exc:
                failed += 1
                print(f"[{i}/{len(tracks)}] failed   {track.id}: {track.title} ({exc})", flush=True)
                continue
            except Exception as exc:  # a tag parsing surprise must not stop the whole run
                failed += 1
                print(f"[{i}/{len(tracks)}] failed   {track.id}: {track.title} ({type(exc).__name__}: {exc})", flush=True)
                continue
            changes = {}
            for f in META_FIELDS:
                new = meta.get(f)
                old = getattr(track, f)
                if new is not None and (old is None or force):
                    changes[f] = new
            if not changes:
                skipped += 1
                continue
            if not dry_run:
                for f, v in changes.items():
                    setattr(track, f, v)
                db.commit()
            updated += 1
            note = ", ".join(sorted(changes))
            print(f"[{i}/{len(tracks)}] {'would update' if dry_run else 'updated':<14} {track.id}: {track.title} ({note})", flush=True)
        verb = "Would update" if dry_run else "Updated"
        print(f"\n{verb} {updated}, already complete {skipped}, failed {failed}.")
        if dry_run:
            print("Dry run: nothing was changed.")
    return 0


# ---------- reset-password ----------

def reset_password(username: str) -> int:
    pw = getpass.getpass("New password (min 5 chars): ")
    if len(pw) < 5:
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

        everything = list(walk_files(root))
        audio = [p for p in everything if p.suffix.lower() in ALLOWED_EXT]
        print(f"Found {len(audio)} audio files in {root} ({len(everything) - len(audio)} other files ignored).")
        if dry_run or not audio:
            if dry_run:
                print("Dry run: nothing was imported.")
            return 0

        limit = settings.max_import_mb * 1024 * 1024  # the web upload limit does not apply to imports
        counts = {"ok": 0, "duplicate": 0, "error": 0}
        failures = []
        try:
            for i, path in enumerate(audio, 1):
                rel = path.relative_to(root)
                try:
                    with open(path, "rb") as fh:
                        res = _process(FileUpload(path.name, fh), user, db, max_bytes=limit)
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
    sub.add_parser("migrate", help="add missing database columns after an update")
    bf = sub.add_parser("backfill-tags", help="re-read file tags and fill audio metadata for existing tracks")
    bf.add_argument("--dry-run", action="store_true", help="show what would change without writing")
    bf.add_argument("--force", action="store_true", help="overwrite existing values, not just empty ones")
    args = parser.parse_args()
    if args.cmd == "make-admin":
        return make_admin(args.username)
    if args.cmd == "reset-password":
        return reset_password(args.username)
    if args.cmd == "migrate":
        return migrate()
    if args.cmd == "backfill-tags":
        return backfill_tags(args.dry_run, args.force)
    return import_music(args.username, args.folder, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
