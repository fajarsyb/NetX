import logging
import os
from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routers import devices, auth, groups, terminal, topology, snmp, credentials, audit_logs, db_settings, health, thresholds, shell_notes, l2_analysis, remote_backups, ping, system_settings
from app.services.auth import get_current_user
from app.services.health_monitor import start_event_loop_monitor
from app.core.plugins import plugin_manager
from app.core.rate_limit import RateLimiter
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
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Mount Core Routers
# Default rate limiter for authenticated routes
api_rate_limiter = Depends(RateLimiter(limit=300, window=60, name="api"))

app.include_router(auth.router, dependencies=[Depends(RateLimiter(limit=300, window=60, name="api_auth_general"))])
app.include_router(groups.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(devices.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(ping.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(topology.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(snmp.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(credentials.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(audit_logs.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(db_settings.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(health.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(thresholds.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(terminal.router, dependencies=[Depends(RateLimiter(limit=100, window=60, name="terminal"))])
app.include_router(shell_notes.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(l2_analysis.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(remote_backups.router, dependencies=[Depends(get_current_user), api_rate_limiter])
app.include_router(system_settings.router, dependencies=[Depends(get_current_user), api_rate_limiter])


# 2. Mount Dynamic Plugin Routers
for r_info in plugin_manager.get_routers():
    deps = list(r_info["dependencies"]) if r_info["dependencies"] else [Depends(get_current_user)]
    deps.append(api_rate_limiter)
    app.include_router(r_info["router"], prefix=r_info["prefix"], dependencies=deps)


@app.on_event("startup")
async def startup_event():
    # Initialize database schema
    from app.database import init_db
    try:
        init_db()
        logging.getLogger("netx.main").info("Database schema initialized successfully.")
    except Exception as e:
        logging.getLogger("netx.main").error(f"Failed to initialize database schema: {e}")

    # Start the event loop latency monitor task
    asyncio.create_task(start_event_loop_monitor())
    
    # 3. Start Plugin Lifecycle Hooks
    for plugin in plugin_manager.get_plugins():
        try:
            await plugin.on_startup(app)
            logging.getLogger("netx.main").info(f"Plugin '{plugin.name}' started successfully.")
        except Exception as e:
            logging.getLogger("netx.main").error(f"Failed to run startup hooks for plugin '{plugin.name}': {e}")


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
