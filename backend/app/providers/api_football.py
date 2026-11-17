"""Proveedor API-Football v3 (https://v3.football.api-sports.io).

- Autenticación: header `x-apisports-key`, leído de la variable de entorno API_FOOTBALL_KEY.
- Respeta la cuota: lee los headers `x-ratelimit-requests-remaining` (diaria) y
  `X-RateLimit-Remaining` (por minuto), espera cuando se agota la del minuto,
  corta si la diaria baja de API_FOOTBALL_MIN_DAILY_REMAINING y reintenta con
  espera ante HTTP 429 / errores `rateLimit`.
- Caché en disco con vencimiento por endpoint (los partidos terminados no cambian).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

import httpx

from app import config
from app.catalog.markets import MARKETS_BY_KEY
from app.providers.base import (
    DataProvider,
    FixtureDetailsDTO,
    FixtureDTO,
    GoalDTO,
    LeagueDTO,
    OddsDTO,
    SeasonDTO,
    TeamDTO,
)

log = logging.getLogger("api_football")

MAPPING_PATH = Path(__file__).with_name("api_football_mapping.json")

# Vencimiento de caché (segundos) por endpoint. None = no cachear.
CACHE_TTL: dict[str, int | None] = {
    "/leagues": 24 * 3600,
    "/teams": 7 * 24 * 3600,
    "/fixtures": 30 * 60,
    "/fixtures/events": 6 * 3600,
    "/fixtures/statistics": 6 * 3600,
    "/odds": 30 * 60,
    "/odds/bookmakers": 7 * 24 * 3600,
    "/odds/bets": 7 * 24 * 3600,
    "/status": None,
}

FINISHED = {"FT", "AET", "PEN"}
LIVE = {"1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"}
NOT_STARTED = {"NS", "TBD"}
POSTPONED = {"PST"}


class ApiFootballError(RuntimeError):
    pass


class QuotaExceeded(ApiFootballError):
    pass


class ApiFootballClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = config.API_FOOTBALL_BASE_URL,
        cache_dir: str | Path | None = config.API_FOOTBALL_CACHE_DIR,
        min_daily_remaining: int = config.API_FOOTBALL_MIN_DAILY_REMAINING,
        max_retries: int = 4,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not api_key:
            raise ApiFootballError("Falta la clave: definí la variable de entorno API_FOOTBALL_KEY.")
        self._http = httpx.Client(
            base_url=base_url, headers={"x-apisports-key": api_key}, timeout=30, transport=transport
        )
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.min_daily_remaining = min_daily_remaining
        self.max_retries = max_retries
        self._sleep = sleep
        self.daily_remaining: int | None = None
        self.minute_remaining: int | None = None
        self.requests_made = 0
        self.cache_hits = 0

    # --- caché --------------------------------------------------------------
    def _cache_file(self, path: str, params: dict) -> Path | None:
        if not self.cache_dir or CACHE_TTL.get(path) is None:
            return None
        key = json.dumps([path, sorted(params.items())], default=str)
        return self.cache_dir / f"{hashlib.sha1(key.encode()).hexdigest()}.json"

    def _cache_get(self, f: Path | None, path: str, ttl: int | None) -> Any:
        if f is None or not f.exists():
            return None
        ttl = ttl if ttl is not None else CACHE_TTL.get(path)
        if ttl is not None and ttl >= 0 and time.time() - f.stat().st_mtime > ttl:
            return None
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    # --- cuota ----------------------------------------------------------------
    def _read_quota(self, r: httpx.Response) -> None:
        h = r.headers
        if "x-ratelimit-requests-remaining" in h:
            self.daily_remaining = int(h["x-ratelimit-requests-remaining"])
        if "x-ratelimit-remaining" in h:
            self.minute_remaining = int(h["x-ratelimit-remaining"])

    def _before_request(self) -> None:
        if self.daily_remaining is not None and self.daily_remaining <= self.min_daily_remaining:
            raise QuotaExceeded(
                f"Quedan {self.daily_remaining} pedidos diarios (mínimo configurado "
                f"{self.min_daily_remaining}). Se detiene la sincronización; retomala mañana."
            )
        if self.minute_remaining is not None and self.minute_remaining <= 0:
            log.info("Cuota por minuto agotada: esperando 60 s…")
            self._sleep(60)
            self.minute_remaining = None

    # --- pedido ----------------------------------------------------------------
    def get(self, path: str, params: dict | None = None, ttl: int | None = None) -> dict:
        """GET con caché, control de cuota y reintentos. Devuelve el JSON completo."""
        params = {k: v for k, v in (params or {}).items() if v is not None}
        cf = self._cache_file(path, params)
        cached = self._cache_get(cf, path, ttl)
        if cached is not None:
            self.cache_hits += 1
            return cached

        for attempt in range(self.max_retries + 1):
            self._before_request()
            try:
                r = self._http.get(path, params=params)
            except httpx.TransportError as e:
                if attempt >= self.max_retries:
                    raise ApiFootballError(f"Error de red en {path}: {e}") from e
                self._sleep(2 ** attempt)
                continue
            self.requests_made += 1
            self._read_quota(r)
            if r.status_code == 429 or (r.status_code == 200 and _is_rate_limit(r)):
                wait = float(r.headers.get("retry-after") or 0) or min(60, 2 ** (attempt + 2))
                log.warning("Límite de pedidos alcanzado (%s). Reintento %d en %.0f s", path, attempt + 1, wait)
                if attempt >= self.max_retries:
                    raise ApiFootballError(f"Límite de pedidos: se agotaron los reintentos en {path}")
                self._sleep(wait)
                continue
            if r.status_code >= 500:
                if attempt >= self.max_retries:
                    raise ApiFootballError(f"HTTP {r.status_code} en {path}")
                self._sleep(2 ** attempt)
                continue
            if r.status_code != 200:
                raise ApiFootballError(f"HTTP {r.status_code} en {path}: {r.text[:200]}")
            data = r.json()
            errors = data.get("errors")
            if errors:
                raise ApiFootballError(f"API-Football devolvió errores en {path}: {errors}")
            if cf is not None:
                cf.parent.mkdir(parents=True, exist_ok=True)
                cf.write_text(json.dumps(data), encoding="utf-8")
            return data
        raise ApiFootballError(f"No se pudo completar {path}")

    def get_all(self, path: str, params: dict | None = None, ttl: int | None = None) -> list:
        """Recorre todas las páginas (`paging.total`) y concatena `response`."""
        params = dict(params or {})
        data = self.get(path, params, ttl)
        out = list(data.get("response") or [])
        total = (data.get("paging") or {}).get("total") or 1
        for page in range(2, total + 1):
            out += self.get(path, {**params, "page": page}, ttl).get("response") or []
        return out

    # --- endpoints ---------------------------------------------------------------
    def leagues(self, league_id: int) -> list:
        return self.get_all("/leagues", {"id": league_id})

    def teams(self, league_id: int, season: int) -> list:
        return self.get_all("/teams", {"league": league_id, "season": season})

    def fixtures(self, **params) -> list:
        params.setdefault("timezone", config.API_FOOTBALL_TIMEZONE)
        return self.get_all("/fixtures", params)

    def fixtures_by_ids(self, ids: list[int]) -> list:
        """Hasta 20 partidos por pedido; trae events y statistics incluidos (ahorra cuota)."""
        return self.get_all(
            "/fixtures", {"ids": "-".join(map(str, ids)), "timezone": config.API_FOOTBALL_TIMEZONE}, ttl=-1
        )

    def fixture_events(self, fixture_id: int) -> list:
        return self.get_all("/fixtures/events", {"fixture": fixture_id})

    def fixture_statistics(self, fixture_id: int) -> list:
        return self.get_all("/fixtures/statistics", {"fixture": fixture_id})

    def odds(self, **params) -> list:
        params.setdefault("timezone", config.API_FOOTBALL_TIMEZONE)
        return self.get_all("/odds", params)

    def odds_bookmakers(self) -> list:
        return self.get_all("/odds/bookmakers")

    def odds_bets(self) -> list:
        return self.get_all("/odds/bets")


def _is_rate_limit(r: httpx.Response) -> bool:
    try:
        errors = r.json().get("errors")
    except ValueError:
        return False
    return isinstance(errors, dict) and "rateLimit" in errors


# ---------------------------------------------------------------------------
# Mapeo de cuotas
# ---------------------------------------------------------------------------
class OddsMapper:
    """Traduce (casa, tipo de apuesta, valor) de API-Football a (casa, mercado) propios."""

    def __init__(self, mapping: dict | None = None):
        mapping = mapping or json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
        self.bookmakers: dict[str, str] = {k.lower(): v for k, v in mapping["bookmakers"].items()}
        self.ignore = {b.lower() for b in mapping.get("ignore_bets", [])}
        self.bets: dict[str, tuple[dict[str, str], list[tuple[re.Pattern, str]]]] = {}
        for bet, values in mapping["bets"].items():
            exact, patterns = {}, []
            for val, target in values.items():
                if "{" in val:
                    rx = re.escape(val)
                    rx = rx.replace(r"\{line\}", r"(?P<line>\d+(?:\.\d+)?)")
                    rx = rx.replace(r"\{h\}", r"(?P<h>\d+)").replace(r"\{a\}", r"(?P<a>\d+)")
                    patterns.append((re.compile(f"^{rx}$", re.I), target))
                else:
                    exact[val.lower()] = target
            self.bets[bet.lower()] = (exact, patterns)
        self.unmapped: Counter = Counter()

    def bookmaker(self, name: str) -> str | None:
        return self.bookmakers.get((name or "").lower())

    def market(self, bet_name: str, value: str) -> str | None:
        bet = (bet_name or "").lower()
        if bet in self.ignore:
            return None
        if bet not in self.bets:
            self.unmapped[f"{bet_name} (tipo de apuesta)"] += 1
            return None
        exact, patterns = self.bets[bet]
        val = str(value).strip()
        target = exact.get(val.lower())
        if target is None:
            for rx, tpl in patterns:
                mt = rx.match(val)
                if mt:
                    g = mt.groupdict()
                    k = f"{float(g['line']):.1f}".replace(".", "_") if g.get("line") else ""
                    target = tpl.format(k=k, h=g.get("h", ""), a=g.get("a", ""), line=g.get("line", ""))
                    break
        if target is None or target not in MARKETS_BY_KEY:
            self.unmapped[f"{bet_name} = {val}"] += 1
            return None
        return target

    def log_unmapped(self) -> None:
        if not self.unmapped:
            return
        log.warning("Mercados de API-Football sin mapear (%d distintos). Editá %s si querés incluirlos:",
                    len(self.unmapped), MAPPING_PATH.name)
        for k, n in self.unmapped.most_common():
            log.warning("  sin mapear: %s  (%d cuotas)", k, n)


# ---------------------------------------------------------------------------
# Proveedor
# ---------------------------------------------------------------------------
def _parse_dt(s: str) -> datetime:
    # La API devuelve la fecha en la zona pedida con `timezone`; se guarda naive (hora local).
    return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)


def _parse_date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def normalize_status(short: str | None) -> str:
    if short in FINISHED:
        return "FT"
    if short in LIVE:
        return "LIVE"
    if short in NOT_STARTED:
        return "NS"
    if short in POSTPONED:
        return "PST"
    return "CANC"


def _int(v) -> int | None:
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip().rstrip("%")
        if not v:
            return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# Tipos de /fixtures/statistics -> sufijo de columna propia
STAT_TYPES = {
    "corner kicks": "corners",
    "total shots": "shots",
    "shots on goal": "sot",
    "yellow cards": "yellow",
    "dangerous attacks": "dangerous",  # API-Football no suele informarlo: queda vacío
}


def parse_fixture(item: dict) -> FixtureDTO:
    fx, lg, teams = item["fixture"], item["league"], item["teams"]
    score = item.get("score") or {}
    status = normalize_status((fx.get("status") or {}).get("short"))
    ft = score.get("fulltime") or {}
    ht = score.get("halftime") or {}
    goals = item.get("goals") or {}
    # Para partidos con alargue se usa el resultado de los 90' (score.fulltime).
    hg = ft.get("home") if ft.get("home") is not None else goals.get("home")
    ag = ft.get("away") if ft.get("away") is not None else goals.get("away")
    return FixtureDTO(
        api_id=fx["id"],
        league_api_id=lg["id"],
        season_year=lg["season"],
        kickoff=_parse_dt(fx["date"]),
        status=status,
        status_detail=(fx.get("status") or {}).get("short"),
        round=lg.get("round"),
        home=TeamDTO(teams["home"]["id"], teams["home"]["name"], logo=teams["home"].get("logo")),
        away=TeamDTO(teams["away"]["id"], teams["away"]["name"], logo=teams["away"].get("logo")),
        hg=hg if status != "NS" else None,
        ag=ag if status != "NS" else None,
        hthg=ht.get("home"),
        htag=ht.get("away"),
    )


def parse_goals(events: list[dict], home_api_id: int, away_api_id: int,
                ft: tuple[int | None, int | None] | None = None) -> list[GoalDTO]:
    """Extrae los goles (sin penales errados ni goles del alargue/tanda) de /fixtures/events.

    Si el conteo por lado no coincide con el resultado, prueba invertir los goles en contra
    (la API no siempre indica de forma consistente a qué equipo atribuirlos)."""
    goals: list[tuple[GoalDTO, bool]] = []
    for ev in events:
        if (ev.get("type") or "").lower() != "goal":
            continue
        detail = (ev.get("detail") or "").lower()
        if "missed" in detail:
            continue
        t = ev.get("time") or {}
        elapsed, extra = t.get("elapsed"), t.get("extra")
        if elapsed is None or elapsed > 90:  # alargue o penales
            continue
        team_id = (ev.get("team") or {}).get("id")
        side = "home" if team_id == home_api_id else ("away" if team_id == away_api_id else None)
        if side is None:
            continue
        half = 1 if elapsed <= 45 else 2
        goals.append((GoalDTO(minute=elapsed, extra=extra, half=half, side=side), "own" in detail))

    def counts(gs):
        return (sum(g.side == "home" for g in gs), sum(g.side == "away" for g in gs))

    plain = [g for g, _ in goals]
    if ft and None not in ft and counts(plain) != tuple(ft):
        flipped = [
            GoalDTO(g.minute, g.extra, g.half, ("away" if g.side == "home" else "home") if own else g.side)
            for g, own in goals
        ]
        if counts(flipped) == tuple(ft):
            return flipped
    return plain


def parse_statistics(stats: list[dict], home_api_id: int, away_api_id: int) -> dict[str, int | None]:
    out: dict[str, int | None] = {}
    for block in stats:
        team_id = (block.get("team") or {}).get("id")
        side = "home" if team_id == home_api_id else ("away" if team_id == away_api_id else None)
        if side is None:
            continue
        for st in block.get("statistics") or []:
            col = STAT_TYPES.get((st.get("type") or "").lower())
            if col:
                v = _int(st.get("value"))
                # Las tarjetas y corners en 0 vienen como null en la API.
                out[f"{side}_{col}"] = 0 if v is None and col in ("yellow", "corners") else v
    return out


class ApiFootballProvider(DataProvider):
    name = "api_football"

    def __init__(self, client: ApiFootballClient, mapper: OddsMapper | None = None):
        self.client = client
        self.mapper = mapper or OddsMapper()

    @classmethod
    def from_env(cls) -> "ApiFootballProvider":
        return cls(ApiFootballClient(config.api_football_key() or ""))

    def get_leagues(self, league_ids: list[int]) -> list[LeagueDTO]:
        out = []
        for lid in league_ids:
            for item in self.client.leagues(lid):
                lg, c = item["league"], item.get("country") or {}
                out.append(LeagueDTO(
                    api_id=lg["id"], name=lg["name"], country=c.get("name") or "Mundo",
                    country_code=c.get("code"), logo=lg.get("logo"),
                    seasons=[SeasonDTO(s["year"], _parse_date(s.get("start")), _parse_date(s.get("end")),
                                       bool(s.get("current"))) for s in item.get("seasons") or []],
                ))
        return out

    def get_teams(self, league_api_id: int, season: int) -> list[TeamDTO]:
        return [
            TeamDTO(t["team"]["id"], t["team"]["name"], t["team"].get("country"), t["team"].get("logo"))
            for t in self.client.teams(league_api_id, season)
        ]

    def get_fixtures(self, league_api_id: int, season: int) -> list[FixtureDTO]:
        return [parse_fixture(i) for i in self.client.fixtures(league=league_api_id, season=season)]

    def get_fixtures_by_date(self, day: date, league_api_id: int | None = None, season: int | None = None) -> list[FixtureDTO]:
        return [parse_fixture(i) for i in self.client.fixtures(date=day.isoformat(), league=league_api_id, season=season)]

    def get_fixture_details(self, fixture_ids: list[int]) -> list[FixtureDetailsDTO]:
        out: list[FixtureDetailsDTO] = []
        for i in range(0, len(fixture_ids), 20):
            for item in self.client.fixtures_by_ids(fixture_ids[i:i + 20]):
                fx = parse_fixture(item)
                h, a = fx.home.api_id, fx.away.api_id
                events = item.get("events")
                stats = item.get("statistics")
                if events is None:  # respaldo: endpoints individuales
                    events = self.client.fixture_events(fx.api_id)
                if stats is None:
                    stats = self.client.fixture_statistics(fx.api_id)
                out.append(FixtureDetailsDTO(
                    api_id=fx.api_id,
                    goals=parse_goals(events, h, a, (fx.hg, fx.ag)) if events is not None else None,
                    stats=parse_statistics(stats or [], h, a),
                ))
        return out

    def get_odds(self, day: date, league_api_id: int, season: int) -> list[OddsDTO]:
        out: list[OddsDTO] = []
        for item in self.client.odds(date=day.isoformat(), league=league_api_id, season=season):
            out += self.parse_odds_item(item)
        return out

    def parse_odds_item(self, item: dict) -> list[OddsDTO]:
        fid = item["fixture"]["id"]
        out: dict[tuple[str, str], OddsDTO] = {}
        for bm in item.get("bookmakers") or []:
            bkey = self.mapper.bookmaker(bm.get("name"))
            if bkey is None:
                continue
            for bet in bm.get("bets") or []:
                for v in bet.get("values") or []:
                    mkey = self.mapper.market(bet.get("name"), v.get("value"))
                    if mkey is None:
                        continue
                    try:
                        price = float(v.get("odd"))
                    except (TypeError, ValueError):
                        continue
                    out[(bkey, mkey)] = OddsDTO(fid, bkey, mkey, price)
        return list(out.values())

    def check_mapping(self) -> dict:
        """Consulta /odds/bookmakers y /odds/bets y reporta qué falta en el mapeo."""
        bms = [b["name"] for b in self.client.odds_bookmakers()]
        bets = [b["name"] for b in self.client.odds_bets()]
        mapped_bms = [b for b in bms if self.mapper.bookmaker(b)]
        missing_bms = [k for k in self.mapper.bookmakers if k not in {b.lower() for b in bms}]
        unmapped_bets = [b for b in bets if b.lower() not in self.mapper.bets and b.lower() not in self.mapper.ignore]
        return {"bookmakers_mapeadas": mapped_bms, "bookmakers_configuradas_no_encontradas": missing_bms,
                "tipos_sin_mapear": unmapped_bets, "total_tipos": len(bets)}
