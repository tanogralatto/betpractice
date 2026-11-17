from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import PpgProfile, Preset, RealOddsProfile, StatsProfile, StreaksProfile, UserProfile
from app.schemas import (PpgProfileIn, PresetIn, RealOddsProfileIn, StatsProfileIn, StreaksProfileIn,
                         UserProfileIn)

router = APIRouter(prefix="/api")

SUB = {
    "real_odds": (RealOddsProfile, RealOddsProfileIn, "real_odds_profile_id", ("sample", "home_as", "away_as")),
    "ppg": (PpgProfile, PpgProfileIn, "ppg_profile_id", ("home_as", "away_as")),
    "stats": (StatsProfile, StatsProfileIn, "stats_profile_id", ("seasons", "home_as", "away_as")),
    "streaks": (StreaksProfile, StreaksProfileIn, "streaks_profile_id", ("seasons", "home_as", "away_as")),
}


def _sub_dict(obj, fields) -> dict | None:
    if obj is None:
        return None
    return {"id": obj.id, "name": obj.name, **{f: getattr(obj, f) for f in fields}}


def _profile_dict(p: UserProfile) -> dict:
    return {
        "id": p.id, "name": p.name, "is_active": p.is_active,
        "real_odds_profile_id": p.real_odds_profile_id, "ppg_profile_id": p.ppg_profile_id,
        "stats_profile_id": p.stats_profile_id, "streaks_profile_id": p.streaks_profile_id,
        "real_odds_profile": _sub_dict(p.real_odds_profile, SUB["real_odds"][3]),
        "ppg_profile": _sub_dict(p.ppg_profile, SUB["ppg"][3]),
        "stats_profile": _sub_dict(p.stats_profile, SUB["stats"][3]),
        "streaks_profile": _sub_dict(p.streaks_profile, SUB["streaks"][3]),
        "fav_leagues": p.fav_leagues or [], "fav_markets": p.fav_markets or [], "fav_stats": p.fav_stats or [],
        "fav_streaks": p.fav_streaks or [], "fav_bookmakers": p.fav_bookmakers or [],
    }


def _get(db: Session, pid: int) -> UserProfile:
    p = db.get(UserProfile, pid)
    if p is None:
        raise HTTPException(404, "Perfil no encontrado")
    return p


# --- perfiles de usuario --------------------------------------------------------
@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    return [_profile_dict(p) for p in db.scalars(select(UserProfile).order_by(UserProfile.id))]


@router.post("/profiles")
def create_profile(body: UserProfileIn, db: Session = Depends(get_db)):
    p = UserProfile(**body.model_dump(), is_active=False)
    if db.scalar(select(UserProfile.id).limit(1)) is None:
        p.is_active = True
    db.add(p)
    db.commit()
    db.refresh(p)
    return _profile_dict(p)


@router.put("/profiles/{pid}")
def save_profile(pid: int, body: UserProfileIn, db: Session = Depends(get_db)):
    p = _get(db, pid)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _profile_dict(p)


@router.post("/profiles/{pid}/activate")
def activate_profile(pid: int, db: Session = Depends(get_db)):
    p = _get(db, pid)
    db.execute(update(UserProfile).values(is_active=False))
    p.is_active = True
    db.commit()
    db.refresh(p)
    return _profile_dict(p)


@router.delete("/profiles/{pid}")
def delete_profile(pid: int, db: Session = Depends(get_db)):
    p = _get(db, pid)
    if db.query(UserProfile).count() <= 1:
        raise HTTPException(400, "No se puede borrar el único perfil")
    was_active = p.is_active
    db.delete(p)
    db.flush()
    if was_active:
        other = db.scalar(select(UserProfile).order_by(UserProfile.id))
        other.is_active = True
    db.commit()
    return {"ok": True}


# --- sub-perfiles (cuota real, PPG, estadísticas, rachas) -------------------------
def _sub(kind: str):
    if kind not in SUB:
        raise HTTPException(404, "Tipo de perfil desconocido")
    return SUB[kind]


@router.get("/subprofiles/{kind}")
def list_sub(kind: str, db: Session = Depends(get_db)):
    model, _, _, fields = _sub(kind)
    return [_sub_dict(o, fields) for o in db.scalars(select(model).order_by(model.id))]


@router.post("/subprofiles/{kind}")
def create_sub(kind: str, body: dict, db: Session = Depends(get_db)):
    model, schema, _, fields = _sub(kind)
    data = schema.model_validate(body).model_dump()
    o = model(**data)
    db.add(o)
    db.commit()
    db.refresh(o)
    return _sub_dict(o, fields)


@router.put("/subprofiles/{kind}/{sid}")
def update_sub(kind: str, sid: int, body: dict, db: Session = Depends(get_db)):
    model, schema, _, fields = _sub(kind)
    o = db.get(model, sid)
    if o is None:
        raise HTTPException(404, "No encontrado")
    for k, v in schema.model_validate(body).model_dump().items():
        setattr(o, k, v)
    db.commit()
    return _sub_dict(o, fields)


@router.delete("/subprofiles/{kind}/{sid}")
def delete_sub(kind: str, sid: int, db: Session = Depends(get_db)):
    model, _, fk, _ = _sub(kind)
    o = db.get(model, sid)
    if o is None:
        raise HTTPException(404, "No encontrado")
    in_use = db.scalars(select(UserProfile.name).where(getattr(UserProfile, fk) == sid)).all()
    if in_use:
        raise HTTPException(400, f"Está en uso por: {', '.join(in_use)}")
    db.delete(o)
    db.commit()
    return {"ok": True}


# --- presets ---------------------------------------------------------------------
@router.get("/presets")
def list_presets(db: Session = Depends(get_db)):
    return [{"id": p.id, "name": p.name, "config": p.config} for p in db.scalars(select(Preset).order_by(Preset.name))]


@router.post("/presets")
def save_preset(body: PresetIn, db: Session = Depends(get_db)):
    p = db.scalar(select(Preset).where(Preset.name == body.name))
    if p is None:
        p = Preset(name=body.name)
        db.add(p)
    p.config = body.config
    db.commit()
    return {"id": p.id, "name": p.name, "config": p.config}


@router.delete("/presets/{pid}")
def delete_preset(pid: int, db: Session = Depends(get_db)):
    p = db.get(Preset, pid)
    if p:
        db.delete(p)
        db.commit()
    return {"ok": True}
