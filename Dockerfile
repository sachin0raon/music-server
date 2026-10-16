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

# ---- Stage 2: Python backend serving API + built frontend ----
FROM python:3.12-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY backend/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /frontend/dist ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Defaults match backend/app/config.py. FORWARDED_ALLOW_IPS is which peers may set
# X-Forwarded-For (read by uvicorn); set it in .env to the proxy's address.
ENV STATIC_DIR=/app/static \
    DATA_DIR=/data \
    FORWARDED_ALLOW_IPS=127.0.0.1

# Run unprivileged. uid/gid 1000 matches the usual first host user, so files the app
# writes into the ./data bind mount stay owned by that user on the host.
RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data \
 && chown -R app:app /data /app \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
