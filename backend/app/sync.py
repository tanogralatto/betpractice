"""Comando de sincronización.

    python -m app.sync                         # según DATA_PROVIDER (seed = regenera datos de prueba)
    python -m app.sync history --league 128 --league 39 --season current --season previous
    python -m app.sync daily --days 2          # partidos y cuotas de hoy y mañana
    python -m app.sync details                 # completa goles/estadísticas pendientes
    python -m app.sync check-mapping           # revisa /odds/bookmakers y /odds/bets contra el mapeo
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import date, timedelta

from app import config
from app.db import SessionLocal, init_db


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m app.sync", description="Sincroniza datos del proveedor a la base.")
    ap.add_argument("--provider", default=config.DATA_PROVIDER, help="seed | api_football (default: DATA_PROVIDER)")
    sub = ap.add_subparsers(dest="cmd")
    h = sub.add_parser("history", help="Histórico por liga y temporada")
    h.add_argument("--league", type=int, action="append", required=True, help="id de liga de API-Football (repetible)")
    h.add_argument("--season", action="append", default=None,
                   help="año (2025), 'current' o 'previous' (repetible; default: current y previous)")
    h.add_argument("--force", action="store_true", help="re-sincronizar aunque la temporada ya esté completa")
    d = sub.add_parser("daily", help="Partidos y cuotas por fecha")
    d.add_argument("--date", type=date.fromisoformat, default=None, help="YYYY-MM-DD (default: hoy)")
    d.add_argument("--days", type=int, default=2, help="cantidad de días desde --date (default 2)")
    d.add_argument("--no-odds", action="store_true")
    det = sub.add_parser("details", help="Goles y estadísticas pendientes")
    det.add_argument("--limit", type=int, default=None)
    sub.add_parser("check-mapping", help="Compara /odds/bookmakers y /odds/bets con el mapeo")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.provider == "seed":
        from app.seed import main as seed_main

        print("DATA_PROVIDER=seed → se regeneran los datos de prueba.")
        seed_main([])
        return

    from app.providers import get_provider
    from app.services.sync import Syncer

    from app.providers.api_football import ApiFootballError

    init_db()
    try:
        provider = get_provider(args.provider)
    except ApiFootballError as e:
        raise SystemExit(f"Error: {e}")
    db = SessionLocal()
    syncer = Syncer(db, provider)
    try:
        if args.cmd == "history":
            for lid in args.league:
                syncer.sync_history(lid, args.season or ["current", "previous"], force=args.force)
        elif args.cmd == "daily":
            start = args.date or date.today()
            for i in range(args.days):
                syncer.sync_day(start + timedelta(days=i), odds=not args.no_odds)
        elif args.cmd == "details":
            syncer.sync_details(limit=args.limit)
        elif args.cmd == "check-mapping":
            print(json.dumps(provider.check_mapping(), ensure_ascii=False, indent=2))
            return
        else:
            ap.print_help()
            return
    except ApiFootballError as e:
        db.rollback()
        raise SystemExit(f"Error de API-Football: {e}\nLo ya guardado queda en la base; volvé a correr el comando para continuar.")
    finally:
        db.close()
        client = getattr(provider, "client", None)
        if client is not None:
            print(f"Pedidos a la API: {client.requests_made} (caché: {client.cache_hits}); "
                  f"cuota diaria restante: {client.daily_remaining}")
    print("Sincronización OK:", syncer.report)


if __name__ == "__main__":
    main()
