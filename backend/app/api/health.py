from fastapi import APIRouter, HTTPException
import redis
import os
from app.database import get_db_conn

router = APIRouter(prefix="/api/health", tags=["health"])

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

@router.get("")
async def get_system_health():
    status = {
        "db": "healthy",
        "redis": "healthy",
        "queue_backlog": 0,
        "status": "ok"
    }
    
    # Check PostgreSQL Database Connectivity
    try:
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT 1")
        c.fetchone()
        conn.close()
    except Exception as e:
        status["db"] = f"unhealthy: {str(e)}"
        status["status"] = "error"
        
    # Check Redis Connectivity & Queue Backlog Sizes
    try:
        r = redis.from_url(REDIS_URL)
        r.ping()
        high_len = r.llen("queue:high") or 0
        default_len = r.llen("queue:default") or 0
        low_len = r.llen("queue:low") or 0
        status["queue_backlog"] = high_len + default_len + low_len
    except Exception as e:
        status["redis"] = f"unhealthy: {str(e)}"
        status["status"] = "error"
        
    if status["status"] == "error":
        raise HTTPException(status_code=500, detail=status)
        
    return status
