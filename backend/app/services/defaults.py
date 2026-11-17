"""Perfiles por defecto (se crean si no existe ninguno)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PpgProfile, RealOddsProfile, StatsProfile, StreaksProfile, UserProfile


def ensure_default_profiles(db: Session) -> None:
    if db.scalar(select(UserProfile.id).limit(1)) is not None:
        return
    ro = RealOddsProfile(name="Temp. actual + 1 · Ambos", sample="current_plus_1", home_as="both", away_as="both")
    db.add_all([
        ro,
        RealOddsProfile(name="Últimos 8 · Local/Visitante", sample="last_8", home_as="home", away_as="away"),
        RealOddsProfile(name="Temp. actual · Local/Visitante", sample="current", home_as="home", away_as="away"),
    ])
    ppg = PpgProfile(name="Ambos", home_as="both", away_as="both")
    db.add_all([ppg, PpgProfile(name="Local/Visitante", home_as="home", away_as="away")])
    st = StatsProfile(name="Temp. actual + 1 · Ambos", seasons="current_plus_1", home_as="both", away_as="both")
    db.add_all([st, StatsProfile(name="Temp. actual · Local/Visitante", seasons="current", home_as="home", away_as="away")])
    sk = StreaksProfile(name="Temp. actual + 1 · Ambos", seasons="current_plus_1", home_as="both", away_as="both")
    db.add_all([sk, StreaksProfile(name="Temp. actual · Local/Visitante", seasons="current", home_as="home", away_as="away")])
    db.flush()
    db.add(UserProfile(
        name="GOL 1er TIEMPO",
        is_active=True,
        real_odds_profile_id=ro.id,
        ppg_profile_id=ppg.id,
        stats_profile_id=st.id,
        streaks_profile_id=sk.id,
        fav_leagues=[],  # vacío = todas las ligas
        fav_markets=["ou_ht_over_0_5"],
        fav_stats=["goals_total"],
        fav_streaks=["ht_over_0_5", "ht_under_0_5"],
        fav_bookmakers=["best", "bet365", "pinnacle", "1xbet"],
    ))
    db.commit()
