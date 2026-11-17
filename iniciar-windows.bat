@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 iniciar.py & goto :eof)
where python >nul 2>nul && (python iniciar.py & goto :eof)
echo Falta Python. Instalalo desde https://www.python.org/downloads/
echo IMPORTANTE: en el instalador marca la casilla "Add python.exe to PATH".
pause
