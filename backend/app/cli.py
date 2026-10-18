"""Admin commands, run inside the container:

    docker compose exec music-server python -m app.cli make-admin USERNAME
    docker compose exec music-server python -m app.cli reset-password USERNAME
    docker compose exec music-server python -m app.cli import USERNAME /music [--dry-run]
    docker compose exec music-server python -m app.cli migrate
    docker compose exec music-server python -m app.cli backfill-tags [--dry-run] [--force]
    docker compose exec music-server python -m app.cli backup rename --users 1 2 [--dry-run]
    docker compose exec music-server python -m app.cli backup restore --users 1 2 [--dry-run]
    docker compose exec music-server python -m app.cli backup status [--users 1 2 | --all]
"""
import argparse
import getpass
import json
import re
import sys
from datetime import datetime, timezone
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


# ---------- backup rename / restore / status ----------

MANIFEST_FILENAME = ".rename_manifest.json"


def sanitize_filename(name: str) -> str:
    """Sanitizes original_name to be a safe, single-component filename."""
    # Replace slashes first so names like 'AC/DC' become 'AC_DC' rather than losing 'AC'
    safe = re.sub(r'[/\\]+', '_', name)
    base = Path(safe).name
    # Strip null bytes, control characters, and filesystem-illegal characters
    clean = re.sub(r'[\x00-\x1f:*?"<>|]', '_', base).strip()
    return clean or "track"


def resolve_unique_name(base_name: str, used_names_lower: set[str]) -> str:
    """Resolves duplicate names by appending (1), (2), etc., before the file extension."""
    p = Path(base_name)
    stem = p.stem
    ext = p.suffix
    candidate = f"{stem}{ext}"
    i = 1
    while candidate.lower() in used_names_lower:
        candidate = f"{stem} ({i}){ext}"
        i += 1
    used_names_lower.add(candidate.lower())
    return candidate


def _resolve_user_targets(users: list[int] | None, all_users: bool) -> list[tuple[int, Path]]:
    """Resolves target user IDs and directory paths."""
    users_root = settings.data_dir / "users"
    if all_users:
        if not users_root.is_dir():
            return []
        targets = []
        for p in sorted(users_root.iterdir()):
            if p.is_dir() and p.name.isdigit():
                targets.append((int(p.name), p))
        return targets
    if users:
        return [(uid, users_root / str(uid)) for uid in sorted(set(users))]
    return []


