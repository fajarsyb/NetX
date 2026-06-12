@echo off
setlocal
set DB_ENGINE=postgresql
set DB_HOST=127.0.0.1
set DB_PORT=5432
set DB_NAME=netx
set DB_USER=postgres
set DB_PASSWORD=RxVUDCKZDM3MG9rckvFe
set REDIS_URL=redis://127.0.0.1:6379/0
set TZ=Asia/Jakarta

echo [*] Starting syslog server...
start "NetX Syslog" cmd /c venv\Scripts\python -m app.services.syslog_server

echo [*] Starting SNMP Trap receiver...
start "NetX SNMP Trap" cmd /c venv\Scripts\python -m app.services.snmp_trap_receiver

echo [*] Starting scheduler...
start "NetX Scheduler" cmd /c venv\Scripts\python main_scheduler.py

echo [*] Starting worker...
set NETX_MODE=worker
start "NetX Worker" cmd /c venv\Scripts\python worker.py

echo [*] Starting API server on port 8000...
set NETX_MODE=api
venv\Scripts\uvicorn main:app --host 0.0.0.0 --port 8000
