@echo off
echo =========================================
echo   NetX Background Worker Engine — Starting...
echo =========================================

cd /d "%~dp0"

if not exist venv (
    echo [ERROR] Virtual environment not found! Please run run.bat first to set up.
    pause
    exit /b 1
)

echo [*] Starting NetX Background Schedulers and Syslog UDP Receiver...
echo.
venv\Scripts\python worker.py
pause
