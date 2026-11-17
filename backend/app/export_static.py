"""Exporta la base a un archivo JSON que lee la página (frontend/public/data/datos.json).

    python -m app.export_static [--out RUTA]

La página (GitHub Pages) no tiene servidor: hace todos los cálculos en el navegador con
este archivo. Incluye todos los partidos terminados (para las muestras) y los partidos
no terminados de los últimos 7 días y los próximos 14, con sus cuotas.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app import config
from app.db import SessionLocal, init_db
from app.models import GoalEvent, League, Match, Odds, Season, Team

DEFAULT_OUT = config.BASE_DIR.parent / "frontend" / "public" / "data" / "datos.json"
COLS = ("hg", "ag", "hthg", "htag", "home_corners", "away_corners", "home_shots", "away_shots",
        "home_sot", "away_sot", "home_dangerous", "away_dangerous", "home_yellow", "away_yellow")


def export(out: Path, today: date | None = None) -> dict:
    today = today or date.today()
    lo = datetime.combine(today - timedelta(days=7), time(0, 0))
    hi = datetime.combine(today + timedelta(days=15), time(0, 0))
    init_db()
    db = SessionLocal()
    try:
        goals: dict[int, list[str]] = defaultdict(list)
        for mid, minute, side, half in db.execute(
                select(GoalEvent.match_id, GoalEvent.minute, GoalEvent.side, GoalEvent.half)
                .order_by(GoalEvent.match_id, GoalEvent.half, GoalEvent.minute)):
            goals[mid].append(f"{minute}{side[0]}{half}")

        matches, window_ids, team_ids = [], [], set()
        for m in db.scalars(select(Match).order_by(Match.kickoff)):
            in_window = lo <= m.kickoff < hi
            if m.status != "FT" and not in_window:
                continue
            if m.status == "CANC":
                continue
            if in_window:
                window_ids.append(m.id)
            team_ids |= {m.home_id, m.away_id}
            matches.append([m.id, m.league_id, m.season_id, m.kickoff.strftime("%Y-%m-%dT%H:%M"), m.home_id, m.away_id,
                            m.status, *[getattr(m, c) for c in COLS], " ".join(goals.get(m.id, [])) or None])

        odds: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
        for i in range(0, len(window_ids), 500):
            for mid, bk, mk, price in db.execute(select(Odds.match_id, Odds.bookmaker, Odds.market_key, Odds.price)
                                                 .where(Odds.match_id.in_(window_ids[i:i + 500]))):
                odds[str(mid)][mk][bk] = price

        leagues = list(db.scalars(select(League).order_by(League.country, League.name)))
        data = {
            "meta": {
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "provider": config.DATA_PROVIDER,
                "today": today.isoformat(),
                "leagues_synced": [f"{lg.country} · {lg.name}" for lg in leagues],
            },
            "leagues": [[lg.id, lg.name, lg.country, lg.country_code] for lg in leagues],
            "seasons": [[s.id, s.league_id, s.year, s.name] for s in db.scalars(select(Season))],
            "teams": {str(t.id): t.name for t in db.scalars(select(Team)) if t.id in team_ids},
            "matches": matches,
            "odds": odds,
        }
    finally:
        db.close()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"partidos": len(matches), "con_cuotas": len(odds), "kb": out.stat().st_size // 1024}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m app.export_static")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    res = export(args.out)
    print(f"Datos exportados a {args.out}: {res}")


if __name__ == "__main__":
    main()
