@echo off
title NetX - Startup Control Panel
color 0B
cls

echo =======================================================================
echo                         NETX STARTUP CONTROLLER
echo =======================================================================
echo System: Windows OS detected.
echo.

echo [+] Step 1: Cleaning up any orphaned python/node processes...
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo [✓] Port cleanup complete.
echo.

echo [+] Step 2: Starting NetX Backend Server (FastAPI)...
start "NetX Backend Server" cmd /c "cd backend && venv\Scripts\python main.py"
echo [✓] Backend launched in a separate window.
echo.

echo [+] Step 3: Starting NetX Frontend Developer Server (Vite)...
start "NetX Frontend Dev" cmd /c "cd frontend && npm run dev"
echo [✓] Frontend dev server launched in a separate window.
echo.

echo [+] Step 4: Waiting for servers to initialize (5 seconds)...
timeout /t 5 /nobreak >nul
echo.

echo [+] Step 5: Launching default web browser to NetX...
start http://localhost:5173/
echo [✓] Browser opened to http://localhost:5173/
echo.

echo =======================================================================
echo NetX is now running!
echo  - Local Access: http://localhost:5173/
echo  - Network Access (for other people on your network):
powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { write-host '    -> http://' $_.IPAddress ':5173/' -ForegroundColor Green }"
echo  - Backend API: http://localhost:8000/
echo  - Syslog Server: UDP port 514 (running in backend)
echo.
echo * Note: Close the newly opened command windows to stop the servers.
echo =======================================================================
echo.
pause
