"""Proveedores de datos.

La app SIEMPRE lee de la base de datos. Un proveedor solo se usa para llenarla:
- `seed`: datos de prueba generados (desarrollo y tests). Ver `app/seed.py`.
- `api_football`: API-Football v3 (api-sports.io). Ver `app/providers/api_football.py`.

Se elige con la variable de entorno DATA_PROVIDER.
"""
from app.providers.base import DataProvider


def get_provider(name: str | None = None) -> DataProvider:
    from app.config import DATA_PROVIDER

    name = name or DATA_PROVIDER
    if name == "api_football":
        from app.providers.api_football import ApiFootballProvider

        return ApiFootballProvider.from_env()
    if name == "seed":
        from app.providers.seed import SeedProvider

        return SeedProvider()
    if name == "sportmonks":
        from app.providers.sportmonks import SportmonksProvider

        return SportmonksProvider()
    raise ValueError(f"DATA_PROVIDER desconocido: {name!r} (usar seed o api_football)")
