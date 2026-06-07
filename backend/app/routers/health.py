"""
System Health Monitoring Router
Exposes system diagnostics, DB query performance, event loop lag, and resource usage.
"""
from fastapi import APIRouter, Depends
from app.services.auth import get_current_user
from app.services.health_monitor import monitor

router = APIRouter(prefix="/api/health", tags=["health-diagnostics"])

@router.get("/diagnostics")
def get_health_diagnostics(user: dict = Depends(get_current_user)):
    """Retrieve detailed diagnostics and metrics for self-health monitoring."""
    # Note: Only administrators or active users can query diagnostics
    return monitor.get_diagnostics()
