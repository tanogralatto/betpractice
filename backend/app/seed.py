"""Genera datos de prueba realistas en la base (DATA_PROVIDER=seed).

    python -m app.seed [--date YYYY-MM-DD] [--seed 42]

Crea 6 ligas, 3 temporadas, equipos, partidos jugados (FT, HT, minutos de gol,
corners, tarjetas, tiros, ataques peligrosos) y partidos de los últimos 3 días,
hoy y los próximos 6 días con cuotas de Bet365, Pinnacle y 1xBet para todo el
catálogo de mercados. ≈70–76 % de los partidos tienen gol en el 1er tiempo.
"""
from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import insert

from app.catalog.markets import MARKETS
from app.db import Base, SessionLocal, engine
from app.domain import Goal, MatchData
from app.models import GoalEvent, League, Match, Odds, Season, Team
from app.services.defaults import ensure_default_profiles


@dataclass
class LeagueCfg:
    name: str
    country: str
    code: str
    goals: float  # promedio de goles por partido
    calendar: str  # "euro" (ago-may) | "year" (feb-dic) | "nations"
    teams: list[str]
    hours: list[str]
    day_prob: float = 0.8


def _names(prefixes, places):
    return [f"{prefixes[i % len(prefixes)]} {p}" for i, p in enumerate(places)]


LEAGUES = [
    LeagueCfg("Primera División", "Argentina", "AR", 2.55, "year",
              _names(["Atlético", "Club", "Sportivo", "Deportivo", "Unión"],
                     ["Rosario", "Córdoba", "Mendoza", "La Plata", "Tucumán", "Salta", "Mar del Plata", "Santa Fe",
                      "Paraná", "Neuquén", "San Juan", "Bahía Blanca", "Avellaneda", "Quilmes", "Lanús", "Banfield",
                      "Junín", "Rafaela", "Tandil", "Posadas"]),
              ["15:00", "17:15", "19:30", "21:30"]),
    LeagueCfg("Premier League", "Inglaterra", "GB", 2.95, "euro",
              [f"{p} {s}" for p, s in zip(
                  ["Ashford", "Bramley", "Carlton", "Dunmore", "Eastwick", "Fairhaven", "Glenford", "Hartley",
                   "Ivybridge", "Kingsbury", "Langley", "Marston", "Northam", "Oakham", "Pembury", "Redford",
                   "Stanwick", "Thornbury", "Westfield", "Yarmouth"],
                  ["United", "City", "Town", "Rovers", "Athletic", "Wanderers", "Albion", "County", "Forest", "United",
                   "City", "Town", "Rovers", "Athletic", "Wanderers", "Albion", "County", "City", "United", "Town"])],
              ["09:30", "12:00", "14:30", "17:00"]),
    LeagueCfg("LaLiga", "España", "ES", 2.65, "euro",
              _names(["CD", "Real", "UD", "Atlético", "SD"],
                     ["Alcora", "Benavente", "Calahorra", "Daroca", "Écija", "Fuengirola", "Guadix", "Haro", "Irún",
                      "Jaca", "Lorca", "Manresa", "Nájera", "Olot", "Plasencia", "Ronda", "Sagunto", "Tudela",
                      "Utrera", "Vic"]),
              ["10:00", "12:15", "14:30", "16:00", "17:00"]),
    LeagueCfg("Serie A", "Italia", "IT", 2.8, "euro",
              _names(["AC", "US", "SS", "FC"],
                     ["Ancona", "Benevento", "Carpi", "Crema", "Empoli Nord", "Fano", "Gubbio", "Imola", "Lecco",
                      "Mantova", "Novara", "Olbia", "Pistoia", "Rieti", "Savona", "Teramo", "Udine Est", "Varese",
                      "Vicenza Sud", "Viterbo"]),
              ["08:30", "11:00", "14:00", "16:45"]),
    LeagueCfg("Nations League", "Europa", "EU", 2.6, "nations",
              ["Alemania", "Francia", "España", "Italia", "Inglaterra", "Portugal", "Países Bajos", "Bélgica",
               "Croacia", "Suiza", "Dinamarca", "Austria", "Polonia", "Suecia", "Noruega", "Escocia"],
              ["13:00", "16:45"], day_prob=0.35),
    LeagueCfg("Primera B", "Chile", "CL", 2.7, "year",
              _names(["Deportes", "Club", "Unión", "Deportivo"],
                     ["Antofagasta", "Arica", "Calama", "Copiapó", "La Serena", "Valparaíso", "Rancagua", "Talca",
                      "Curicó", "Chillán", "Concepción", "Temuco", "Valdivia", "Osorno", "Puerto Montt", "Iquique"]),
              ["15:00", "18:00", "20:30"], day_prob=0.6),
]

