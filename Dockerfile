# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the React frontend ----
FROM node:22-alpine AS frontend
WORKDIR /frontend

# The lockfile is required, not optional: a missing or out-of-sync one should fail the
# build instead of silently resolving a different dependency tree.
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY frontend/ ./
RUN npm run build

# ---- Stage 1b: a JavaScript runtime for yt-dlp ----
# YouTube's player challenge is solved in JavaScript. Without a runtime yt-dlp
# warns that extraction is deprecated and "some formats may be missing" -- and
# missing can mean all of them, which is an empty format list and a link that
# looks unsupported for no stated reason.
#
# deno is the only runtime yt-dlp enables without being told to (js_runtimes
# defaults to {'deno': {}}), and the alternatives cannot come from apt anyway:
# yt-dlp wants node 22+ where Debian ships 18, and a quickjs newer than
# bookworm's. Taken from the official image as a pinned single binary rather
# than curl'ed at build time, so two builds of this commit produce the same
# thing.
FROM denoland/deno:bin-2.9.8 AS deno

# ---- Stage 2: Python backend serving API + built frontend ----
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg is what turns a downloaded stream into something this library accepts:
# Opus arrives inside WebM, which the ingest rejects and mutagen cannot read, so
# it is remuxed. It also writes the tags and artwork, and does the optional MP3
# conversion. Installed before pip so the layer is cached across code changes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Run unprivileged. uid/gid 1000 matches the usual first host user, so files the app
# writes into the ./data bind mount stay owned by that user on the host.
#
# /data is chowned flat rather than -R: it is an empty mount point here, and the
# entrypoint re-checks ownership at startup anyway, which is the only moment a
# bind mount's real owner is knowable. Nothing chowns /app -- the app only reads
# it, PYTHONDONTWRITEBYTECODE keeps Python from trying to write .pyc beside the
# source, and a recursive chown would copy every file into a fresh layer to
# change a bit the process never consults.
RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data \
 && chown app:app /data

# Found on PATH by yt-dlp; nothing in the app references it directly.
COPY --link --from=deno /deno /usr/local/bin/deno

# Above the application code because it changes far less often, so editing a
# view does not reinvalidate it.
COPY --link --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

COPY backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# --link: these layers are built independently of the ones beneath them, so a
# new base image or an earlier layer changing does not force them to be redone.
COPY --link backend/app ./app
COPY --link --from=frontend /frontend/dist ./static

# Defaults match backend/app/config.py. FORWARDED_ALLOW_IPS is which peers may set
# X-Forwarded-For (read by uvicorn); set it in .env to the proxy's address.
ENV STATIC_DIR=/app/static \
    DATA_DIR=/data \
    FORWARDED_ALLOW_IPS=127.0.0.1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
