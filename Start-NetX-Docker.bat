@echo off
title NetX Docker - Startup Control Panel
color 0A
cls

echo =======================================================================
echo                 NETX DOCKER STARTUP CONTROLLER
echo =======================================================================
echo System: Windows OS detected.
echo.

echo [+] Step 1: Cleaning up any orphaned node processes on port 5173...
taskkill /f /im node.exe >nul 2>&1
echo [✓] Port cleanup complete.
echo.

echo [+] Step 2: Starting NetX Docker Compose Services (API, Worker, Scheduler, Syslog, Postgres, Redis)...
docker compose up -d
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [-] Error: Gagal menjalankan docker-compose. Pastikan Docker Desktop sudah aktif.
    echo.
    pause
    exit /b %ERRORLEVEL%
)
echo [✓] Docker containers are running.
echo.

echo [+] Step 3: Starting NetX Frontend Developer Server (Vite on Host)...
start "NetX Frontend Dev" cmd /c "cd frontend && npm run dev"
echo [✓] Frontend dev server launched in a separate window.
echo.

echo [+] Step 4: Waiting for servers to initialize (3 seconds)...
timeout /t 3 /nobreak >nul
echo.

echo [+] Step 5: Launching default web browser to NetX...
start http://localhost:5173/
echo [✓] Browser opened to http://localhost:5173/
echo.

echo =======================================================================
echo NetX is now running!
echo  - Local Access: http://localhost:5173/
echo  - Backend API: http://localhost:8000/
echo  - Syslog Server: UDP port 514 (running in Docker)
echo.
echo * Note: You can view container logs with: docker compose logs -f
echo * Note: Close the Vite server window to stop the frontend.
echo =======================================================================
echo.
pause
