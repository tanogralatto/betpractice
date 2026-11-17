"""Interfaz común de proveedores de datos y DTOs normalizados.

Un proveedor traduce el formato de su API a estos DTOs; el servicio de
sincronización (`app/services/sync.py`) los guarda en la base con upsert.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class SeasonDTO:
    year: int
    start: date | None = None
    end: date | None = None
    current: bool = False


@dataclass
class LeagueDTO:
    api_id: int
    name: str
    country: str
    country_code: str | None = None
    logo: str | None = None
    seasons: list[SeasonDTO] = field(default_factory=list)


@dataclass
class TeamDTO:
    api_id: int
    name: str
    country: str | None = None
    logo: str | None = None


@dataclass
class FixtureDTO:
    api_id: int
    league_api_id: int
    season_year: int
    kickoff: datetime  # hora local (naive) en la zona configurada
    status: str  # NS | LIVE | FT | PST | CANC
    status_detail: str | None
    home: TeamDTO
    away: TeamDTO
    round: str | None = None
    hg: int | None = None
    ag: int | None = None
    hthg: int | None = None
    htag: int | None = None


@dataclass
class GoalDTO:
    minute: int
    extra: int | None
    half: int
    side: str  # home | away


@dataclass
class FixtureDetailsDTO:
    api_id: int
    goals: list[GoalDTO] | None = None  # None = el proveedor no trajo eventos
    stats: dict[str, int | None] = field(default_factory=dict)  # home_corners, away_shots, ...


@dataclass
class OddsDTO:
    fixture_api_id: int
    bookmaker: str  # clave interna: bet365 | pinnacle | 1xbet
    market_key: str  # clave del catálogo de mercados
    price: float


class DataProvider(ABC):
    name: str = "base"

    @abstractmethod
    def get_leagues(self, league_ids: list[int]) -> list[LeagueDTO]: ...

    @abstractmethod
    def get_teams(self, league_api_id: int, season: int) -> list[TeamDTO]: ...

    @abstractmethod
    def get_fixtures(self, league_api_id: int, season: int) -> list[FixtureDTO]: ...

    @abstractmethod
    def get_fixtures_by_date(self, day: date, league_api_id: int | None = None, season: int | None = None) -> list[FixtureDTO]: ...

    @abstractmethod
    def get_fixture_details(self, fixture_ids: list[int]) -> list[FixtureDetailsDTO]: ...

    @abstractmethod
    def get_odds(self, day: date, league_api_id: int, season: int) -> list[OddsDTO]: ...
