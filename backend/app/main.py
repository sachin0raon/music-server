import mimetypes

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .config import settings
from .db import engine
from .auth import admin_router, router as auth_router
from .library import router as library_router
from .models import Base
from .playlists import router as playlists_router
from .schema import ensure_columns
from .tracks import router as tracks_router

mimetypes.add_type("application/manifest+json", ".webmanifest")

app = FastAPI(title="Music Server")


@app.middleware("http")
async def headers(request: Request, call_next):
    response = None
    if request.method == "POST" and request.url.path == "/api/tracks":
        # Backstop for a missing proxy limit. Headroom covers multipart overhead; chunked bodies are the proxy's job.
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > (settings.max_upload_mb + 1) * 1024 * 1024:
            response = JSONResponse({"detail": f"Larger than the server allows (max {settings.max_upload_mb} MB)"}, status_code=413)
    if response is None:
        response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):  # hashed build files never change
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith(("/api", "/docs", "/openapi")):  # pages, sw.js, manifest: always revalidate
        response.headers.setdefault("Cache-Control", "no-cache")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(tracks_router)
app.include_router(playlists_router)
app.include_router(library_router)


@app.on_event("startup")
def prepare_storage() -> None:
    # New model columns are added to existing tables here, so updates never need a manual step
    ensure_columns(engine)
    # Creates any missing tables; existing tables and data are left untouched
    Base.metadata.create_all(engine)
    (settings.data_dir / "users").mkdir(parents=True, exist_ok=True)
    (settings.data_dir / "shared").mkdir(parents=True, exist_ok=True)
    # Clear half-finished uploads left by a crash or restart
    tmp = settings.data_dir / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    for leftover in tmp.iterdir():
        if leftover.is_file():
            leftover.unlink(missing_ok=True)


@app.get("/api/health")
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database unavailable: {exc.__class__.__name__}")
    return {"status": "ok", "database": "connected", "data_dir": str(settings.data_dir)}


# Serve the built React app (registered last so /api routes win)
if settings.static_dir.exists():
    assets = settings.static_dir / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        root = settings.static_dir.resolve()
        candidate = root / full_path
        if full_path and candidate.is_file() and root in candidate.resolve().parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html")
