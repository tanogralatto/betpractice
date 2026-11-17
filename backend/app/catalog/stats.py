"""Catálogo de estadísticas promediables (fácil de extender: agregar un StatDef)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.domain import MatchData


@dataclass(frozen=True)
class StatDef:
    key: str
    name: str
    value: Callable[[MatchData, int], float | None]  # (partido, equipo) -> valor

    def as_dict(self) -> dict:
        return {"key": self.key, "name": self.name}


def _sum(a, b):
    return None if a is None or b is None else a + b


STATS: list[StatDef] = [
    StatDef("goals_total", "Goles totales", lambda m, t: m.total),
    StatDef("goals_for", "Goles a favor", lambda m, t: m.gf(t)),
    StatDef("goals_against", "Goles en contra", lambda m, t: m.ga(t)),
    StatDef("goals_ht_total", "Goles 1er tiempo", lambda m, t: m.ht_total),
    StatDef("corners", "Corners (partido)", lambda m, t: m.total_corners),
    StatDef("shots", "Tiros totales (partido)", lambda m, t: _sum(m.home_shots, m.away_shots)),
    StatDef("shots_on_target", "Tiros al arco (partido)", lambda m, t: _sum(m.home_sot, m.away_sot)),
    StatDef("dangerous_attacks", "Ataques peligrosos (equipo)", lambda m, t: m.stat_for(t, "dangerous")),
    StatDef("yellow_cards", "Tarjetas amarillas (partido)", lambda m, t: _sum(m.home_yellow, m.away_yellow)),
]

STATS_BY_KEY = {s.key: s for s in STATS}
