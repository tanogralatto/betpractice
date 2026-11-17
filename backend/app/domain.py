"""Modelo de dominio puro (sin base de datos).

Todos los cálculos (cuota real, PPG, estadísticas, rachas, mercados) trabajan
sobre `MatchData`, lo que permite testearlos sin tocar la base.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(slots=True)
class Goal:
    minute: int  # minuto "de reloj" (un gol en 45+2 se guarda como 45, en 90+3 como 90)
    side: str  # "home" | "away"
    half: int  # 1 | 2


@dataclass(slots=True)
class MatchData:
    id: int
    league_id: int
    season_id: int
    kickoff: datetime
    home_id: int
    away_id: int
    status: str = "FT"  # "FT" (terminado) | "NS" (no empezó)
    hg: int | None = None  # goles local FT
    ag: int | None = None  # goles visitante FT
    hthg: int | None = None  # goles local al descanso
    htag: int | None = None  # goles visitante al descanso
    goals: list[Goal] = field(default_factory=list)
    home_corners: int | None = None
    away_corners: int | None = None
    home_shots: int | None = None
    away_shots: int | None = None
    home_sot: int | None = None
    away_sot: int | None = None
    home_dangerous: int | None = None
    away_dangerous: int | None = None
    home_yellow: int | None = None
    away_yellow: int | None = None

    @property
    def finished(self) -> bool:
        return self.status == "FT" and self.hg is not None and self.ag is not None

    # --- derivados -------------------------------------------------------
    @property
    def total(self) -> int:
        return self.hg + self.ag

    @property
    def ht_total(self) -> int:
        return self.hthg + self.htag

    @property
    def sh_hg(self) -> int:  # goles local en el 2do tiempo
        return self.hg - self.hthg

    @property
    def sh_ag(self) -> int:
        return self.ag - self.htag

    @property
    def sh_total(self) -> int:
        return self.sh_hg + self.sh_ag

    @property
    def total_corners(self) -> int | None:
        if self.home_corners is None or self.away_corners is None:
            return None
        return self.home_corners + self.away_corners

    def sorted_goals(self) -> list[Goal]:
        return sorted(self.goals, key=lambda g: (g.half, g.minute))

    # --- perspectiva de un equipo -----------------------------------------
    def side_of(self, team_id: int) -> str:
        if team_id == self.home_id:
            return "home"
        if team_id == self.away_id:
            return "away"
        raise ValueError(f"El equipo {team_id} no jugó el partido {self.id}")

    def gf(self, team_id: int) -> int:
        return self.hg if self.side_of(team_id) == "home" else self.ag

    def ga(self, team_id: int) -> int:
        return self.ag if self.side_of(team_id) == "home" else self.hg

    def ht_gf(self, team_id: int) -> int:
        return self.hthg if self.side_of(team_id) == "home" else self.htag

    def ht_ga(self, team_id: int) -> int:
        return self.htag if self.side_of(team_id) == "home" else self.hthg

    def stat_for(self, team_id: int, name: str) -> int | None:
        """Devuelve home_<name> o away_<name> según el lado del equipo."""
        return getattr(self, f"{self.side_of(team_id)}_{name}")


def result_char(gf: int, ga: int) -> str:
    return "W" if gf > ga else ("D" if gf == ga else "L")