HT_SHARE = 0.47  # proporción de goles en el 1er tiempo


@dataclass
class TeamStr:
    id: int
    att: float
    dfn: float  # factor de goles recibidos
    ht_bias: float
    corners: float


# ---------------------------------------------------------------------------
# Simulación de un partido
# ---------------------------------------------------------------------------
def _poisson(rng: random.Random, lam: float) -> int:
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def simulate(rng: random.Random, h: TeamStr, a: TeamStr, avg_goals: float, mid: int = 0,
             league_id: int = 0, season_id: int = 0, kickoff: datetime | None = None) -> MatchData:
    mu = avg_goals / 2
    lam_h = mu * h.att * a.dfn * 1.12
    lam_a = mu * a.att * h.dfn * 0.89
    share = min(0.62, max(0.34, HT_SHARE + (h.ht_bias + a.ht_bias) / 2))
    goals: list[Goal] = []
    for side, lam in (("home", lam_h), ("away", lam_a)):
        for half, frac in ((1, share), (2, 1 - share)):
            for _ in range(_poisson(rng, lam * frac)):
                if half == 1:
                    minute = 45 if rng.random() < 0.06 else rng.randint(1, 45)
                else:
                    minute = 90 if rng.random() < 0.08 else rng.randint(46, 90)
                goals.append(Goal(minute, side, half))
    hg = sum(g.side == "home" for g in goals)
    ag = len(goals) - hg
    hthg = sum(g.side == "home" and g.half == 1 for g in goals)
    htag = sum(g.side == "away" and g.half == 1 for g in goals)
    hs = _poisson(rng, 12.5 * h.att / a.dfn ** 0.3)
    as_ = _poisson(rng, 10.5 * a.att / h.dfn ** 0.3)
    hsot = max(hg, sum(rng.random() < 0.34 for _ in range(hs)))
    asot = max(ag, sum(rng.random() < 0.34 for _ in range(as_)))
    return MatchData(
        id=mid, league_id=league_id, season_id=season_id, kickoff=kickoff or datetime(2000, 1, 1),
        home_id=h.id, away_id=a.id, status="FT", hg=hg, ag=ag, hthg=hthg, htag=htag, goals=goals,
        home_corners=_poisson(rng, 5.3 * h.corners), away_corners=_poisson(rng, 4.4 * a.corners),
        home_shots=max(hs, hsot), away_shots=max(as_, asot), home_sot=hsot, away_sot=asot,
        home_dangerous=_poisson(rng, 52 * h.att), away_dangerous=_poisson(rng, 44 * a.att),
        home_yellow=_poisson(rng, 1.9), away_yellow=_poisson(rng, 2.1),
    )


# ---------------------------------------------------------------------------
# Calendario
# ---------------------------------------------------------------------------
def round_robin(team_ids: list[int]) -> list[list[tuple[int, int]]]:
    ids = list(team_ids)
    if len(ids) % 2:
        ids.append(-1)
    n = len(ids)
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = ids[i], ids[n - 1 - i]
            if a != -1 and b != -1:
                pairs.append((a, b) if r % 2 == 0 else (b, a))
        rounds.append(pairs)
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    return rounds + [[(b, a) for a, b in rd] for rd in rounds]


def season_bounds(cfg: LeagueCfg, today: date, offset: int) -> tuple[int, date, date, str]:
    """offset 0 = temporada actual, 1 = anterior, ..."""
    if cfg.calendar == "euro":
        y = (today.year if today.month >= 8 else today.year - 1) - offset
        return y, date(y, 8, 10), date(y + 1, 5, 25), f"{y}/{str(y + 1)[-2:]}"
    y = (today.year if today.month >= 2 else today.year - 1) - offset
    if cfg.calendar == "nations":
        return y, date(y, 9, 1), date(y, 11, 30), str(y)
    return y, date(y, 2, 1), date(y, 12, 15), str(y)


