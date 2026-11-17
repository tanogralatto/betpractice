"""Tests del proveedor API-Football con respuestas simuladas (sin llamadas reales)."""
import json
import logging
from datetime import date, datetime
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.catalog.markets import MARKETS_BY_KEY
from app.db import Base
from app.models import GoalEvent, League, Match, Odds, Season, Team
from app.providers.api_football import (
    ApiFootballClient,
    ApiFootballError,
    ApiFootballProvider,
    OddsMapper,
    QuotaExceeded,
    parse_fixture,
    parse_goals,
)
from app.services.analysis import real_odds, real_odds_sample
from app.services.repository import load_history, to_domain
from app.services.sync import Syncer

FIX = Path(__file__).parent / "fixtures" / "api_football"


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


QUOTA = {"x-ratelimit-requests-limit": "7500", "x-ratelimit-requests-remaining": "7000",
         "X-RateLimit-Limit": "300", "X-RateLimit-Remaining": "299"}


def route(request: httpx.Request) -> httpx.Response:
    p, q = request.url.path, dict(request.url.params)
    name = None
    if p == "/leagues":
        name = f"leagues_{q['id']}.json"
    elif p == "/teams":
        name = f"teams_{q['league']}_{q['season']}.json"
    elif p == "/fixtures" and "ids" in q:
        name = "fixtures_ids.json"
    elif p == "/fixtures" and "date" in q:
        name = f"fixtures_date_{q['date']}.json"
    elif p == "/fixtures":
        name = f"fixtures_{q['league']}_{q['season']}.json"
    elif p == "/odds":
        name = f"odds_{q['league']}_{q['date']}_p{q.get('page', '1')}.json"
    elif p == "/odds/bookmakers":
        name = "odds_bookmakers.json"
    elif p == "/odds/bets":
        name = "odds_bets.json"
    if name is None or not (FIX / name).exists():
        return httpx.Response(200, json={"errors": [], "response": [], "paging": {"current": 1, "total": 1}}, headers=QUOTA)
    return httpx.Response(200, json=load(name), headers=QUOTA)


class Recorder:
    def __init__(self, handler=route):
        self.calls: list[httpx.Request] = []
        self.handler = handler

    def __call__(self, request):
        self.calls.append(request)
        return self.handler(request)


def make_client(handler=None, tmp_path=None, **kw):
    rec = Recorder(handler or route)
    sleeps = []
    c = ApiFootballClient("clave-de-prueba", base_url="https://api.test", cache_dir=tmp_path,
                          transport=httpx.MockTransport(rec), sleep=sleeps.append, **kw)
    return c, rec, sleeps


# --- cliente ---------------------------------------------------------------------
def test_falta_la_clave():
    with pytest.raises(ApiFootballError, match="API_FOOTBALL_KEY"):
        ApiFootballClient("")


def test_header_de_autenticacion_y_cuota():
    c, rec, _ = make_client()
    c.leagues(128)
    assert rec.calls[0].headers["x-apisports-key"] == "clave-de-prueba"
    assert c.daily_remaining == 7000 and c.minute_remaining == 299


def test_paginacion():
    c, rec, _ = make_client()
    items = c.odds(league=128, season=2026, date="2026-11-17")
    assert len(items) == 2 and len(rec.calls) == 2
    assert rec.calls[1].url.params["page"] == "2"


