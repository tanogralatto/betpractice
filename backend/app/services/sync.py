"""Sincronización incremental de un proveedor de datos a la base (upsert por id de API)."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import GoalEvent, League, Match, Odds, Season, Team
from app.providers.base import DataProvider, FixtureDTO, LeagueDTO, SeasonDTO, TeamDTO

log = logging.getLogger("sync")

def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


MATCH_FIELDS = ("kickoff", "status", "status_detail", "round", "hg", "ag", "hthg", "htag")


@dataclass
class SyncReport:
    leagues: int = 0
    seasons: int = 0
    teams: int = 0
    matches_new: int = 0
    matches_updated: int = 0
    details: int = 0
    odds: int = 0
    skipped: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        s = (f"ligas={self.leagues} temporadas={self.seasons} equipos={self.teams} "
             f"partidos nuevos={self.matches_new} actualizados={self.matches_updated} "
             f"detalles={self.details} cuotas={self.odds}")
        if self.skipped:
            s += "\n  omitido (ya completo): " + "; ".join(self.skipped)
        return s


def _season_name(s: SeasonDTO) -> str:
    if s.start and s.end and s.start.year != s.end.year:
        return f"{s.year}/{str(s.year + 1)[-2:]}"
    return str(s.year)


class Syncer:
    def __init__(self, db: Session, provider: DataProvider):
        self.db = db
        self.p = provider
        self.report = SyncReport()
        self._team_cache: dict[int, Team] = {}

    # --- upserts -------------------------------------------------------------
    def upsert_league(self, dto: LeagueDTO) -> League:
        lg = self.db.scalar(select(League).where(League.api_id == dto.api_id))
        if lg is None:
            lg = League(api_id=dto.api_id, source=self.p.name, tracked=True)
            self.db.add(lg)
        lg.name, lg.country, lg.country_code, lg.logo = dto.name, dto.country, dto.country_code, dto.logo
        self.db.flush()
        for s in dto.seasons:
            self.upsert_season(lg, s)
        self.report.leagues += 1
        return lg

    def upsert_season(self, lg: League, s: SeasonDTO) -> Season:
        se = self.db.scalar(select(Season).where(Season.league_id == lg.id, Season.year == s.year))
        if se is None:
            se = Season(league_id=lg.id, year=s.year)
            self.db.add(se)
            self.report.seasons += 1
        se.name = _season_name(s)
        se.start_date, se.end_date, se.is_current = s.start, s.end, s.current
        self.db.flush()
        return se

    def upsert_team(self, dto: TeamDTO) -> Team:
        t = self._team_cache.get(dto.api_id) or self.db.scalar(select(Team).where(Team.api_id == dto.api_id))
        if t is None:
            t = Team(api_id=dto.api_id, name=dto.name)
            self.db.add(t)
            self.report.teams += 1
        t.name = dto.name
        if dto.country:
            t.country = dto.country
        if dto.logo:
            t.logo = dto.logo
        self.db.flush()
        self._team_cache[dto.api_id] = t
        return t

    def upsert_fixture(self, dto: FixtureDTO, lg: League) -> Match:
        se = self.db.scalar(select(Season).where(Season.league_id == lg.id, Season.year == dto.season_year))
        if se is None:
            se = self.upsert_season(lg, SeasonDTO(dto.season_year))
        home, away = self.upsert_team(dto.home), self.upsert_team(dto.away)
        m = self.db.scalar(select(Match).where(Match.api_id == dto.api_id))
        values = {f: getattr(dto, f) for f in MATCH_FIELDS}
        if m is None:
            m = Match(api_id=dto.api_id, league_id=lg.id, season_id=se.id, home_id=home.id, away_id=away.id,
                      details_synced=False, updated_at=_now(), **values)
            self.db.add(m)
            self.report.matches_new += 1
        else:
            changed = any(getattr(m, f) != v for f, v in values.items())
            if changed:
                score_changed = (m.hg, m.ag, m.hthg, m.htag) != (dto.hg, dto.ag, dto.hthg, dto.htag)
                for f, v in values.items():
                    setattr(m, f, v)
                if score_changed:
                    m.details_synced = False
                m.updated_at = _now()
                self.report.matches_updated += 1
            m.home_id, m.away_id, m.season_id = home.id, away.id, se.id
        return m

    # --- operaciones ---------------------------------------------------------
    def sync_leagues(self, league_api_ids: list[int]) -> list[League]:
        out = [self.upsert_league(dto) for dto in self.p.get_leagues(league_api_ids)]
        self.db.commit()
        return out

    def resolve_season(self, lg: League, spec: str | int) -> int | None:
        """`spec`: año (2025), 'current' o 'previous' (la anterior a la actual)."""
        years = sorted(s.year for s in lg.seasons)
        if not years:
            return None
        cur = next((s.year for s in lg.seasons if s.is_current), years[-1])
        if spec == "current":
            return cur
        if spec == "previous":
            prev = [y for y in years if y < cur]
            return prev[-1] if prev else None
        return int(spec)

    def season_complete(self, lg: League, year: int) -> bool:
        se = self.db.scalar(select(Season).where(Season.league_id == lg.id, Season.year == year))
        if se is None or se.is_current:
            return False
        ms = self.db.scalars(select(Match).where(Match.season_id == se.id)).all()
        return bool(ms) and all(m.status in ("FT", "CANC") and (m.details_synced or m.status != "FT") for m in ms)

    def sync_history(self, league_api_id: int, season_specs: list[str], force: bool = False) -> None:
        """Ligas, temporadas, equipos, partidos y detalles (goles + estadísticas) por liga y temporada."""
        (lg,) = self.sync_leagues([league_api_id]) or (None,)
        if lg is None:
            log.warning("Liga %s no encontrada en el proveedor", league_api_id)
            return
        self.db.refresh(lg)
        for spec in season_specs:
            year = self.resolve_season(lg, spec)
            if year is None:
                log.warning("%s: no hay temporada %r", lg.name, spec)
                continue
            if not force and self.season_complete(lg, year):
                self.report.skipped.append(f"{lg.name} {year}")
                continue
            log.info("Sincronizando %s %s…", lg.name, year)
            for t in self.p.get_teams(league_api_id, year):
                self.upsert_team(t)
            for fx in self.p.get_fixtures(league_api_id, year):
                self.upsert_fixture(fx, lg)
            self.db.commit()
            self.sync_details(league_id=lg.id)

    def sync_details(self, league_id: int | None = None, limit: int | None = None) -> None:
        """Eventos (minutos de gol) y estadísticas de los partidos terminados que todavía no los tienen."""
        q = select(Match).where(Match.status == "FT", Match.details_synced.is_(False), Match.api_id.is_not(None))
        if league_id:
            q = q.where(Match.league_id == league_id)
        pending = self.db.scalars(q.order_by(Match.kickoff)).all()
        if limit:
            pending = pending[:limit]
        by_api = {m.api_id: m for m in pending}
        ids = list(by_api)
        for i in range(0, len(ids), 20):
            for d in self.p.get_fixture_details(ids[i:i + 20]):
                m = by_api.get(d.api_id)
                if m is None:
                    continue
                if d.goals is not None:
                    self.db.execute(delete(GoalEvent).where(GoalEvent.match_id == m.id))
                    for g in d.goals:
                        self.db.add(GoalEvent(match_id=m.id, minute=g.minute, extra=g.extra, half=g.half, side=g.side))
                for k, v in d.stats.items():
                    setattr(m, k, v)
                m.details_synced = True
                self.report.details += 1
            self.db.commit()

    def tracked_leagues(self) -> list[League]:
        return list(self.db.scalars(select(League).where(League.tracked.is_(True), League.api_id.is_not(None))))

    def sync_day(self, day: date, odds: bool = True) -> None:
        """Partidos del día (de las ligas sincronizadas) y sus cuotas pre partido."""
        leagues = {lg.api_id: lg for lg in self.tracked_leagues()}
        if not leagues:
            log.warning("No hay ligas sincronizadas: corré primero `sync history`.")
            return
        fixtures = [f for f in self.p.get_fixtures_by_date(day) if f.league_api_id in leagues]
        pairs = set()
        for fx in fixtures:
            self.upsert_fixture(fx, leagues[fx.league_api_id])
            if fx.status == "NS":
                pairs.add((fx.league_api_id, fx.season_year))
        self.db.commit()
        self.sync_details()
        if odds:
            for league_api_id, season in sorted(pairs):
                self.sync_odds(day, league_api_id, season)

    def sync_odds(self, day: date, league_api_id: int, season: int) -> None:
        dtos = self.p.get_odds(day, league_api_id, season)
        api_ids = {d.fixture_api_id for d in dtos}
        matches = {m.api_id: m for m in self.db.scalars(select(Match).where(Match.api_id.in_(api_ids)))} if api_ids else {}
        now = _now()
        existing = {}
        if matches:
            for o in self.db.scalars(select(Odds).where(Odds.match_id.in_([m.id for m in matches.values()]))):
                existing[(o.match_id, o.bookmaker, o.market_key)] = o
        for d in dtos:
            m = matches.get(d.fixture_api_id)
            if m is None:
                continue
            o = existing.get((m.id, d.bookmaker, d.market_key))
            if o is None:
                o = Odds(match_id=m.id, bookmaker=d.bookmaker, market_key=d.market_key)
                self.db.add(o)
                existing[(m.id, d.bookmaker, d.market_key)] = o
            o.price, o.updated_at = d.price, now
            self.report.odds += 1
        self.db.commit()
        mapper = getattr(self.p, "mapper", None)
        if mapper is not None:
            mapper.log_unmapped()
            mapper.unmapped.clear()