def schedule(cfg: LeagueCfg, team_ids: list[int], start: date, end: date, rng: random.Random):
    if cfg.calendar == "nations":
        ids = list(team_ids)
        rng.shuffle(ids)
        rounds: list[list[tuple[int, int]]] = [[] for _ in range(6)]
        for g in range(0, len(ids), 4):
            for i, rd in enumerate(round_robin(ids[g:g + 4])):
                rounds[i] += rd
    else:
        rounds = round_robin(team_ids)
    span = (end - start).days
    out = []
    for i, rd in enumerate(rounds):
        base = start + timedelta(days=int(span * i / max(1, len(rounds) - 1)))
        for h, a in rd:
            d = base + timedelta(days=rng.randint(0, 2))
            hh, mm = map(int, rng.choice(cfg.hours).split(":"))
            out.append((datetime.combine(d, time(hh, mm)), h, a))
    return out


# ---------------------------------------------------------------------------
# Cuotas
# ---------------------------------------------------------------------------
BOOKIES = {"bet365": 0.065, "pinnacle": 0.03, "1xbet": 0.05}
PINNACLE_SKIP_GROUPS = {"Primer gol (tramo)", "Marcador exacto 1er tiempo", "Último en marcar", "Mitad con más goles"}


def market_probs(rng: random.Random, h: TeamStr, a: TeamStr, avg_goals: float, n: int = 400) -> dict[str, float]:
    hits = {m.key: 0 for m in MARKETS}
    for _ in range(n):
        md = simulate(rng, h, a, avg_goals)
        for m in MARKETS:
            if m.check(md):
                hits[m.key] += 1
    return {k: v / n for k, v in hits.items()}


