@echo off
echo =========================================
echo   NetX Backend — Starting...
echo =========================================

cd /d "%~dp0"

if not exist venv (
    echo [*] Creating Python virtual environment...
    python -m venv venv
    echo [*] Installing dependencies...
    venv\Scripts\pip install -r requirements.txt
)

echo [*] Starting NetX Background Worker in a new window...
start "NetX Background Worker" cmd /c venv\Scripts\python worker.py

echo [*] Starting NetX FastAPI on http://localhost:8000
echo [*] API Docs: http://localhost:8000/api/docs
echo.
set NETX_MODE=api
venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
pause
