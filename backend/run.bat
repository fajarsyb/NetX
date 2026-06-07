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

echo [*] Starting FastAPI on http://localhost:8000
echo [*] API Docs: http://localhost:8000/api/docs
echo.
venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
pause