def make_odds(rng: random.Random, probs: dict[str, float], league_code: str) -> list[tuple[str, str, float]]:
    out = []
    if rng.random() < 0.06:  # partido sin cuotas
        return out
    for bk, margin in BOOKIES.items():
        if bk == "pinnacle" and league_code == "CL":
            continue
        if bk == "bet365" and rng.random() < 0.08:
            continue
        for m in MARKETS:
            if bk == "pinnacle" and (m.group in PINNACLE_SKIP_GROUPS or m.category == "equipo"):
                continue
            p = probs[m.key]
            if p < 0.006 or p > 0.985:
                continue
            p = min(0.97, max(0.006, p))
            price = 1 / (p * (1 + margin)) * math.exp(rng.gauss(0, 0.04))
            price = round(max(1.01, price), 2)
            if price > 150:
                continue
            out.append((bk, m.key, price))
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run(today: date, seed: int = 42, verbose: bool = True) -> dict:
    rng = random.Random(seed)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    stats = {"matches": 0, "ft": 0, "ht_goal": 0, "odds": 0}
    next_mid = 1
    match_rows, goal_rows, odds_rows = [], [], []

    for cfg in LEAGUES:
        lg = League(name=cfg.name, country=cfg.country, country_code=cfg.code, source="seed")
        db.add(lg)
        db.flush()
        teams = [Team(name=n, country=cfg.country) for n in cfg.teams]
        db.add_all(teams)
        db.flush()
        strengths = {
            t.id: TeamStr(t.id, math.exp(rng.gauss(0, 0.2)), math.exp(rng.gauss(0, 0.16)),
                          rng.gauss(0, 0.05), math.exp(rng.gauss(0, 0.15)))
            for t in teams
        }
        team_ids = [t.id for t in teams]
        cutoff = datetime.combine(today - timedelta(days=3), time(0, 0))

        for offset in (2, 1, 0):
            year, start, end, name = season_bounds(cfg, today, offset)
            se = Season(league_id=lg.id, year=year, name=name, start_date=start, end_date=end, is_current=offset == 0)
            db.add(se)
            db.flush()
            # Leve cambio de fuerzas entre temporadas
            for s in strengths.values():
                s.att *= math.exp(rng.gauss(0, 0.05))
            fixtures = schedule(cfg, team_ids, start, end, rng)
            if offset == 0:
                fixtures = [f for f in fixtures if f[0] < cutoff]
            for ko, h, a in fixtures:
                if ko >= cutoff:
                    continue
                md = simulate(rng, strengths[h], strengths[a], cfg.goals, next_mid, lg.id, se.id, ko)
                _collect(md, match_rows, goal_rows, stats)
                next_mid += 1

            if offset == 0:  # partidos de los últimos 3 días, hoy y próximos 6 días (con cuotas)
                for d in range(-3, 7):
                    day = today + timedelta(days=d)
                    if rng.random() > cfg.day_prob:
                        continue
                    pool = team_ids[:]
                    rng.shuffle(pool)
                    k = rng.randint(2, 5 if cfg.code != "EU" else 3)
                    for i in range(k):
                        h, a = pool[2 * i], pool[2 * i + 1]
                        hh, mm = map(int, rng.choice(cfg.hours).split(":"))
                        ko = datetime.combine(day, time(hh, mm))
                        if d < 0:
                            md = simulate(rng, strengths[h], strengths[a], cfg.goals, next_mid, lg.id, se.id, ko)
                            _collect(md, match_rows, goal_rows, stats)
                        else:
                            match_rows.append(dict(id=next_mid, league_id=lg.id, season_id=se.id, home_id=h,
                                                   away_id=a, kickoff=ko, status="NS", status_detail="NS",
                                                   details_synced=False))
                            stats["matches"] += 1
                        probs = market_probs(rng, strengths[h], strengths[a], cfg.goals)
                        for bk, mk, price in make_odds(rng, probs, cfg.code):
                            odds_rows.append(dict(match_id=next_mid, bookmaker=bk, market_key=mk, price=price))
                        next_mid += 1
        if verbose:
            print(f"  {cfg.country} · {cfg.name}: {len(teams)} equipos")

    db.execute(insert(Match), match_rows)
    db.execute(insert(GoalEvent), goal_rows)
    for i in range(0, len(odds_rows), 5000):
        db.execute(insert(Odds), odds_rows[i:i + 5000])
    stats["odds"] = len(odds_rows)
    db.commit()
    ensure_default_profiles(db)
    db.close()
    if verbose:
        pct = 100 * stats["ht_goal"] / max(1, stats["ft"])
        print(f"Partidos: {stats['matches']} (terminados {stats['ft']}, con gol en 1T {pct:.1f} %). "
              f"Cuotas: {stats['odds']}")
    return stats


def _collect(md: MatchData, match_rows, goal_rows, stats) -> None:
    match_rows.append(dict(
        id=md.id, league_id=md.league_id, season_id=md.season_id, home_id=md.home_id, away_id=md.away_id,
        kickoff=md.kickoff, status="FT", status_detail="FT", hg=md.hg, ag=md.ag, hthg=md.hthg, htag=md.htag,
        home_corners=md.home_corners, away_corners=md.away_corners, home_shots=md.home_shots,
        away_shots=md.away_shots, home_sot=md.home_sot, away_sot=md.away_sot,
        home_dangerous=md.home_dangerous, away_dangerous=md.away_dangerous,
        home_yellow=md.home_yellow, away_yellow=md.away_yellow, details_synced=True,
    ))
    for g in md.goals:
        goal_rows.append(dict(match_id=md.id, minute=g.minute, extra=None, half=g.half, side=g.side))
    stats["matches"] += 1
    stats["ft"] += 1
    stats["ht_goal"] += md.ht_total > 0


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m app.seed")
    ap.add_argument("--date", type=date.fromisoformat, default=date.today(), help="fecha de 'hoy' (YYYY-MM-DD)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--force", action="store_true", help="permitir correrlo aunque DATA_PROVIDER no sea seed")
    args = ap.parse_args(argv)
    from app import config

    if config.DATA_PROVIDER != "seed" and not args.force:
        raise SystemExit(f"DATA_PROVIDER={config.DATA_PROVIDER}: el seed BORRA la base ({config.DATABASE_URL}). "
                         "Usá DATA_PROVIDER=seed o --force.")
    print(f"Generando datos de prueba (hoy = {args.date})…")
    run(args.date, args.seed)
    print("Listo.")


if __name__ == "__main__":
    main()