def backup_rename(users: list[int] | None, all_users: bool, dry_run: bool = False) -> int:
    targets = _resolve_user_targets(users, all_users)
    if not targets:
        print("No user directories found to process.")
        return 0

    total_renamed = 0
    with SessionLocal() as db:
        for uid, udir in targets:
            print(f"\n--- Processing User {uid} ({udir}) ---")
            if not udir.is_dir():
                print(f"Directory does not exist: {udir}")
                continue

            manifest_path = udir / MANIFEST_FILENAME
            if manifest_path.exists():
                print(f"Manifest already exists: {manifest_path}")
                print(f"User {uid} is already in BACKUP state. Run 'restore' first before renaming again.")
                continue

            tracks = db.scalars(select(Track).where(Track.owner_id == uid).order_by(Track.id)).all()
            if not tracks:
                print(f"No tracks found in database for user {uid}.")
                continue

            used_names_lower: set[str] = set()
            mappings: list[dict] = []
            missing_files: list[str] = []

            for track in tracks:
                token_path = settings.data_dir / track.file_path
                token_name = token_path.name

                if not token_path.is_file():
                    missing_files.append(f"Track {track.id} ({track.title}): expected at {token_path}")
                    continue

                clean = sanitize_filename(track.original_name)
                # If original_name had no extension, preserve the extension of the token file
                if not Path(clean).suffix:
                    clean = f"{clean}{token_path.suffix}"

                backup_name = resolve_unique_name(clean, used_names_lower)
                mappings.append({
                    "token_name": token_name,
                    "backup_name": backup_name,
                    "track_id": track.id,
                })

            if missing_files:
                print(f"Warning: {len(missing_files)} track files in database were missing on disk:")
                for m in missing_files[:5]:
                    print(f"  - {m}")
                if len(missing_files) > 5:
                    print(f"  ...and {len(missing_files) - 5} more")

            if not mappings:
                print(f"No existing files to rename for user {uid}.")
                continue

            print(f"Planned renames for user {uid} ({len(mappings)} files):")
            for m in mappings:
                print(f"  {m['token_name']}  ->  {m['backup_name']}")

            if dry_run:
                print(f"Dry run: {len(mappings)} files would be renamed for user {uid} (no changes made).")
                continue

            # Write manifest atomically before performing renames
            manifest_data = {
                "version": 1,
                "user_id": uid,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "renamed",
                "files": mappings,
            }
            tmp_manifest = udir / f"{MANIFEST_FILENAME}.tmp"
            with open(tmp_manifest, "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, indent=2)
            tmp_manifest.replace(manifest_path)

            # Rename files on disk
            for m in mappings:
                src = udir / m["token_name"]
                dst = udir / m["backup_name"]
                src.replace(dst)

            print(f"Successfully renamed {len(mappings)} files for user {uid}. Manifest saved to {manifest_path.name}.")
            total_renamed += len(mappings)

    verb = "would be renamed" if dry_run else "renamed"
    print(f"\nDone: {total_renamed} total files {verb}.")
    return 0


def backup_restore(users: list[int] | None, all_users: bool, dry_run: bool = False) -> int:
    targets = _resolve_user_targets(users, all_users)
    if not targets:
        print("No user directories found to process.")
        return 0

    total_restored = 0
    for uid, udir in targets:
        print(f"\n--- Restoring User {uid} ({udir}) ---")
        if not udir.is_dir():
            print(f"Directory does not exist: {udir}")
            continue

        manifest_path = udir / MANIFEST_FILENAME
        if not manifest_path.is_file():
            print(f"No manifest found ({manifest_path.name}). User {uid} is already in NORMAL state.")
            continue

        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            print(f"Error reading manifest {manifest_path}: {exc}")
            continue

        files = data.get("files", [])
        if not files:
            print(f"Manifest for user {uid} contains no file records. Removing empty manifest.")
            if not dry_run:
                manifest_path.unlink(missing_ok=True)
            continue

        print(f"Planned restore for user {uid} ({len(files)} files):")
        restore_plan: list[tuple[Path, Path]] = []
        for m in files:
            token_name = m["token_name"]
            backup_name = m["backup_name"]
            src = udir / backup_name
            dst = udir / token_name

            if src.is_file():
                print(f"  {backup_name}  ->  {token_name}")
                restore_plan.append((src, dst))
            elif dst.is_file():
                print(f"  {token_name} is already restored (skipping)")
            else:
                print(f"  Warning: Neither {backup_name} nor {token_name} exists on disk!")

        if dry_run:
            print(f"Dry run: {len(restore_plan)} files would be restored for user {uid} (no changes made).")
            continue

        for src, dst in restore_plan:
            src.replace(dst)

        manifest_path.unlink(missing_ok=True)
        print(f"Successfully restored {len(restore_plan)} files for user {uid}. Manifest removed.")
        total_restored += len(restore_plan)

    verb = "would be restored" if dry_run else "restored"
    print(f"\nDone: {total_restored} total files {verb}.")
    return 0


def backup_status(users: list[int] | None, all_users: bool) -> int:
    # If neither --users nor --all is specified, default to all users
    if not users and not all_users:
        all_users = True

    targets = _resolve_user_targets(users, all_users)
    if not targets:
        print("No user directories found.")
        return 0

    print(f"{'User ID':<10} {'State':<12} {'Files':<10} {'Details'}")
    print("-" * 65)

    for uid, udir in targets:
        if not udir.is_dir():
            print(f"{uid:<10} {'MISSING':<12} {'-':<10} Directory does not exist")
            continue

        manifest_path = udir / MANIFEST_FILENAME
        audio_files = [p for p in udir.iterdir() if p.is_file() and not p.name.startswith(".")]

        if manifest_path.is_file():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                created = data.get("created_at", "unknown date")
                count = len(data.get("files", []))
                print(f"{uid:<10} {'BACKUP':<12} {count:<10} Renamed at {created}")
            except Exception as exc:
                print(f"{uid:<10} {'ERROR':<12} {'-':<10} Corrupt manifest ({exc})")
        else:
            print(f"{uid:<10} {'NORMAL':<12} {len(audio_files):<10} Stored with hex token names")

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

    # backup
    bp = sub.add_parser("backup", help="toggle files between token names and original names for backup")
    bp_sub = bp.add_subparsers(dest="backup_cmd", required=True)

    for action, desc in [
        ("rename", "rename files from token names to original human-readable names"),
        ("restore", "rename files from original human-readable names back to token names"),
        ("status", "show backup state of user directories"),
    ]:
        p = bp_sub.add_parser(action, help=desc)
        group = p.add_mutually_exclusive_group(required=(action != "status"))
        group.add_argument("--users", nargs="+", type=int, help="one or more user IDs to target")
        group.add_argument("--all", action="store_true", help="target all user directories in data/users/")
        if action != "status":
            p.add_argument("--dry-run", action="store_true", help="simulate changes without touching files")

    args = parser.parse_args()
    if args.cmd == "make-admin":
        return make_admin(args.username)
    if args.cmd == "reset-password":
        return reset_password(args.username)
    if args.cmd == "migrate":
        return migrate()
    if args.cmd == "backfill-tags":
        return backfill_tags(args.dry_run, args.force)
    if args.cmd == "backup":
        if args.backup_cmd == "rename":
            return backup_rename(args.users, args.all, args.dry_run)
        if args.backup_cmd == "restore":
            return backup_restore(args.users, args.all, args.dry_run)
        if args.backup_cmd == "status":
            return backup_status(args.users, args.all)
    return import_music(args.username, args.folder, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
