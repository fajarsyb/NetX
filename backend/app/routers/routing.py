from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from app.services.auth import require_operator_or_admin
from datetime import datetime
from app.database import get_db_conn, decrypt_password, get_device_credentials
from app.services.connector import get_routing_raw
from app.services.routing_parser import parse_routing

router = APIRouter(prefix="/api/devices", tags=["routing"])

@router.get("/{device_id}/routing")
async def get_routing_cache(device_id: int):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM routing_table
        WHERE device_id = ?
        ORDER BY destination
    """, (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.post("/{device_id}/routing/refresh")
async def refresh_routing(device_id: int, user: dict = Depends(require_operator_or_admin)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    device = dict(row)
    username, password = get_device_credentials(device)
    device["username"] = username
    
    # 1. Fetch raw
    raw_output = await get_routing_raw(device, password)
    if raw_output.startswith("ERROR:"):
        conn.close()
        raise HTTPException(status_code=503, detail=raw_output)
        
    # 2. Parse
    routes = parse_routing(raw_output, device["device_type"])

    # 3. Update DB
    now = datetime.now().isoformat()
    c.execute("DELETE FROM routing_table WHERE device_id = ?", (device_id,))
    
    enriched = []
    for r in routes:
        r_data = {
            "destination": r.get("destination", ""),
            "gateway": r.get("gateway", ""),
            "interface": r.get("interface", ""),
            "protocol": r.get("protocol", ""),
            "metric": r.get("metric", ""),
            "fetched_at": now
        }
        enriched.append(r_data)
        
        c.execute("""
            INSERT INTO routing_table
            (device_id, destination, gateway, interface, protocol, metric, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            device_id,
            r_data["destination"],
            r_data["gateway"],
            r_data["interface"],
            r_data["protocol"],
            r_data["metric"],
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
        "routes": enriched,
        "fetched_at": now,
        "message": f"✓ {len(enriched)} route berhasil diambil."
    }
