import os
from pathlib import Path

from dotenv import load_dotenv

# Automatically load .env for local development (checks cwd, backend/.env, and repo root .env)
load_dotenv()
_backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(_backend_dir / ".env")
load_dotenv(_backend_dir.parent / ".env")


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class Settings:
    # MySQL, reached by host and port
    mysql_host: str = _required("MYSQL_HOST")
    mysql_port: int = int(os.getenv("MYSQL_PORT", "3306"))
    mysql_user: str = _required("MYSQL_USER")
    mysql_password: str = _required("MYSQL_PASSWORD")
    mysql_database: str = _required("MYSQL_DATABASE")

    # Files volume
    data_dir: Path = Path(os.getenv("DATA_DIR", "/data"))

    # Sessions
    secret_key: str = _required("SECRET_KEY")
    session_days: int = int(os.getenv("SESSION_DAYS", "30"))
    # Must be "true" behind HTTPS. Set to "false" only for plain-HTTP testing.
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "true").lower() != "false"

    # Upload limit in MB (keep in sync with Nginx Proxy Manager)
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "200"))

    # Built frontend, served by the backend
    static_dir: Path = Path(os.getenv("STATIC_DIR", "/app/static"))


settings = Settings()
