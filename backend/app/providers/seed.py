"""Proveedor `seed`: los datos de prueba se generan directamente en la base con
`python -m app.seed` (no hay API remota que consultar)."""
from __future__ import annotations

from app.providers.base import DataProvider


class SeedProvider(DataProvider):
    name = "seed"

    def _na(self, *_a, **_k):
        raise NotImplementedError("El proveedor seed no consulta APIs: usar `python -m app.seed`.")

    get_leagues = get_teams = get_fixtures = get_fixtures_by_date = get_fixture_details = get_odds = _na
