from fastapi import APIRouter, HTTPException, Depends
from app.services.auth import require_operator_or_admin
from datetime import datetime
from app.database import get_db_conn, decrypt_password, get_device_credentials
from app.services.connector import get_lldp_raw
from app.services.lldp_parser import parse_lldp
from app.services.oui_lookup import lookup_vendor

router = APIRouter(prefix="/api", tags=["lldp"])


def _require_device(device_id: int) -> dict:
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    return dict(row)


@router.get("/devices/{device_id}/lldp")
async def get_lldp_cache(device_id: int):
    """Return LLDP neighbors from local DB cache."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        "SELECT * FROM lldp_neighbors WHERE device_id = ? ORDER BY local_port",
        (device_id,),
    )
    neighbors = [dict(r) for r in c.fetchall()]
    conn.close()

    last_fetched = None
    if neighbors:
        last_fetched = max(n["fetched_at"] for n in neighbors)

    return {
        "count":        len(neighbors),
        "neighbors":    neighbors,
        "last_fetched": last_fetched,
    }


async def refresh_lldp_logic(device_id: int, user: dict = None):
    """Connect to device, fetch LLDP neighbors, enrich with OUI, save to DB. Runs in background worker."""
    device = _require_device(device_id)
    username, password = get_device_credentials(device)
    device["username"] = username
    raw = await get_lldp_raw(device, password)
    if raw.startswith("ERROR:"):
        conn = get_db_conn()
        conn.execute(
            "UPDATE devices SET status='offline' WHERE id=?", (device_id,)
        )
        conn.commit()
        conn.close()
        raise Exception(raw)

    neighbors = parse_lldp(raw, device["device_type"])
    now = datetime.now().isoformat()
    enriched = []

    for n in neighbors:
        mac = n.get("neighbor_mac", "")
        vendor_info = await lookup_vendor(mac) if mac else {
            "vendor": "Unknown", "category": "unknown", "device_hint": "Unknown"
        }
        enriched.append({
            **n,
            "neighbor_vendor": vendor_info["vendor"],
            "device_category": vendor_info["category"],
            "device_hint":     vendor_info["device_hint"],
            "fetched_at":      now,
        })

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("DELETE FROM lldp_neighbors WHERE device_id = ?", (device_id,))
    for n in enriched:
        c.execute("""
            INSERT INTO lldp_neighbors
                (device_id, local_port, neighbor_name, neighbor_ip,
                 neighbor_mac, neighbor_platform, neighbor_port,
                 neighbor_vendor, device_category, device_hint, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            device_id,
            n.get("local_port", ""), n.get("neighbor_name", ""),
            n.get("neighbor_ip", ""),  n.get("neighbor_mac", ""),
            n.get("neighbor_platform", ""), n.get("neighbor_port", ""),
            n["neighbor_vendor"], n["device_category"], n["device_hint"], now,
        ))

    c.execute(
        "UPDATE devices SET status='online', last_seen=? WHERE id=?",
        (now, device_id),
    )
    conn.commit()
    conn.close()

    return {
        "success":     True,
        "count":       len(enriched),
        "neighbors":   enriched,
        "fetched_at":  now,
    }


@router.post("/devices/{device_id}/lldp/refresh")
async def refresh_lldp(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Trigger LLDP refresh asynchronously via Redis queue and wait for the result."""
    device = _require_device(device_id)
    
    from app.queue.queue import job_queue
    try:
        res = await job_queue.run_sync_over_async("refresh_lldp", {
            "device_id": device_id,
            "user_id": user["id"],
            "username": user["username"]
        }, priority="high", timeout=45.0)
        
        if not res.get("success"):
            raise HTTPException(status_code=503, detail=res.get("error", "Refresh LLDP gagal."))
        
        result_data = res.get("result", {})
        return {
            "count": result_data.get("count", 0),
            "neighbors": result_data.get("neighbors", []),
            "fetched_at": result_data.get("fetched_at"),
        }
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout: Proses refresh LLDP melebihi batas waktu.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/lldp/summary")
async def lldp_summary():
    """LLDP neighbor count per device for Dashboard."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT d.id, d.name, d.ip, d.device_type,
               d.group_id, dg.name AS group_name,
               COUNT(l.id)       AS neighbor_count,
               MAX(l.fetched_at) AS last_fetched
        FROM   devices d
        LEFT JOIN lldp_neighbors l ON d.id = l.device_id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        GROUP BY d.id, d.name, d.ip, d.device_type, d.group_id, dg.name
        ORDER BY d.name COLLATE NOCASE
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@router.get("/lldp/all")
async def get_all_lldp_neighbors():
    """Retrieve all LLDP neighbor entries from all devices, enriched with device name and group."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT l.*, d.name AS device_name, d.ip AS device_ip, d.group_id, dg.name AS group_name
        FROM lldp_neighbors l
        JOIN devices d ON l.device_id = d.id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        ORDER BY d.name, l.local_port
    """)
    entries = [dict(r) for r in c.fetchall()]
    conn.close()
    return entries
