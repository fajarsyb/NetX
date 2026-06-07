import logging
import os
from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routers import devices, arp, lldp, auth, groups, cdp, routing, terminal, topology, snmp, credentials, audit_logs, backup, mac, device_backup
from app.services.auth import get_current_user
from app.services.device_backup_service import start_device_backup_scheduler
import asyncio

# Path to the built frontend (relative to this file)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="NetX API",
    description="Network Management Platform — SSH/Telnet • ARP • LLDP • OUI",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(groups.router, dependencies=[Depends(get_current_user)])
app.include_router(devices.router, dependencies=[Depends(get_current_user)])
app.include_router(arp.router, dependencies=[Depends(get_current_user)])
app.include_router(lldp.router, dependencies=[Depends(get_current_user)])
app.include_router(cdp.router, dependencies=[Depends(get_current_user)])
app.include_router(routing.router, dependencies=[Depends(get_current_user)])
app.include_router(topology.router, dependencies=[Depends(get_current_user)])
app.include_router(snmp.router, dependencies=[Depends(get_current_user)])
app.include_router(credentials.router, dependencies=[Depends(get_current_user)])
app.include_router(audit_logs.router, dependencies=[Depends(get_current_user)])
app.include_router(backup.router, dependencies=[Depends(get_current_user)])
app.include_router(mac.router, dependencies=[Depends(get_current_user)])
app.include_router(device_backup.router, dependencies=[Depends(get_current_user)])
app.include_router(terminal.router)


@app.on_event("startup")
async def startup_event():
    # Start the device configuration backup scheduler in the background
    asyncio.create_task(start_device_backup_scheduler())


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "app": "NetX", "version": "1.0.0"}


# ── Serve built React frontend (production mode) ─────────────────────────────
if FRONTEND_DIST.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """SPA fallback — return index.html for all non-API routes."""
        # If the file exists in dist, serve it directly
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        # Otherwise return index.html (React Router handles routing)
        return FileResponse(str(FRONTEND_DIST / "index.html"))
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"message": "NetX API running. Build frontend with: cd frontend && npm run build"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["app"],
    )
