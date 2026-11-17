"""Configuración por variables de entorno (se lee también un archivo .env si existe)."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _load_dotenv() -> None:
    for path in (BASE_DIR / ".env", BASE_DIR.parent / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


DATA_PROVIDER = env("DATA_PROVIDER", "seed")  # seed | api_football
# Por defecto una base SQLite distinta por proveedor, para que el seed nunca pise datos reales.
# Para PostgreSQL: DATABASE_URL=postgresql+psycopg://usuario:clave@localhost/betpractice
DATABASE_URL = env("DATABASE_URL", f"sqlite:///{BASE_DIR / f'betpractice_{DATA_PROVIDER}.db'}")

API_FOOTBALL_BASE_URL = env("API_FOOTBALL_BASE_URL", "https://v3.football.api-sports.io")
API_FOOTBALL_TIMEZONE = env("API_FOOTBALL_TIMEZONE", "America/Argentina/Buenos_Aires")
API_FOOTBALL_CACHE_DIR = env("API_FOOTBALL_CACHE_DIR", str(BASE_DIR / ".cache" / "api_football"))
API_FOOTBALL_MIN_DAILY_REMAINING = int(env("API_FOOTBALL_MIN_DAILY_REMAINING", "20"))


def api_football_key() -> str | None:
    """La clave NUNCA va en el código: se lee de la variable de entorno API_FOOTBALL_KEY."""
    return env("API_FOOTBALL_KEY")
