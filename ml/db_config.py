"""Database URL for ML scripts — reads backend/.env (DB_URL) when python-dotenv is available."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse, urlsplit, urlunsplit

_REPO_ROOT = Path(__file__).resolve().parent.parent
_BACKEND_ENV = _REPO_ROOT / "backend" / ".env"


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    if _BACKEND_ENV.is_file():
        load_dotenv(_BACKEND_ENV, override=True)


_load_dotenv()


def _normalize_db_url(url: str) -> str:
    """Prefer 127.0.0.1 over localhost so libpq/psycopg2 do not resolve to ::1 first."""
    if not url:
        return url
    parts = urlsplit(url)
    if parts.hostname not in ("localhost", "::1"):
        return url
    port = f":{parts.port}" if parts.port else ""
    if parts.username is not None:
        auth = parts.username
        if parts.password is not None:
            auth += ":" + parts.password
        auth += "@"
    else:
        auth = ""
    netloc = f"{auth}127.0.0.1{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def get_db_url() -> str:
    url = (os.getenv("DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    if not url:
        url = "postgresql://marketplace_user:marketplace_pass@127.0.0.1:5432/marketplace"
    return _normalize_db_url(url)


def get_jwt_secret() -> str:
    """Same HS256 signing secret the Deno auth service uses (backend/.env JWT_SECRET)."""
    secret = (os.getenv("JWT_SECRET") or "").strip()
    if not secret or secret == "your-super-secret-key-change-this":
        raise RuntimeError(
            "JWT_SECRET is not set (or is still the .env.example placeholder). "
            "Set a real random value in backend/.env before starting this service."
        )
    return secret


ROLE_MISSING_HINT = """
PostgreSQL answered on {host_port}, but this server has no role "marketplace_user".

On macOS, port 5432 is often owned by Homebrew Postgres, while this project expects either:

  • Docker Postgres (docker compose) — stop Homebrew first if 5432 is busy:
      brew services list
      brew services stop postgresql    # or postgresql@16 / postgresql@14 etc.
      docker compose up -d postgres

  • Or create the role on whatever server is listening:
      psql -d postgres -f database/scripts/create_local_marketplace_role.sql

  • Or set DB_URL in backend/.env to a user/database that already exists.

Env: {env_path}
""".strip()


def print_role_missing_hint(exc: BaseException) -> None:
    raw = str(exc).lower()
    if "does not exist" not in raw or "role" not in raw:
        return
    p = urlparse(get_db_url())
    host = p.hostname or "?"
    port = p.port or 5432
    env_note = str(_BACKEND_ENV) if _BACKEND_ENV.is_file() else f"{_BACKEND_ENV} (file not found — defaults only)"
    print(ROLE_MISSING_HINT.format(host_port=f"{host}:{port}", env_path=env_note))


SCHEMA_MISSING_HINT = """
The database exists but tables are missing (e.g. "order_items"). Apply migrations from the repo root:

  ./database/apply-migrations.sh

Or manually (same DB as DB_URL in backend/.env):

  psql "$DB_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_init.sql
  psql "$DB_URL" -f database/migrations/002_seed.sql

Docker Postgres (from repo root):

  docker exec -i marketplace_db psql -U marketplace_user -d marketplace -v ON_ERROR_STOP=1 < database/migrations/001_init.sql
  docker exec -i marketplace_db psql -U marketplace_user -d marketplace < database/migrations/002_seed.sql

(If 001_init.sql fails because tables already exist, you only need seed — or use a new DB volume.)

Repository: {repo_root}
""".strip()


def print_schema_missing_hint(exc: BaseException) -> None:
    raw = str(exc).lower()
    if "does not exist" not in raw:
        return
    if "relation" not in raw and "undefinedtable" not in raw:
        return
    print(SCHEMA_MISSING_HINT.format(repo_root=str(_REPO_ROOT)))


def print_db_hints(exc: BaseException) -> None:
    """Walk the exception chain and print role / migration hints."""
    seen: set[int] = set()
    e: BaseException | None = exc
    for _ in range(8):
        if e is None or id(e) in seen:
            break
        seen.add(id(e))
        print_role_missing_hint(e)
        print_schema_missing_hint(e)
        nxt = getattr(e, "__cause__", None) or getattr(e, "__context__", None)
        if getattr(e, "orig", None) is not None:
            print_role_missing_hint(e.orig)
            print_schema_missing_hint(e.orig)
        e = nxt


def get_psycopg2_kwargs() -> dict:
    p = urlparse(get_db_url())
    db = (p.path or "/marketplace").lstrip("/") or "marketplace"
    return {
        "host": p.hostname or "127.0.0.1",
        "port": p.port or 5432,
        "database": db,
        "user": p.username or "marketplace_user",
        "password": p.password or "",
    }
