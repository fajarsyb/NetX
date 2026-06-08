from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from app.services.auth import require_operator_or_admin
from datetime import datetime
from app.database import get_db_conn, decrypt_password, get_device_credentials
from app.services.connector import get_cdp_raw
from app.services.cdp_parser import parse_cdp

router = APIRouter(prefix="/api/devices", tags=["cdp"])

@router.get("/{device_id}/cdp")
async def get_cdp_cache(device_id: int):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM cdp_neighbors
        WHERE device_id = ?
        ORDER BY local_port
    """, (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

async def refresh_cdp_logic(device_id: int, user: dict = None):
    """Connect to device, fetch CDP neighbors, save to DB. Runs in background worker."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise Exception("Device tidak ditemukan.")

    device = dict(row)
    if not (device.get("device_type") or "").lower().startswith("cisco"):
        conn.close()
        raise Exception("Protokol CDP hanya didukung untuk perangkat Cisco.")

    username, password = get_device_credentials(device)
    device["username"] = username
    
    # 1. Fetch raw
    raw_output = await get_cdp_raw(device, password)
    if raw_output.startswith("ERROR:"):
        conn.close()
        raise Exception(raw_output)
        
    # 2. Parse
    neighbors = parse_cdp(raw_output, device["device_type"])

    # 3. Update DB
    now = datetime.now().isoformat()
    c.execute("DELETE FROM cdp_neighbors WHERE device_id = ?", (device_id,))
    
    enriched = []
    for n in neighbors:
        n_data = {
            "local_port": n.get("local_port", ""),
            "neighbor_name": n.get("neighbor_name", ""),
            "neighbor_ip": n.get("neighbor_ip", ""),
            "neighbor_platform": n.get("neighbor_platform", ""),
            "neighbor_port": n.get("neighbor_port", ""),
            "fetched_at": now
        }
        enriched.append(n_data)
        
        c.execute("""
            INSERT INTO cdp_neighbors
            (device_id, local_port, neighbor_name, neighbor_ip, neighbor_platform, neighbor_port, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            device_id,
            n_data["local_port"],
            n_data["neighbor_name"],
            n_data["neighbor_ip"],
            n_data["neighbor_platform"],
            n_data["neighbor_port"],
            now
        ))

    c.execute(
        "UPDATE devices SET status='online', last_seen=? WHERE id=?",
        (now, device_id),
    )
    conn.commit()
    conn.close()

    return {
        "success": True, 
        "count": len(enriched),
        "neighbors": enriched,
        "fetched_at": now,
        "message": f"✓ {len(enriched)} CDP neighbor berhasil diambil."
    }


@router.post("/{device_id}/cdp/refresh")
async def refresh_cdp(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Trigger CDP refresh asynchronously via Redis queue and wait for the result."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    from app.queue.queue import job_queue
    try:
        res = await job_queue.run_sync_over_async("refresh_cdp", {
            "device_id": device_id,
            "user_id": user["id"],
            "username": user["username"]
        }, priority="high", timeout=45.0)
        
        if not res.get("success"):
            raise HTTPException(status_code=503, detail=res.get("error", "Refresh CDP gagal."))
        
        result_data = res.get("result", {})
        return {
            "count": result_data.get("count", 0),
            "neighbors": result_data.get("neighbors", []),
            "fetched_at": result_data.get("fetched_at"),
            "message": result_data.get("message"),
        }
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout: Proses refresh CDP melebihi batas waktu.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
