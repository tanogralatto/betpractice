from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.catalog.bookmakers import BEST, BOOKMAKERS
from app.catalog.markets import CATEGORIES, MARKETS
from app.catalog.stats import STATS
from app.catalog.streaks import STREAKS
from app.db import get_db
from app.models import League
from app.schemas import PrematchRequest
from app.services import prematch as P

router = APIRouter(prefix="/api")


@router.get("/health")
def health():
    return {"ok": True, "provider": config.DATA_PROVIDER}


@router.get("/catalog")
def catalog():
    return {
        "markets": [m.as_dict() for m in MARKETS],
        "market_categories": CATEGORIES,
        "stats": [s.as_dict() for s in STATS],
        "streaks": [s.as_dict() for s in STREAKS],
        "bookmakers": [{"key": BEST, "name": "Mejor cuota"}] + BOOKMAKERS,
        "samples": [
            {"key": "last_8", "name": "Últimos 8"},
            {"key": "current", "name": "Temporada actual"},
            {"key": "current_plus_1", "name": "Actual + 1 anterior"},
            {"key": "current_plus_2", "name": "Actual + 2 anteriores"},
            {"key": "current_plus_3", "name": "Actual + 3 anteriores"},
        ],
    }


@router.get("/leagues")
def leagues(db: Session = Depends(get_db)):
    out: dict[str, dict] = {}
    for lg in db.scalars(select(League).order_by(League.country, League.name)):
        c = out.setdefault(lg.country, {"country": lg.country, "code": lg.country_code, "leagues": []})
        c["leagues"].append({"id": lg.id, "name": lg.name, "api_id": lg.api_id})
    return list(out.values())


@router.post("/prematch")
def prematch(req: PrematchRequest, db: Session = Depends(get_db)):
    try:
        return P.prematch(db, req.model_dump())
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.get("/matches/{match_id}/sample")
def sample(match_id: int, profile_id: int | None = None, market: str | None = None, db: Session = Depends(get_db)):
    try:
        return P.match_sample(db, match_id, profile_id, market)
    except LookupError as e:
        raise HTTPException(404, str(e))


@router.get("/matches/{match_id}/odds")
def odds(match_id: int, markets: str | None = Query(None), db: Session = Depends(get_db)):
    keys = [k for k in (markets or "").split(",") if k] or None
    return P.match_odds(db, match_id, keys)
