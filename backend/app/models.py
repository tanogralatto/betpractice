from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


# ---------------------------------------------------------------------------
# Datos deportivos
# ---------------------------------------------------------------------------
class League(Base):
    __tablename__ = "leagues"
    id: Mapped[int] = mapped_column(primary_key=True)
    api_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)  # id en API-Football
    source: Mapped[str] = mapped_column(String(20), default="seed")
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(80))
    country_code: Mapped[str | None] = mapped_column(String(10))
    logo: Mapped[str | None] = mapped_column(String(255))
    tracked: Mapped[bool] = mapped_column(Boolean, default=True)  # se sincroniza a diario
    seasons: Mapped[list["Season"]] = relationship(back_populates="league", order_by="Season.year")


class Season(Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("league_id", "year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)  # 2025 = temporada 2025 o 2025/26
    name: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    league: Mapped[League] = relationship(back_populates="seasons")


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    api_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(80))
    logo: Mapped[str | None] = mapped_column(String(255))


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    api_id: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)
    home_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    away_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    kickoff: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(8), default="NS")  # NS | LIVE | FT | PST | CANC
    status_detail: Mapped[str | None] = mapped_column(String(8))  # estado original del proveedor
    round: Mapped[str | None] = mapped_column(String(60))
    hg: Mapped[int | None] = mapped_column(Integer)
    ag: Mapped[int | None] = mapped_column(Integer)
    hthg: Mapped[int | None] = mapped_column(Integer)
    htag: Mapped[int | None] = mapped_column(Integer)
    home_corners: Mapped[int | None] = mapped_column(Integer)
    away_corners: Mapped[int | None] = mapped_column(Integer)
    home_shots: Mapped[int | None] = mapped_column(Integer)
    away_shots: Mapped[int | None] = mapped_column(Integer)
    home_sot: Mapped[int | None] = mapped_column(Integer)
    away_sot: Mapped[int | None] = mapped_column(Integer)
    home_dangerous: Mapped[int | None] = mapped_column(Integer)
    away_dangerous: Mapped[int | None] = mapped_column(Integer)
    home_yellow: Mapped[int | None] = mapped_column(Integer)
    away_yellow: Mapped[int | None] = mapped_column(Integer)
    details_synced: Mapped[bool] = mapped_column(Boolean, default=False)  # eventos + estadísticas
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    league: Mapped[League] = relationship()
    season: Mapped[Season] = relationship()
    home: Mapped[Team] = relationship(foreign_keys=[home_id])
    away: Mapped[Team] = relationship(foreign_keys=[away_id])
    goals: Mapped[list["GoalEvent"]] = relationship(cascade="all, delete-orphan")


class GoalEvent(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    minute: Mapped[int] = mapped_column(Integer)
    extra: Mapped[int | None] = mapped_column(Integer)
    half: Mapped[int] = mapped_column(Integer)
    side: Mapped[str] = mapped_column(String(4))  # home | away


class Odds(Base):
    __tablename__ = "odds"
    __table_args__ = (UniqueConstraint("match_id", "bookmaker", "market_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    bookmaker: Mapped[str] = mapped_column(String(20))
    market_key: Mapped[str] = mapped_column(String(40))
    price: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)


# ---------------------------------------------------------------------------
# Perfiles
# ---------------------------------------------------------------------------
class RealOddsProfile(Base):
    __tablename__ = "real_odds_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    sample: Mapped[str] = mapped_column(String(20), default="current_plus_1")
    home_as: Mapped[str] = mapped_column(String(10), default="both")
    away_as: Mapped[str] = mapped_column(String(10), default="both")


class PpgProfile(Base):
    __tablename__ = "ppg_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    home_as: Mapped[str] = mapped_column(String(10), default="both")  # home | both
    away_as: Mapped[str] = mapped_column(String(10), default="both")  # away | both


class StatsProfile(Base):
    __tablename__ = "stats_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    seasons: Mapped[str] = mapped_column(String(20), default="current_plus_1")
    home_as: Mapped[str] = mapped_column(String(10), default="both")
    away_as: Mapped[str] = mapped_column(String(10), default="both")


class StreaksProfile(Base):
    __tablename__ = "streaks_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    seasons: Mapped[str] = mapped_column(String(20), default="current_plus_1")
    home_as: Mapped[str] = mapped_column(String(10), default="both")
    away_as: Mapped[str] = mapped_column(String(10), default="both")


class UserProfile(Base):
    __tablename__ = "user_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    real_odds_profile_id: Mapped[int | None] = mapped_column(ForeignKey("real_odds_profiles.id"))
    ppg_profile_id: Mapped[int | None] = mapped_column(ForeignKey("ppg_profiles.id"))
    stats_profile_id: Mapped[int | None] = mapped_column(ForeignKey("stats_profiles.id"))
    streaks_profile_id: Mapped[int | None] = mapped_column(ForeignKey("streaks_profiles.id"))
    fav_leagues: Mapped[list] = mapped_column(JSON, default=list)
    fav_markets: Mapped[list] = mapped_column(JSON, default=list)
    fav_stats: Mapped[list] = mapped_column(JSON, default=list)
    fav_streaks: Mapped[list] = mapped_column(JSON, default=list)
    fav_bookmakers: Mapped[list] = mapped_column(JSON, default=list)

    real_odds_profile: Mapped[RealOddsProfile | None] = relationship()
    ppg_profile: Mapped[PpgProfile | None] = relationship()
    stats_profile: Mapped[StatsProfile | None] = relationship()
    streaks_profile: Mapped[StreaksProfile | None] = relationship()


class Preset(Base):
    __tablename__ = "presets"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
