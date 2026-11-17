"""Sportmonks: pendiente. Implementar la interfaz `DataProvider` igual que api_football."""
from __future__ import annotations

from app.providers.base import DataProvider


class SportmonksProvider(DataProvider):
    name = "sportmonks"

    def _na(self, *_a, **_k):
        raise NotImplementedError("Proveedor Sportmonks todavía no implementado.")

    get_leagues = get_teams = get_fixtures = get_fixtures_by_date = get_fixture_details = get_odds = _na
