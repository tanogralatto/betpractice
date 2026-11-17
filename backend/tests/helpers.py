from datetime import datetime, timedelta

from app.domain import Goal, MatchData

_BASE = datetime(2025, 1, 1, 15, 0)
_ids = iter(range(1, 100000))


def mk(home, away, ft=(1, 0), ht=(1, 0), day=0, league=1, season=1, goals=None, corners=(5, 4), status="FT", mid=None):
    hg, ag = ft
    if goals is None:
        goals = []
        for side, n_ht, n_ft in (("home", ht[0], ft[0]), ("away", ht[1], ft[1])):
            goals += [Goal(20 + i, side, 1) for i in range(n_ht)]
            goals += [Goal(60 + i, side, 2) for i in range(n_ft - n_ht)]
    return MatchData(
        id=mid or next(_ids), league_id=league, season_id=season, kickoff=_BASE + timedelta(days=day),
        home_id=home, away_id=away, status=status, hg=hg if status == "FT" else None,
        ag=ag if status == "FT" else None, hthg=ht[0] if status == "FT" else None,
        htag=ht[1] if status == "FT" else None, goals=goals if status == "FT" else [],
        home_corners=corners[0], away_corners=corners[1],
    )
