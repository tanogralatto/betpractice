from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import SessionLocal, init_db
from app.routers import data, profiles
from app.services.defaults import ensure_default_profiles


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as db:
        ensure_default_profiles(db)
    yield


app = FastAPI(title="Apuestas · Estadísticas de fútbol", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(data.router)
app.include_router(profiles.router)
