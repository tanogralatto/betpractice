"""Motor de cálculo: muestras, cuota real, PPG, promedios de estadísticas y rachas.

Todo es puro (sin base de datos) y opera sobre `History`, un índice en memoria
de partidos terminados.
"""
from __future__ import annotations

from bisect import bisect_left
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from app.catalog.markets import Market
from app.catalog.stats import StatDef
from app.catalog.streaks import StreakDef
from app.domain import MatchData

SAMPLE_MODES = ("last_8", "current", "current_plus_1", "current_plus_2", "current_plus_3")
ROLES = ("home", "away", "both", "ignore")


class History:
    """Índice de partidos terminados por (competición, equipo), ordenados por fecha."""

    def __init__(self, matches: Iterable[MatchData], season_order: dict[int, list[int]]):
        """`season_order`: por competición, ids de temporada de la más vieja a la más nueva."""
        self.season_order = season_order
        self._by_team: dict[tuple[int, int], list[MatchData]] = defaultdict(list)
        for m in matches:
            if not m.finished:
                continue
            self._by_team[(m.league_id, m.home_id)].append(m)
            self._by_team[(m.league_id, m.away_id)].append(m)
        self._keys: dict[tuple[int, int], list[datetime]] = {}
        for k, lst in self._by_team.items():
            lst.sort(key=lambda m: (m.kickoff, m.id))
            self._keys[k] = [m.kickoff for m in lst]

    def season_window(self, league_id: int, season_id: int, extra: int) -> set[int]:
        """Temporada del partido + `extra` temporadas anteriores de la misma competición."""
        order = self.season_order.get(league_id, [])
        if season_id not in order:
            return {season_id}
        i = order.index(season_id)
        return set(order[max(0, i - extra): i + 1])

    def team_matches(
        self,
        league_id: int,
        team_id: int,
        before: datetime,
        role: str,
        seasons: set[int] | None = None,
        limit: int | None = None,
    ) -> list[MatchData]:
        """Partidos terminados del equipo en la competición, anteriores a `before`,
        filtrados por rol, del más reciente al más viejo."""
        if role == "ignore":
            return []
        lst = self._by_team.get((league_id, team_id), [])
        cut = bisect_left(self._keys.get((league_id, team_id), []), before)
        out: list[MatchData] = []
        for m in reversed(lst[:cut]):
            if seasons is not None and m.season_id not in seasons:
                continue
            if role == "home" and m.home_id != team_id:
                continue
            if role == "away" and m.away_id != team_id:
                continue
            out.append(m)
            if limit is not None and len(out) >= limit:
                break
        return out


def _mode_window(history: History, match: MatchData, mode: str) -> tuple[set[int] | None, int | None]:
    if mode == "last_8":
        return None, 8
    if mode == "current":
        return history.season_window(match.league_id, match.season_id, 0), None
    if mode.startswith("current_plus_"):
        return history.season_window(match.league_id, match.season_id, int(mode.rsplit("_", 1)[1])), None
    raise ValueError(f"Muestra desconocida: {mode}")


def _seasons_extra(seasons: str) -> int:
    return {"current": 0, "current_plus_1": 1, "current_plus_2": 2, "current_plus_3": 3}[seasons]


# ---------------------------------------------------------------------------
# Cuota real
# ---------------------------------------------------------------------------
@dataclass
class RealOddsSample:
    home: list[MatchData]
    away: list[MatchData]
    merged: list[MatchData]  # unión sin duplicados, del más reciente al más viejo

    @property
    def n(self) -> int:
        return len(self.merged)


def real_odds_sample(history: History, match: MatchData, sample: str, home_as: str, away_as: str) -> RealOddsSample:
    seasons, limit = _mode_window(history, match, sample)
    home = history.team_matches(match.league_id, match.home_id, match.kickoff, home_as, seasons, limit)
    away = history.team_matches(match.league_id, match.away_id, match.kickoff, away_as, seasons, limit)
    seen: dict[int, MatchData] = {}
    for m in home + away:  # unión + quitar duplicados por id (si se enfrentaron cuenta una vez)
        seen.setdefault(m.id, m)
    merged = sorted(seen.values(), key=lambda m: (m.kickoff, m.id), reverse=True)
    return RealOddsSample(home, away, merged)


@dataclass
class RealOdds:
    odds: float | None
    prob: float | None
    hits: int
    n: int


def real_odds(sample: list[MatchData], market: Market) -> RealOdds:
    n = len(sample)
    if n == 0:
        return RealOdds(None, None, 0, 0)
    hits = sum(1 for m in sample if market.check(m))
    p = hits / n
    return RealOdds(1 / p if p > 0 else None, p, hits, n)


def value_pct(book_odds: float | None, real: float | None) -> float | None:
    """Valor % = cuota de la casa / cuota real − 1 (en porcentaje)."""
    if book_odds is None or real is None:
        return None
    return (book_odds / real - 1) * 100


# ---------------------------------------------------------------------------
# PPG
# ---------------------------------------------------------------------------
def points(m: MatchData, team_id: int) -> int:
    gf, ga = m.gf(team_id), m.ga(team_id)
    return 3 if gf > ga else (1 if gf == ga else 0)


def ppg(history: History, match: MatchData, team_id: int, role: str) -> tuple[float | None, int]:
    """PPG = (3·G + E) / PJ, temporada actual, partidos anteriores al partido."""
    seasons = history.season_window(match.league_id, match.season_id, 0)
    ms = history.team_matches(match.league_id, team_id, match.kickoff, role, seasons)
    if not ms:
        return None, 0
    return sum(points(m, team_id) for m in ms) / len(ms), len(ms)


# ---------------------------------------------------------------------------
# Estadísticas
# ---------------------------------------------------------------------------
def team_stat(history: History, match: MatchData, team_id: int, role: str, seasons: str, stat: StatDef) -> tuple[float | None, int]:
    window = history.season_window(match.league_id, match.season_id, _seasons_extra(seasons))
    ms = history.team_matches(match.league_id, team_id, match.kickoff, role, window)
    vals = [v for v in (stat.value(m, team_id) for m in ms) if v is not None]
    if not vals:
        return None, 0
    return sum(vals) / len(vals), len(vals)


def avg_of(a: float | None, b: float | None) -> float | None:
    if a is None and b is None:
        return None
    if a is None:
        return b
    if b is None:
        return a
    return (a + b) / 2


# ---------------------------------------------------------------------------
# Rachas
# ---------------------------------------------------------------------------
def streak_length(matches_desc: list[MatchData], team_id: int, streak: StreakDef) -> int:
    n = 0
    for m in matches_desc:
        if not streak.check(m, team_id):
            break
        n += 1
    return n


def streak_max(matches_desc: list[MatchData], team_id: int, streak: StreakDef) -> int:
    """Racha más larga dentro de los partidos dados (incluye la actual)."""
    best = n = 0
    for m in matches_desc:
        n = n + 1 if streak.check(m, team_id) else 0
        best = max(best, n)
    return best


def team_streak_max(history: History, match: MatchData, team_id: int, role: str, seasons: str, streak: StreakDef) -> int:
    window = history.season_window(match.league_id, match.season_id, _seasons_extra(seasons))
    ms = history.team_matches(match.league_id, team_id, match.kickoff, role, window)
    return streak_max(ms, team_id, streak)


def team_streak(history: History, match: MatchData, team_id: int, role: str, seasons: str, streak: StreakDef) -> int:
    window = history.season_window(match.league_id, match.season_id, _seasons_extra(seasons))
    ms = history.team_matches(match.league_id, team_id, match.kickoff, role, window)
    return streak_length(ms, team_id, streak)
