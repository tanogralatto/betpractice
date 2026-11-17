"""Catálogo de rachas. Cada racha es una condición evaluada desde la perspectiva de un equipo."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.domain import MatchData, result_char


@dataclass(frozen=True)
class StreakDef:
    key: str
    name: str
    check: Callable[[MatchData, int], bool]

    def as_dict(self) -> dict:
        return {"key": self.key, "name": self.name}


def _ft(m, t):
    return result_char(m.gf(t), m.ga(t))


def _ht(m, t):
    return result_char(m.ht_gf(t), m.ht_ga(t))


STREAKS: list[StreakDef] = [
    StreakDef("win_ft", "Gana", lambda m, t: _ft(m, t) == "W"),
    StreakDef("draw_ft", "Empata", lambda m, t: _ft(m, t) == "D"),
    StreakDef("lose_ft", "Pierde", lambda m, t: _ft(m, t) == "L"),
    StreakDef("win_ht", "Gana 1T", lambda m, t: _ht(m, t) == "W"),
    StreakDef("draw_ht", "Empata 1T", lambda m, t: _ht(m, t) == "D"),
    StreakDef("lose_ht", "Pierde 1T", lambda m, t: _ht(m, t) == "L"),
    StreakDef("no_win", "Sin ganar", lambda m, t: _ft(m, t) != "W"),
    StreakDef("no_lose", "Sin perder", lambda m, t: _ft(m, t) != "L"),
    StreakDef("no_draw", "Sin empatar", lambda m, t: _ft(m, t) != "D"),
]

for _i in range(5):
    _l = _i + 0.5
    _s = f"{_l:.1f}"
    _k = _s.replace(".", "_")
    STREAKS.append(StreakDef(f"over_{_k}", f"Over {_s}", lambda m, t, l=_l: m.total > l))
    STREAKS.append(StreakDef(f"under_{_k}", f"Under {_s}", lambda m, t, l=_l: m.total < l))
for _l in (0.5, 1.5, 2.5):
    _s = f"{_l:.1f}"
    _k = _s.replace(".", "_")
    STREAKS.append(StreakDef(f"ht_over_{_k}", f"HT Over {_s}", lambda m, t, l=_l: m.ht_total > l))
    STREAKS.append(StreakDef(f"ht_under_{_k}", f"HT Under {_s}", lambda m, t, l=_l: m.ht_total < l))

STREAKS += [
    StreakDef("btts_yes", "Ambos marcan Sí", lambda m, t: m.hg > 0 and m.ag > 0),
    StreakDef("btts_no", "Ambos marcan No", lambda m, t: not (m.hg > 0 and m.ag > 0)),
    StreakDef("clean_sheet_yes", "Valla invicta Sí", lambda m, t: m.ga(t) == 0),
    StreakDef("clean_sheet_no", "Valla invicta No", lambda m, t: m.ga(t) > 0),
    StreakDef("win_to_nil_yes", "Gana sin recibir Sí", lambda m, t: m.gf(t) > 0 and m.ga(t) == 0),
    StreakDef("win_to_nil_no", "Gana sin recibir No", lambda m, t: not (m.gf(t) > 0 and m.ga(t) == 0)),
]

STREAKS_BY_KEY = {s.key: s for s in STREAKS}
