#!/bin/bash
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 iniciar.py
else
  echo "Falta Python. Instalalo desde https://www.python.org/downloads/"
  read -p "Apretá Enter para cerrar…"
fi
