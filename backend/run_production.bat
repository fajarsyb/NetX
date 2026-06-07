@echo off
setlocal
echo =========================================
echo   NetX — Production Server
echo =========================================

:: Deteksi IP lokal
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" ^| head -1') do set LOCAL_IP=%%a
:: Alternatif jika head tidak tersedia
for /f "tokens=14" %%a in ('ipconfig ^| findstr "IPv4"') do (
    if not defined FOUND_IP set FOUND_IP=%%a
)

echo.
echo [1] Build frontend (production)...
cd /d "%~dp0..\frontend"
call npm run build
if errorlevel 1 (
    echo [ERROR] Build frontend gagal!
    pause
    exit /b 1
)

echo.
echo [2] Menjalankan NetX server...
cd /d "%~dp0"

if not exist venv (
    echo [*] Membuat virtual environment...
    python -m venv venv
    venv\Scripts\pip install -r requirements.txt
)

echo.
echo =========================================
echo   NetX berjalan di:
echo   http://localhost:8000
echo   http://%FOUND_IP%:8000   (akses dari host lain)
echo   http://%FOUND_IP%:8000/api/docs  (API Docs)
echo =========================================
echo.

venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000
pause
