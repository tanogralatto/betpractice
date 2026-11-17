"""Armado de la tabla de Pre partido."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.catalog.bookmakers import BEST, BOOKMAKER_KEYS
from app.catalog.markets import MARKETS_BY_KEY
from app.catalog.stats import STATS_BY_KEY
from app.catalog.streaks import STREAKS_BY_KEY
from app.models import Match, Odds, UserProfile
from app.services import analysis as A
from app.services.filters import row_passes
from app.services.repository import load_history, to_domain


def get_profile(db: Session, profile_id: int | None) -> UserProfile:
    q = select(UserProfile).options(
        joinedload(UserProfile.real_odds_profile), joinedload(UserProfile.ppg_profile),
        joinedload(UserProfile.stats_profile), joinedload(UserProfile.streaks_profile))
    p = None
    if profile_id:
        p = db.scalar(q.where(UserProfile.id == profile_id))
    if p is None:
        p = db.scalar(q.where(UserProfile.is_active.is_(True)))
    if p is None:
        p = db.scalar(q.order_by(UserProfile.id))
    if p is None:
        raise LookupError("No hay perfiles creados")
    return p


def _r(v, nd=2):
    return None if v is None else round(v, nd)


def odds_map(db: Session, match_ids: list[int]) -> dict[int, dict[str, dict[str, float]]]:
    out: dict[int, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    if not match_ids:
        return out
    for mid, bk, mk, price in db.execute(
            select(Odds.match_id, Odds.bookmaker, Odds.market_key, Odds.price).where(Odds.match_id.in_(match_ids))):
        out[mid][mk][bk] = price
    return out


def book_price(prices: dict[str, float] | None, bookmaker: str) -> tuple[float | None, str | None]:
    if not prices:
        return None, None
    if bookmaker == BEST:
        bk = max(prices, key=prices.get)
        return prices[bk], bk
    p = prices.get(bookmaker)
    return (p, bookmaker) if p is not None else (None, None)


def build_rows(db: Session, matches: list[Match], profile: UserProfile, markets: list[str], stats: list[str],
               streaks: list[str], bookmaker: str) -> list[dict]:
    history = load_history(db)
    omap = odds_map(db, [m.id for m in matches])
    ro, pp, sp, kp = profile.real_odds_profile, profile.ppg_profile, profile.stats_profile, profile.streaks_profile
    rows = []
    for m in matches:
        md = to_domain(m)
        sample = A.real_odds_sample(history, md, ro.sample, ro.home_as, ro.away_as) if ro else A.RealOddsSample([], [], [])
        ppg_h = A.ppg(history, md, m.home_id, pp.home_as if pp else "both")[0]
        ppg_a = A.ppg(history, md, m.away_id, pp.away_as if pp else "both")[0]
        row = {
            "id": m.id,
            "kickoff": m.kickoff.isoformat(),
            "status": m.status,
            "league": {"id": m.league.id, "name": m.league.name, "country": m.league.country,
                       "country_code": m.league.country_code},
            "home": {"id": m.home_id, "name": m.home.name, "ppg": _r(ppg_h)},
            "away": {"id": m.away_id, "name": m.away.name, "ppg": _r(ppg_a)},
            "score": ({"ft": [m.hg, m.ag], "ht": [m.hthg, m.htag]} if m.status in ("FT", "LIVE") and m.hg is not None else None),
            "sample_n": sample.n,
            "sample_home_n": len(sample.home),
            "sample_away_n": len(sample.away),
            "markets": {}, "stats": {}, "streaks": {},
        }
        for mk in markets:
            market = MARKETS_BY_KEY.get(mk)
            if market is None:
                continue
            ro_res = A.real_odds(sample.merged, market)
            price, bk = book_price(omap.get(m.id, {}).get(mk), bookmaker)
            val = A.value_pct(price, ro_res.odds)
            row["markets"][mk] = {"real": _r(ro_res.odds), "prob": _r(ro_res.prob, 4), "hits": ro_res.hits,
                                  "n": ro_res.n, "book": price, "bookmaker": bk, "value": _r(val, 1)}
        for sk in stats:
            st = STATS_BY_KEY.get(sk)
            if st is None or sp is None:
                continue
            h, nh = A.team_stat(history, md, m.home_id, sp.home_as, sp.seasons, st)
            a, na = A.team_stat(history, md, m.away_id, sp.away_as, sp.seasons, st)
            row["stats"][sk] = {"home": _r(h), "away": _r(a), "avg": _r(A.avg_of(h, a)), "n_home": nh, "n_away": na}
        for kk in streaks:
            sd = STREAKS_BY_KEY.get(kk)
            if sd is None or kp is None:
                continue
            row["streaks"][kk] = {
                "home": A.team_streak(history, md, m.home_id, kp.home_as, kp.seasons, sd),
                "away": A.team_streak(history, md, m.away_id, kp.away_as, kp.seasons, sd),
            }
        rows.append(row)
    return rows


SORTS = {
    "time": lambda r: (r["kickoff"], r["league"]["name"]),
    "league": lambda r: (r["league"]["country"], r["league"]["name"], r["kickoff"]),
    "ppg_home": lambda r: (-(r["home"]["ppg"] if r["home"]["ppg"] is not None else -1), r["kickoff"]),
    "ppg_away": lambda r: (-(r["away"]["ppg"] if r["away"]["ppg"] is not None else -1), r["kickoff"]),
}


def day_matches(db: Session, day: date) -> list[Match]:
    start = datetime.combine(day, time(0, 0))
    q = (select(Match).where(Match.kickoff >= start, Match.kickoff < start + timedelta(days=1),
                             Match.status != "CANC")
         .options(joinedload(Match.league), joinedload(Match.home), joinedload(Match.away)))
    return list(db.scalars(q).unique())


def prematch(db: Session, req: dict) -> dict:
    day = date.fromisoformat(req["date"]) if req.get("date") else date.today()
    profile = get_profile(db, req.get("profile_id"))
    markets = req.get("markets") or profile.fav_markets or []
    stats = (req.get("stats") if req.get("stats") is not None else profile.fav_stats)[:3]
    streaks = (req.get("streaks") if req.get("streaks") is not None else profile.fav_streaks)[:3]
    bookmaker = req.get("bookmaker") or (profile.fav_bookmakers or [BEST])[0]
    leagues = set(req.get("leagues") or [])

    all_matches = day_matches(db, day)
    countries: dict[str, dict] = {}
    for m in all_matches:
        c = countries.setdefault(m.league.country, {"country": m.league.country, "code": m.league.country_code,
                                                    "count": 0, "league_ids": set()})
        c["count"] += 1
        c["league_ids"].add(m.league_id)
    fav = set(profile.fav_leagues or [])
    fav_count = sum(1 for m in all_matches if not fav or m.league_id in fav)

    selected = [m for m in all_matches if not leagues or m.league_id in leagues]
    rows = build_rows(db, selected, profile, markets, stats, streaks, bookmaker)
    if req.get("hide_without_odds") and markets:
        main = markets[0]
        rows = [r for r in rows if r["markets"].get(main, {}).get("book") is not None]
    rows = [r for r in rows if row_passes(r, req.get("filters"))]
    rows.sort(key=SORTS.get(req.get("sort") or "time", SORTS["time"]))

    return {
        "date": day.isoformat(),
        "profile": {"id": profile.id, "name": profile.name},
        "markets": markets, "stats": stats, "streaks": streaks, "bookmaker": bookmaker,
        "rows": rows,
        "shown": len(rows),
        "shown_leagues": len({r["league"]["id"] for r in rows}),
        "total": len(all_matches),
        "total_leagues": len({m.league_id for m in all_matches}),
        "favorites_count": fav_count,
        "countries": sorted(
            ({**c, "league_ids": sorted(c["league_ids"])} for c in countries.values()), key=lambda c: c["country"]),
    }


def match_sample(db: Session, match_id: int, profile_id: int | None, market_key: str | None) -> dict:
    m = db.scalar(select(Match).where(Match.id == match_id)
                  .options(joinedload(Match.home), joinedload(Match.away), joinedload(Match.league)))
    if m is None:
        raise LookupError("Partido no encontrado")
    profile = get_profile(db, profile_id)
    ro = profile.real_odds_profile
    history = load_history(db)
    md = to_domain(m)
    sample = A.real_odds_sample(history, md, ro.sample, ro.home_as, ro.away_as)
    market = MARKETS_BY_KEY.get(market_key or (profile.fav_markets or ["ou_ht_over_0_5"])[0])
    from app.models import Team
    ids = {x.home_id for x in sample.merged} | {x.away_id for x in sample.merged}
    names = dict(db.execute(select(Team.id, Team.name).where(Team.id.in_(ids))).all()) if ids else {}
    home_ids = {x.id for x in sample.home}
    away_ids = {x.id for x in sample.away}
    res = A.real_odds(sample.merged, market) if market else None
    return {
        "match": {"id": m.id, "home": m.home.name, "away": m.away.name, "league": m.league.name,
                  "kickoff": m.kickoff.isoformat()},
        "profile": {"name": ro.name, "sample": ro.sample, "home_as": ro.home_as, "away_as": ro.away_as},
        "market": market.as_dict() if market else None,
        "real": _r(res.odds) if res else None, "hits": res.hits if res else 0, "n": sample.n,
        "n_home": len(sample.home), "n_away": len(sample.away),
        "matches": [{
            "id": x.id, "date": x.kickoff.isoformat(), "home": names.get(x.home_id), "away": names.get(x.away_id),
            "ft": [x.hg, x.ag], "ht": [x.hthg, x.htag],
            "hit": market.check(x) if market else None,
            "from": "both" if x.id in home_ids and x.id in away_ids else ("home" if x.id in home_ids else "away"),
        } for x in sample.merged],
    }


def match_odds(db: Session, match_id: int, market_keys: list[str] | None) -> dict:
    om = odds_map(db, [match_id]).get(match_id, {})
    keys = market_keys or [k for k in MARKETS_BY_KEY if k in om]
    rows = []
    for k in keys:
        prices = om.get(k, {})
        best = max(prices.values()) if prices else None
        rows.append({"market": MARKETS_BY_KEY[k].as_dict() if k in MARKETS_BY_KEY else {"key": k, "name": k},
                     "prices": {b: prices.get(b) for b in BOOKMAKER_KEYS}, "best": best})
    return {"match_id": match_id, "bookmakers": BOOKMAKER_KEYS, "rows": rows}