def test_reintenta_ante_429_y_rate_limit():
    state = {"n": 0}

    def handler(req):
        state["n"] += 1
        if state["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "3"})
        if state["n"] == 2:
            return httpx.Response(200, json={"errors": {"rateLimit": "Too many requests"}, "response": []})
        return route(req)

    c, rec, sleeps = make_client(handler)
    assert c.leagues(128)[0]["league"]["id"] == 128
    assert len(rec.calls) == 3 and sleeps[0] == 3 and len(sleeps) == 2


def test_se_agotan_los_reintentos():
    c, _, _ = make_client(lambda r: httpx.Response(429), max_retries=2)
    with pytest.raises(ApiFootballError, match="reintentos"):
        c.leagues(128)


def test_corta_si_queda_poca_cuota_diaria():
    def handler(req):
        r = route(req)
        r.headers["x-ratelimit-requests-remaining"] = "5"
        return r

    c, rec, _ = make_client(handler, min_daily_remaining=10)
    c.leagues(128)
    with pytest.raises(QuotaExceeded):
        c.teams(128, 2026)
    assert len(rec.calls) == 1


def test_espera_si_se_agota_la_cuota_por_minuto():
    def handler(req):
        r = route(req)
        r.headers["X-RateLimit-Remaining"] = "0"
        return r

    c, _, sleeps = make_client(handler)
    c.leagues(128)
    c.teams(128, 2026)
    assert sleeps == [60]


def test_errores_de_la_api():
    c, _, _ = make_client(lambda r: httpx.Response(200, json={"errors": {"token": "Error/Missing application key"}}))
    with pytest.raises(ApiFootballError, match="token"):
        c.leagues(128)


def test_cache_en_disco(tmp_path):
    c, rec, _ = make_client(tmp_path=tmp_path)
    c.leagues(128)
    c.leagues(128)
    assert len(rec.calls) == 1 and c.cache_hits == 1
    c2, rec2, _ = make_client(tmp_path=tmp_path)  # otra instancia reutiliza la caché
    c2.leagues(128)
    assert len(rec2.calls) == 0


# --- parseo ------------------------------------------------------------------------
def test_parse_fixture_guarda_medio_tiempo():
    fx = parse_fixture(load("fixtures_128_2026.json")["response"][0])
    assert (fx.hg, fx.ag, fx.hthg, fx.htag) == (2, 1, 1, 0)
    assert fx.status == "FT" and fx.kickoff == datetime(2026, 10, 4, 17, 0)
    ns = parse_fixture(load("fixtures_128_2026.json")["response"][2])
    assert ns.status == "NS" and ns.hg is None


def test_parse_goals_excluye_penal_errado_y_corrige_gol_en_contra():
    item = load("fixtures_ids.json")["response"][0]
    goals = parse_goals(item["events"], 451, 435, (2, 1))
    assert [(g.minute, g.extra, g.half, g.side) for g in goals] == [
        (12, None, 1, "home"), (67, None, 2, "away"), (90, 3, 2, "home")]


def test_mapper_de_cuotas(caplog):
    m = OddsMapper()
    assert m.bookmaker("Bet365") == "bet365" and m.bookmaker("Casa Desconocida") is None
    assert m.market("Goals Over/Under First Half", "Over 0.5") == "ou_ht_over_0_5"
    assert m.market("Goals Over/Under", "Under 2.5") == "ou_under_2_5"
    assert m.market("HT/FT Double", "Draw/Home") == "htft_x1"
    assert m.market("Exact Score", "2:1") == "cs_21"
    assert m.market("Correct Score - First Half", "0:1") == "cs_ht_01"
    assert m.market("Asian Handicap", "Home -0.5") is None  # ignorado a propósito
    assert m.market("Exact Score", "4:4") is None  # fuera del catálogo
    assert m.market("Player to be Booked", "X") is None
    with caplog.at_level(logging.WARNING, logger="api_football"):
        m.log_unmapped()
    assert "Exact Score = 4:4" in caplog.text and "Player to be Booked" in caplog.text
    assert "Asian Handicap" not in caplog.text


def test_mapper_todas_las_claves_del_mapeo_existen_en_el_catalogo():
    raw = json.loads((Path(__file__).parent.parent / "app/providers/api_football_mapping.json").read_text())
    for bet, values in raw["bets"].items():
        for target in values.values():
            if "{" not in target:
                assert target in MARKETS_BY_KEY, f"{bet}: {target}"


def test_check_mapping():
    c, _, _ = make_client()
    rep = ApiFootballProvider(c).check_mapping()
    assert set(rep["bookmakers_mapeadas"]) == {"Pinnacle", "Bet365", "1xBet"}
    assert rep["tipos_sin_mapear"] == ["Player to be Booked"]


# --- sincronización ------------------------------------------------------------------
@pytest.fixture
def db():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    s = sessionmaker(bind=eng, expire_on_commit=False)()
    yield s
    s.close()


def test_sync_completo_e_idempotente(db):
    c, rec, _ = make_client()
    prov = ApiFootballProvider(c)

    s = Syncer(db, prov)
    s.sync_history(128, ["current", "previous"])
    s.sync_day(date(2026, 11, 17))

    lg = db.scalar(select(League).where(League.api_id == 128))
    assert lg.name == "Liga Profesional Argentina" and lg.country == "Argentina"
    assert [se.year for se in db.scalars(select(Season).order_by(Season.year))] == [2025, 2026]
    assert db.scalar(select(func.count(Team.id))) == 3
    assert db.scalar(select(func.count(Match.id))) == 3  # la liga no seguida (999) no se guarda
    m1 = db.scalar(select(Match).where(Match.api_id == 1001))
    assert (m1.hthg, m1.htag, m1.home_corners, m1.away_corners, m1.home_shots, m1.away_yellow) == (1, 0, 7, 4, 14, 0)
    assert m1.details_synced and len(m1.goals) == 3
    m2 = db.scalar(select(Match).where(Match.api_id == 1002))
    assert m2.away_corners == 0 and m2.goals == []
    nxt = db.scalar(select(Match).where(Match.api_id == 1003))
    odds = {(o.bookmaker, o.market_key): o.price for o in db.scalars(select(Odds).where(Odds.match_id == nxt.id))}
    assert odds[("bet365", "ou_ht_over_0_5")] == 1.44 and odds[("pinnacle", "ou_ht_over_0_5")] == 1.47
    assert ("bet365", "cs_10") in odds and not any(k[0] not in ("bet365", "pinnacle") for k in odds)
    n_odds, n_goals = db.scalar(select(func.count(Odds.id))), db.scalar(select(func.count(GoalEvent.id)))

    # Segunda corrida: no duplica nada y no vuelve a pedir detalles de partidos ya completos
    calls_before = len(rec.calls)
    s2 = Syncer(db, prov)
    s2.sync_history(128, ["current"])
    s2.sync_day(date(2026, 11, 17))
    assert s2.report.matches_new == 0 and s2.report.details == 0
    assert db.scalar(select(func.count(Match.id))) == 3
    assert db.scalar(select(func.count(Odds.id))) == n_odds
    assert db.scalar(select(func.count(GoalEvent.id))) == n_goals
    assert not any("ids" in r.url.params for r in rec.calls[calls_before:])

    # El cálculo de cuota real funciona igual sobre los datos sincronizados
    h = load_history(db)
    sample = real_odds_sample(h, to_domain(nxt), "current_plus_1", "both", "both")
    assert sample.n == 2  # River: 1001; Racing: 1002 (sin duplicados)
    r = real_odds(sample.merged, MARKETS_BY_KEY["ou_ht_over_0_5"])
    assert (r.hits, r.n, r.odds) == (1, 2, 2.0)


def test_sync_actualiza_partido_cuando_cambia_el_resultado(db):
    c, _, _ = make_client()
    s = Syncer(db, ApiFootballProvider(c))
    s.sync_history(128, ["current"])
    m = db.scalar(select(Match).where(Match.api_id == 1003))
    assert m.status == "NS"
    finished = load("fixtures_128_2026.json")["response"][2]
    finished = json.loads(json.dumps(finished))
    finished["fixture"]["status"]["short"] = "FT"
    finished["goals"] = {"home": 1, "away": 0}
    finished["score"]["halftime"] = {"home": 0, "away": 0}
    finished["score"]["fulltime"] = {"home": 1, "away": 0}
    s.upsert_fixture(parse_fixture(finished), m.league)
    db.commit()
    db.refresh(m)
    assert (m.status, m.hg, m.hthg, m.details_synced) == ("FT", 1, 0, False)
    assert s.report.matches_updated == 1
