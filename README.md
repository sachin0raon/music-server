# Music Server

A self-hosted, multi-user music streaming server with a mobile-friendly web player.

Each user has a private library. Users can upload their own files, share a track with everyone on the server, build playlists, and listen from any browser.

- **Backend:** Python (FastAPI) with MySQL for data and plain files on disk for audio
- **Frontend:** React (Vite) with Tailwind v4, a dark "glass" design
- **Packaging:** one Docker container (works on ARM64, so a Raspberry Pi 5 or a cloud server)
- **Reverse proxy:** designed to sit behind Nginx Proxy Manager (HTTPS)

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Nginx Proxy Manager](#nginx-proxy-manager)
5. [Install on your phone or computer](#install-on-your-phone-or-computer)
6. [Accounts and admin](#accounts-and-admin)
7. [Sharing, deleting and playlists: the rules](#sharing-deleting-and-playlists-the-rules)
8. [Uploading music](#uploading-music)
9. [Importing an existing folder](#importing-an-existing-folder)
10. [How it works](#how-it-works)
11. [API overview](#api-overview)
12. [Backups and updates](#backups-and-updates)
13. [Troubleshooting](#troubleshooting)
14. [Known limits](#known-limits)
15. [Development](#development)

---

## Features

- Separate, isolated library per user
- Upload many files at once, with per-file progress and clear results (added, duplicate, failed)
- Share a track so everyone on the server can play it (a common "Shared" tab); unshare at any time
- Playlists, private to each user, which can include your own tracks and shared ones
- Search across your tracks and shared tracks (title, artist, album)
- Streaming with seeking, and a full Now playing screen with cover art
- Installable as an app on phones and computers, with lock-screen and media-key controls
- Reads title, artist, album, duration and embedded cover art from the files' tags
- Admin tools: list users, reset passwords (in the app or from the command line)
- Import an existing music folder from the command line
- Supported formats: **mp3, flac, m4a, ogg, opus, wav**

---

## Quick start

You need Docker with Compose, and a running MySQL (or MariaDB) server that the container can reach by host and port.

### 1. Create the database and user

```sql
CREATE DATABASE musicapp CHARACTER SET utf8mb4;
CREATE USER 'musicapp'@'%' IDENTIFIED BY 'your-password';
GRANT ALL ON musicapp.* TO 'musicapp'@'%';
```

The user must be allowed to connect from the Docker host or network, which is why the example uses `'%'`. Tighten it if you like.

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in the MySQL details and a secret key (generate one with `openssl rand -hex 32`). See [Configuration](#configuration).

### 3. Start

```bash
docker compose up -d --build
```

Tables are created automatically on first start.

### 4. Check it

Open `http://<host>:8000`. If you are testing over plain HTTP, set `COOKIE_SECURE=false` in `.env` first (see [Troubleshooting](#troubleshooting)).

`http://<host>:8000/api/health` should report the database as connected.

### 5. Create your account and grant admin rights

Register your account in the web app (e.g. username `admin`). New accounts are regular users by default.

To grant administrator privileges to your account, run either:

**Option A: Via SQL (in MySQL)**
```sql
UPDATE users SET is_admin = 1 WHERE username = 'admin';
```

**Option B: Via CLI (in Docker)**
```bash
docker compose exec music-server python -m app.cli make-admin admin
```
*(For local development outside Docker, run `python -m app.cli make-admin admin` inside `backend/`)*

Refresh the page or sign back in to access Admin tools in the **Account** tab.

### 6. Put it behind HTTPS

See [Nginx Proxy Manager](#nginx-proxy-manager).

---

## Configuration

All settings are environment variables, normally set in `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `MYSQL_HOST` | required | MySQL host. `host.docker.internal` reaches MySQL running on the Docker host (the compose file maps it). Otherwise use an IP or hostname |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_USER` | required | Database user |
| `MYSQL_PASSWORD` | required | Database password |
| `MYSQL_DATABASE` | required | Database name |
| `SECRET_KEY` | required | Must be set. Login sessions currently use random tokens stored in the database, so the key is reserved for future use. Set it to a long random value anyway |
| `COOKIE_SECURE` | `true` | Keep `true` behind HTTPS. Set `false` only when testing over plain `http://` |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Address of your reverse proxy, as the container sees it. Only it is trusted to say who the real client is. See [Nginx Proxy Manager](#nginx-proxy-manager) |
| `SESSION_DAYS` | `30` | How long a login lasts |
| `MAX_UPLOAD_MB` | `200` | Largest single file accepted by the web upload. Keep Nginx Proxy Manager's limit at least this large |
| `DATA_DIR` | `/data` | Where files are stored inside the container (mounted from `./data`) |
| `STATIC_DIR` | `/app/static` | The built web app. You normally never change this |

The compose file publishes port **8000** and mounts `./data` to `/data`.

---

## Nginx Proxy Manager

Create a Proxy Host:

- **Forward host / port:** the machine running the container, port `8000`
- **SSL tab:** request a certificate and enable *Force SSL*
- **Advanced tab:** add the following

```nginx
client_max_body_size 200M;
proxy_buffering off;
proxy_request_buffering off;
```

Why these matter:

- `client_max_body_size` is the whole upload request. The default is small and will break uploads (the app shows "Larger than the server allows"). Keep it at least `MAX_UPLOAD_MB`.
- Not buffering responses keeps audio seeking smooth.

Other notes:

- The login and registration rate limits count by client address. The container only believes `X-Forwarded-For` from the address in `FORWARDED_ALLOW_IPS`, so set it to your proxy's address (for a proxy on the Docker host that is usually the bridge gateway, such as `172.17.0.1`).
- If it is wrong or unset, nothing breaks, but every user looks like the proxy and shares one rate limit: 10 failed logins from anyone lock out everyone for 15 minutes. To find the address, check the client address in `docker compose logs`: while the proxy isn't trusted it shows the proxy's own address.
- **Do not also expose port 8000 to the internet.** Otherwise someone could fake the address and dodge the rate limits. If the proxy runs on the same machine, bind the port to localhost in `docker-compose.yml`: `"127.0.0.1:8000:8000"`.

---

## Install on your phone or computer

The web app can be installed so it opens full screen from your home screen or dock, like a normal app.

- **Needs HTTPS.** Browsers only offer installing on secure sites, so set up [Nginx Proxy Manager](#nginx-proxy-manager) with a certificate first. Plain `http://` still works for using the site, just not for installing it.
- **Android (Chrome):** open Account in the app and tap **Install**, or use the browser menu, then *Install app*.
- **iPhone and iPad (Safari):** tap the Share button, then **Add to Home Screen**. Account shows a reminder.
- **Desktop (Chrome, Edge):** use the install icon in the address bar, or the **Install** button on the Account page.

### Lock screen and media keys

While music plays, the lock screen, notification shade, car and Bluetooth displays, and keyboard media keys show the title, artist, album and cover art, with play, pause, previous, next and a seek bar. The browser tab title also shows what is playing. This works in the browser as well as the installed app.

### What is cached on the device

Only the app itself (pages, scripts, fonts and icons) is cached so it starts quickly and opens even when the server is briefly unreachable. **Music, cover art and anything from your library are never cached.** Offline, you get the app shell with error messages, not offline listening.

Updates reach devices on their next open: the app shell is always checked against the server first.

---

## Accounts and admin

### Creating accounts

- Registration is **open**: anyone who can reach the site can create an account (see [Known limits](#known-limits)).
- No email is collected.
- Usernames are 3 to 32 characters: letters, numbers, dots, dashes and underscores. They are case-insensitive, so `Sam` and `sam` cannot both exist.
- Passwords are 5 to 128 characters and are stored hashed (argon2).
- New accounts are never admins.

### Making a user an admin

New registrations are regular non-admin accounts by default. You can promote an account to admin using SQL or the CLI, or create an admin account directly.

#### Method 1: Promote an existing user via SQL (Recommended)
Register the user via the web interface first, then execute this query in your MySQL database:

```sql
UPDATE users SET is_admin = 1 WHERE username = 'USERNAME';
```

#### Method 2: Promote an existing user via CLI
From the host machine running Docker Compose:

```bash
docker compose exec music-server python -m app.cli make-admin USERNAME
```

*(Or locally outside Docker: `python -m app.cli make-admin USERNAME` inside `backend/`)*

#### Method 3: Insert an admin user directly via SQL
Because the server authenticates passwords using **Argon2id**, standard MySQL hash functions (`MD5`, `SHA2`) cannot be used. To insert an admin user directly:

1. Generate an Argon2 password hash:
   ```bash
   python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('YOUR_PASSWORD'))"
   ```
2. Insert into the `users` table:
   ```sql
   INSERT INTO users (username, password_hash, is_admin, created_at)
   VALUES ('admin', '<GENERATED_ARGON2_HASH>', 1, NOW());
   ```

### Sessions and security

- Login uses a random token in an HttpOnly, SameSite=Lax cookie (Secure by default), valid for `SESSION_DAYS`. Only a hash of the token is stored in the database.
- Failed logins are limited to **10 per 15 minutes per address**, and registrations to **5 per hour per address**. These limits are in memory, so they reset when the container restarts.
- Unknown usernames and wrong passwords return the same error, with similar timing.
- Changing your password signs out your other devices.

### Forgotten passwords

With no email there is no "forgot password" link. Instead:

- **In the app:** the admin opens Account, finds the person under *People on this server*, and chooses *Reset password*. That person is signed out everywhere.
- **From the command line**, for example if the admin is locked out:

```bash
docker compose exec music-server python -m app.cli reset-password USERNAME
```

### What admins can and cannot do

- Can: list users and reset any user's password.
- Cannot: delete or change other people's tracks. Only a track's owner can do that.

---

## Sharing, deleting and playlists: the rules

### Who can see a track

A track is visible to a user only if they **own it or it is shared**. Everything goes through that one rule: listings, search, details, audio and cover art. A track you cannot see looks exactly like one that does not exist, so ids cannot be probed.

### Sharing

- Sharing is a flag on the track, not a copy. The file stays in the owner's folder.
- Shared tracks appear in everyone's **Shared** tab, labelled "shared by <owner>".
- Everyone can play a shared track and add it to their own playlists.
- **Only the owner can unshare or delete it.** Other users do not see those options, and the server refuses the request (403) even if called directly.

### Unsharing

- It takes effect instantly for everyone.
- The track disappears from other people's Shared tab, and quietly drops out of their playlists and playlist counts.
- If the owner shares it again, it comes back in its old playlist position.
- A track someone is currently playing is skipped when it next fails to load.

### Deleting

- Deleting removes the track **for everyone**: the database row, the audio file, the cover art file, and its entries in every playlist.
- The app asks for confirmation first, and warns when the track is shared.
- It cannot be undone.

### Playlists

- Playlists are private to the user who made them.
- They can contain your own tracks and shared tracks, but never someone else's private tracks.
- Tracks play in the order they were added. Reordering is not built.
- Deleting a playlist never deletes tracks.

---

## Uploading music

Open Library, then the **+** button.

- Choose files or drop them on the page. Several at once is fine, and files upload one at a time with their own progress.
- Accepted types: mp3, flac, m4a, ogg, opus, wav.
- Each file gets its own result:
  - **Added**
  - **Already in your library**: duplicates are detected by file content, per user. The same song uploaded by a different user is fine.
  - **Failed**, with the reason: unsupported type, empty file, not readable as audio, or larger than the size limit.
- One bad file never stops the rest.
- Title, artist, album and duration come from the tags. Missing tags fall back to the file name and "Unknown Artist".
- Embedded cover art (jpg or png, up to 8 MB) is extracted when present.
- Uploads are private until you share them.

Files are stored under server-generated names, never the original file name, so odd names cannot cause harm.

---

## Importing an existing folder

For music you already have on the machine. Files are **copied** into the server's own storage, so the music uses disk space twice. Your folder is mounted read-only and is never changed.

1. In `docker-compose.yml`, uncomment the `/music:ro` volume and set the left side to your folder, for example:

   ```yaml
   - /mnt/storage/music:/music:ro
   ```

   Then run `docker compose up -d`.

2. Register the account that should own the music in the app first.

3. Preview, then import:

   ```bash
   docker compose exec music-server python -m app.cli import YOUR_USERNAME /music --dry-run
   docker compose exec music-server python -m app.cli import YOUR_USERNAME /music
   ```

How it behaves:

- Subfolders are included. Hidden files and folders (names starting with a dot) are skipped.
- It prints one line per file (`added`, `skipped` or `failed` with the reason) and a summary. Failures are listed with their paths.
- Safe to re-run: anything already in that user's library is skipped, so you can add files to the folder and run it again. Ctrl+C stops it, and running it again continues.
- The web upload size limit does not apply. The import allows files up to 4 GB.
- Imported tracks are private to that user until shared.
- Each user can import the same folder into their own library and gets their own private copies.
- A large folder takes a while, since each file is hashed, read and copied.

---

## How it works

### One container

A single Python process serves three things: the API under `/api`, the audio streams, and the built web app. MySQL holds users, sessions, tracks and playlists. Audio and cover files live on disk.

### Storage layout

```
data/
  users/<user id>/<random>.mp3        audio files, named by the server
  users/<user id>/covers/<random>.jpg cover art
  shared/                             created but unused: sharing is a flag, files never move
  tmp/                                half-finished uploads, cleared on every start
```

Paths stored in the database are relative to the data folder and are never sent to the browser. Any stored path that points outside the data folder is refused.

### Streaming

Audio is served as the original file with HTTP range support, which is what makes seeking and phone buffering work. There is **no transcoding**. Audio responses are cached privately for an hour and cover art for a day.

### Database

Tables (`users`, `sessions`, `tracks`, `playlists`, `playlist_tracks`) are created automatically on startup, and existing tables are never dropped. On startup the app also **adds any column that a newer version introduces** (nullable or with a default), so an update never needs a manual migration step. Renames, type changes, drops and new indexes on existing tables are still manual and are noted with the update that needs them.

Two commands cover the rest:

```bash
docker compose exec music-server python -m app.cli migrate                    # the same column check, run by hand instead of restarting
docker compose exec music-server python -m app.cli backfill-tags [--dry-run]  # re-read file tags for tracks already in the library
```

`backfill-tags` fills the audio metadata columns (bitrate, sample rate, channels, format, year, genre, track and disc number, composer) for existing rows. It only fills empty values, so it is safe to re-run; `--force` overwrites existing values too. New uploads and imports get this metadata automatically, so the command is only needed once after updating a library that was added before that metadata was stored.

If adding a column fails — the database user lacks `ALTER` rights, for example — startup stops with the column name and the reason instead of running with an out-of-date schema. Grant `ALTER` on the database and start again.

### Caching and headers

- Build files (under `/assets/`) have unique names and are cached for a year.
- The app page, `sw.js` and the manifest are always revalidated, so updates are picked up.
- The API is never given a static cache header.
- Every response carries basic protective headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`).

### The web app

- Screens: sign in or create account, Library (My music and Shared tabs, latest upload card), Search, Playlists, Upload, Account (change password, admin tools)
- A persistent mini player, plus a full Now playing screen whose background glow follows the cover's colours
- Mobile-first with a bottom navigation bar, and a sidebar on wide screens
- Loading, empty and error states on every list
- Fonts are self-hosted (Geist), so nothing loads from outside
- Installable (PWA), with a small service worker for the app shell only (`frontend/public/sw.js`)
- The single accent colour is one variable, `--color-accent` in `frontend/src/index.css`

### Project layout

```
backend/app/
  main.py        app setup, health check, serves the web app
  config.py      environment settings
  db.py          MySQL connection
  models.py      database tables
  security.py    password hashing, session tokens
  ratelimit.py   login and registration limits
  auth.py        register, login, logout, change password, admin routes
  access.py      the single "who can see this track" rule
  tracks.py      upload, list, details, stream, cover, share, delete
  playlists.py   playlists
  cli.py         reset-password and import commands
frontend/src/    the React app (components/MediaSessionBridge.jsx drives lock-screen controls)
frontend/public/ manifest, icons and the service worker, served from the site root
Dockerfile       builds the web app, then the Python image
docker-compose.yml
.env.example
```

---

## API overview

All endpoints except register, login and health need a signed-in session. Interactive docs are at `/docs`.

| Method and path | What it does |
|---|---|
| `GET /api/health` | Checks the database connection |
| `POST /api/auth/register` | Create an account and sign in |
| `POST /api/auth/login`, `POST /api/auth/logout` | Sign in and out |
| `GET /api/auth/me` | Who am I |
| `POST /api/auth/change-password` | Change your password and sign out other devices |
| `GET /api/admin/users` | List users (admin) |
| `POST /api/admin/users/{id}/reset-password` | Reset a password (admin) |
| `POST /api/tracks` | Upload one or more files (form field `files`) |
| `GET /api/tracks?scope=mine\|shared\|all&q=&limit=&offset=` | List and search |
| `GET /api/tracks/{id}` | Track details, including audio metadata (bitrate, sample rate, channels, format, year, genre, track and disc number, composer, file size) |
| `GET /api/tracks/{id}/stream` | Audio, with range support |
| `GET /api/tracks/{id}/cover` | Cover art |
| `PUT /api/tracks/{id}/share` with `{"shared": true\|false}` | Share or unshare (owner) |
| `DELETE /api/tracks/{id}` | Delete (owner) |
| `GET`, `POST /api/playlists` | List and create playlists |
| `GET`, `PATCH`, `DELETE /api/playlists/{id}` | Open, rename, delete |
| `POST /api/playlists/{id}/tracks` with `{"track_id": n}` | Add a track |
| `DELETE /api/playlists/{id}/tracks/{track_id}` | Remove a track |

---

## Backups and updates

**Back up both of these together:**

1. The MySQL database
2. The `./data` folder

Either one alone is not enough: the database lists the tracks, and the folder holds the files.

**Update:**

```bash
docker compose up -d --build
```

New tables and columns are created automatically on startup, so restarting is all an update needs. If the release notes mention new metadata read from your files, run `backfill-tags` once (see Database above).

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Login seems to do nothing over `http://` | The cookie is marked Secure and browsers drop it on plain HTTP. Set `COOKIE_SECURE=false` while testing, then set it back to `true` behind HTTPS |
| Uploads fail with "Larger than the server allows" | Nginx Proxy Manager's `client_max_body_size` is too small. See [Nginx Proxy Manager](#nginx-proxy-manager) |
| A file fails with "too large" | It is over `MAX_UPLOAD_MB`. Raise it (and the proxy limit), or use the [import command](#importing-an-existing-folder) |
| Seeking jumps or is slow | Response buffering is on in the proxy. Add `proxy_buffering off;` |
| `/api/health` says the database is unavailable | Check `MYSQL_HOST` and `MYSQL_PORT`, that the MySQL user may connect from the container's address, and any firewall |
| "Too many attempts" | The rate limit was hit. Wait 15 minutes, or restart the container |
| Import says "Not a folder" | The folder is not mounted into the container. Check the `/music:ro` line in `docker-compose.yml` |
| Import says "No such user" | Register that account in the app first |
| Playback does not start on a phone | Browsers require a tap to start audio. Tap the play button |
| No Install option appears | Needs HTTPS, and the app must not already be installed. On iPhone use Share, then Add to Home Screen. Some browsers only offer it after you have used the site for a moment |
| An old version keeps showing | Close and reopen the app. If it persists, do a hard refresh or clear the site's data once. The service worker is always rechecked, so this is rare |
| Lock-screen controls missing | Controls appear once something has played, and need a browser that supports media sessions (all current Chrome, Edge, Safari and Firefox do) |
| Cover art missing | The file has no embedded cover, or it is not jpg or png. A coloured placeholder is shown instead |

Container logs: `docker compose logs -f music-server`.

---

## Known limits and not yet built

**By choice:**

- **Open registration with no quotas.** Anyone who can reach the site can sign up and upload, so they can fill your disk or upload content you would then be hosting. There is also no setting to turn registration off. If the server is reachable from the internet, restrict access (for example with an access list in Nginx Proxy Manager or a VPN). Quotas and approval for new accounts are the natural next step.
- No email, so no emailed password resets.
- No automated tests. Testing is manual (checklist below).
- Playlists cannot be reordered.
- No transcoding, so a phone on a slow connection streams the original file.
- Admins cannot delete other users' tracks.
- Import copies files rather than reading them in place.

**Worth knowing:**

- **Not offline music.** The installed app opens without the server, but nothing plays until it is reachable.
- **Locked-screen autoplay.** The lock-screen controls work, but whether the *next* track starts by itself while the phone stays locked depends on the browser and phone, and I could not test that on real devices. If it stops between tracks on your phone, the next-track button on the lock screen still works.
- No keyboard shortcuts in the app itself. Media keys work through the browser.

---

## Development

**Backend**

```bash
cd backend
pip install -r requirements.txt
# set the same environment variables as in .env, then:
uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev     # proxies /api to http://localhost:8000
```

**Manual test checklist**

- **Isolation:** with two accounts, confirm A cannot see or stream B's private tracks (including by guessing a track URL), and that shared tracks show up for both.
- **Share and unshare:** toggle sharing and confirm it takes effect immediately for the other user.
- **Upload:** try a normal file, a corrupt file, a very large FLAC and a multi-file batch.
- **Playback:** check seeking and background play on a phone browser through Nginx Proxy Manager.
- **Delete:** confirm the file, cover art and playlist entries are all removed.
