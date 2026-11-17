"""Inicia la app en tu computadora: instala lo necesario, prepara los datos y abre el navegador.

No hace falta correrlo a mano: usá "iniciar-windows.bat" (Windows) o "iniciar-mac.command" (Mac).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
WINDOWS = os.name == "nt"
VENV_PY = BACKEND / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")
URL = "http://localhost:5173"


def paso(n: int, texto: str) -> None:
    print(f"\n[{n}/5] {texto}", flush=True)


def salir(msg: str) -> None:
    print("\n" + "=" * 60 + f"\n{msg}\n" + "=" * 60)
    input("\nApretá Enter para cerrar…")
    sys.exit(1)


def correr(cmd: list[str], cwd: Path) -> None:
    r = subprocess.run(cmd, cwd=cwd, shell=WINDOWS and cmd[0] == "npm")
    if r.returncode != 0:
        salir(f"Falló: {' '.join(cmd)}\nRevisá el mensaje de arriba (¿hay conexión a internet?).")


def esperar(url: str, segundos: int = 90) -> bool:
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(1)
    return False


def main() -> None:
    print("=== Cuotas reales · iniciando ===")
    if sys.version_info < (3, 10):
        salir("Necesitás Python 3.10 o más nuevo. Bajalo de https://www.python.org/downloads/")

    paso(1, "Revisando Node.js…")
    if shutil.which("npm") is None:
        salir("Falta Node.js. Instalalo desde https://nodejs.org (botón LTS), "
              "cerrá esta ventana y volvé a abrir el archivo de inicio.")

    paso(2, "Preparando el motor (la primera vez tarda unos minutos)…")
    if not VENV_PY.exists():
        correr([sys.executable, "-m", "venv", ".venv"], BACKEND)
    marca = BACKEND / ".venv" / ".instalado"
    req = BACKEND / "requirements.txt"
    if not marca.exists() or marca.stat().st_mtime < req.stat().st_mtime:
        correr([str(VENV_PY), "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", "requirements.txt"], BACKEND)
        marca.touch()

    paso(3, "Preparando los datos de prueba…")
    db = BACKEND / "betpractice_seed.db"
    proveedor = os.environ.get("DATA_PROVIDER", "seed")
    if proveedor == "seed" and (not db.exists() or date.fromtimestamp(db.stat().st_mtime) != date.today()):
        # Los datos de prueba se generan alrededor del día de hoy: se regeneran una vez por día.
        correr([str(VENV_PY), "-m", "app.seed"], BACKEND)
    else:
        print("Datos listos.")

    paso(4, "Preparando la pantalla…")
    if not (FRONTEND / "node_modules").exists():
        correr(["npm", "install", "--no-audit", "--no-fund"], FRONTEND)

    paso(5, "Abriendo la app…")
    procesos = [
        subprocess.Popen([str(VENV_PY), "-m", "uvicorn", "app.main:app", "--port", "8000"], cwd=BACKEND),
        subprocess.Popen(["npm", "run", "dev", "--", "--port", "5173", "--strictPort"], cwd=FRONTEND, shell=WINDOWS),
    ]
    try:
        if esperar("http://localhost:8000/api/health") and esperar(URL):
            webbrowser.open(URL)
            print("\n" + "=" * 60)
            print(f"  La app está abierta en {URL}")
            print("  Para cerrarla, cerrá esta ventana (o apretá Ctrl+C).")
            print("=" * 60 + "\n")
        else:
            print("La app tardó demasiado en arrancar. Revisá los mensajes de arriba.")
        while all(p.poll() is None for p in procesos):
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procesos:
            p.terminate()


if __name__ == "__main__":
    main()
