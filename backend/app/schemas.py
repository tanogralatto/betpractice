from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Sample = Literal["last_8", "current", "current_plus_1", "current_plus_2", "current_plus_3"]
Role = Literal["home", "away", "both", "ignore"]
Seasons = Literal["current", "current_plus_1"]
HAB = Literal["home", "away", "both"]


class RealOddsProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sample: Sample = "current_plus_1"
    home_as: Role = "both"
    away_as: Role = "both"


class PpgProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    home_as: Literal["home", "both"] = "both"
    away_as: Literal["away", "both"] = "both"


class StatsProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    seasons: Seasons = "current_plus_1"
    home_as: HAB = "both"
    away_as: HAB = "both"


StreaksProfileIn = StatsProfileIn


class UserProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    real_odds_profile_id: int | None = None
    ppg_profile_id: int | None = None
    stats_profile_id: int | None = None
    streaks_profile_id: int | None = None
    fav_leagues: list[int] = []
    fav_markets: list[str] = []
    fav_stats: list[str] = []
    fav_streaks: list[str] = []
    fav_bookmakers: list[str] = []

    @field_validator("fav_markets")
    @classmethod
    def _m(cls, v):
        if len(v) > 10:
            raise ValueError("Máximo 10 mercados favoritos")
        return v

    @field_validator("fav_stats", "fav_streaks")
    @classmethod
    def _s(cls, v):
        if len(v) > 3:
            raise ValueError("Máximo 3")
        return v


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    config: dict


class PrematchRequest(BaseModel):
    date: str | None = None
    profile_id: int | None = None
    leagues: list[int] = []
    markets: list[str] | None = None
    stats: list[str] | None = None
    streaks: list[str] | None = None
    bookmaker: str | None = None
    hide_without_odds: bool = False
    sort: Literal["time", "league", "ppg_home", "ppg_away"] = "time"
    filters: dict | None = None
