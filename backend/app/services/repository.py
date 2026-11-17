"""Carga de datos desde la base a objetos de dominio (con caché en memoria)."""
from __future__ import annotations

import threading
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain import Goal, MatchData
from app.models import GoalEvent, Match, Season
from app.services.analysis import History

STAT_COLS = ("home_corners", "away_corners", "home_shots", "away_shots", "home_sot", "away_sot",
             "home_dangerous", "away_dangerous", "home_yellow", "away_yellow")

_lock = threading.Lock()
_cache: dict = {"key": None, "history": None}


def to_domain(m: Match, goals: list[Goal] | None = None) -> MatchData:
    return MatchData(
        id=m.id, league_id=m.league_id, season_id=m.season_id, kickoff=m.kickoff,
        home_id=m.home_id, away_id=m.away_id, status=m.status, hg=m.hg, ag=m.ag, hthg=m.hthg, htag=m.htag,
        goals=goals or [], **{c: getattr(m, c) for c in STAT_COLS},
    )


def season_order(db: Session) -> dict[int, list[int]]:
    out: dict[int, list[int]] = defaultdict(list)
    for s in db.scalars(select(Season).order_by(Season.league_id, Season.year)):
        out[s.league_id].append(s.id)
    return dict(out)


def load_history(db: Session) -> History:
    """Todos los partidos terminados, indexados. Se cachea hasta que cambien los datos."""
    key = db.execute(select(func.count(Match.id), func.max(Match.updated_at), func.max(Match.id),
                            func.count(GoalEvent.id).label("g")).select_from(Match)
                     .outerjoin(GoalEvent, GoalEvent.match_id == Match.id)
                     .where(Match.status == "FT")).one()
    key = tuple(key) + (db.scalar(select(func.count(Season.id))),)
    with _lock:
        if _cache["key"] == key and _cache["history"] is not None:
            return _cache["history"]
    goals: dict[int, list[Goal]] = defaultdict(list)
    for mid, minute, side, half in db.execute(select(GoalEvent.match_id, GoalEvent.minute, GoalEvent.side, GoalEvent.half)):
        goals[mid].append(Goal(minute, side, half))
    cols = [Match.id, Match.league_id, Match.season_id, Match.kickoff, Match.home_id, Match.away_id, Match.status,
            Match.hg, Match.ag, Match.hthg, Match.htag] + [getattr(Match, c) for c in STAT_COLS]
    matches = []
    for r in db.execute(select(*cols).where(Match.status == "FT", Match.hthg.is_not(None))):
        matches.append(MatchData(
            id=r[0], league_id=r[1], season_id=r[2], kickoff=r[3], home_id=r[4], away_id=r[5], status=r[6],
            hg=r[7], ag=r[8], hthg=r[9], htag=r[10], goals=goals.get(r[0], []),
            **dict(zip(STAT_COLS, r[11:])),
        ))
    h = History(matches, season_order(db))
    with _lock:
        _cache.update(key=key, history=h)
    return h
