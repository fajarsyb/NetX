import uuid
import os
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List
from app.services.auth import get_current_user
from app.database import get_db_conn
from app.services.ping_service import ping_device
from app.worker.handlers import save_ping_result
from app.queue.queue import job_queue
import redis.asyncio as aioredis

router = APIRouter(prefix="/api/devices", tags=["ping"])

class BulkPingRequest(BaseModel):
    device_ids: List[int]

@router.post("/{device_id}/ping")
async def single_device_ping(device_id: int, current_user: dict = Depends(get_current_user)):
    """Ping a single device, save the result to DB, and return the result instantly."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, ip FROM devices WHERE id = ?", (device_id,))
    device = c.fetchone()
    conn.close()
    
    if not device:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")
        
    ip = device["ip"]
    if not ip:
        raise HTTPException(status_code=400, detail="IP perangkat tidak dikonfigurasi.")
        
    try:
        # Run the ping inside FastAPI request handler
        res = await ping_device(ip, count=3, timeout=3)
        
        # Save results in DB
        save_ping_result(device_id, res["rtt_ms"], res["loss_pct"], res["reachable"])
        
        # Get history to return along with result
        conn = get_db_conn()
        c = conn.cursor()
        c.execute(
            """
            SELECT rtt_ms, loss_pct, status, checked_at 
            FROM device_ping_history 
            WHERE device_id = ? 
            ORDER BY id DESC 
            LIMIT 10
            """,
            (device_id,)
        )
        history = [dict(r) for r in c.fetchall()]
        conn.close()
        
        return {
            "success": True,
            "device_id": device_id,
            "name": device["name"],
            "ip": ip,
            "result": res,
            "history": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{device_id}/ping/history")
async def get_device_ping_history(device_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieve the recent ping history (last 10 records) for a specific device."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        """
        SELECT rtt_ms, loss_pct, status, checked_at 
        FROM device_ping_history 
        WHERE device_id = ? 
        ORDER BY id DESC 
        LIMIT 10
        """,
        (device_id,)
    )
    history = [dict(r) for r in c.fetchall()]
    conn.close()
    return history


@router.post("/bulk-ping")
async def bulk_ping_devices(data: BulkPingRequest, current_user: dict = Depends(get_current_user)):
    """Queue a bulk ping job for the selected device IDs."""
    if not data.device_ids:
        raise HTTPException(status_code=400, detail="Pilih setidaknya satu perangkat.")
        
    task_id = str(uuid.uuid4())
    
    # Enqueue bulk_ping job to Redis queue using the job_queue service
    await job_queue.enqueue(
        task_name="bulk_ping",
        params={
            "task_id": task_id,
            "device_ids": data.device_ids,
            "user_id": current_user.get("id", 1),
            "username": current_user.get("username", "system")
        },
        priority="high"
    )
    
    return {
        "success": True,
        "task_id": task_id,
        "message": "Proses ping massal sedang dijalankan di background."
    }


@router.get("/bulk-ping/{task_id}")
async def get_bulk_ping_status(task_id: str, current_user: dict = Depends(get_current_user)):
    """Get the execution status of a bulk ping task from Redis."""
    r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    
    data = await r.get(f"bulk_ping:{task_id}")
    if not data:
        raise HTTPException(status_code=404, detail="Task ID tidak ditemukan atau sudah kedaluwarsa.")
        
    status_entry = json.loads(data.decode("utf-8"))
    return status_entry
