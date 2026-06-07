from fastapi import APIRouter, HTTPException, Depends
from app.services.auth import require_operator_or_admin, get_current_user
from datetime import datetime, timedelta
from app.database import get_db_conn, decrypt_password, get_device_credentials
from app.services.connector import get_arp_raw
from app.services.arp_parser import parse_arp
from app.services.oui_lookup import lookup_vendor

router = APIRouter(prefix="/api", tags=["arp"])


def _require_device(device_id: int) -> dict:
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    return dict(row)


@router.get("/devices/{device_id}/arp")
async def get_arp_cache(device_id: int):
    """Return ARP entries from local DB cache (no device connection)."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        "SELECT * FROM arp_cache WHERE device_id = ? ORDER BY ip_address",
        (device_id,),
    )
    entries = [dict(r) for r in c.fetchall()]

    c.execute(
        "SELECT fetched_at FROM arp_history WHERE device_id = ? ORDER BY id DESC LIMIT 1",
        (device_id,),
    )
    last_row = c.fetchone()
    conn.close()

    return {
        "count":        len(entries),
        "entries":      entries,
        "last_fetched": last_row["fetched_at"] if last_row else None,
    }


@router.post("/devices/{device_id}/arp/refresh")
async def refresh_arp(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Connect to device, fetch ARP table, enrich with OUI, save to DB."""
    device = _require_device(device_id)
    username, password = get_device_credentials(device)
    device["username"] = username
    raw = await get_arp_raw(device, password)
    if raw.startswith("ERROR:"):
        # Mark device offline
        conn = get_db_conn()
        conn.execute(
            "UPDATE devices SET status='offline' WHERE id=?", (device_id,)
        )
        conn.commit()
        conn.close()
        
        # Format a cleaner error message
        err_detail = raw.replace("ERROR: ", "")
        if "Authentication failed" in err_detail or "NetmikoAuthenticationException" in err_detail:
            clean_msg = "Gagal Autentikasi: Username atau Password salah."
        elif "Timeout" in err_detail or "timed out" in err_detail.lower():
            clean_msg = "Koneksi Timeout: Perangkat tidak dapat dijangkau dari jaringan ini."
        else:
            clean_msg = f"Koneksi Gagal: {err_detail}"
            
        raise HTTPException(status_code=400, detail=clean_msg)

    entries = parse_arp(raw, device["device_type"])
    now = datetime.now().isoformat()
    enriched = []

    for e in entries:
        vendor_info = await lookup_vendor(e.get("mac", ""))
        enriched.append({
            **e,
            "mac_vendor":      vendor_info["vendor"],
            "device_category": vendor_info["category"],
            "device_hint":     vendor_info["device_hint"],
            "fetched_at":      now,
        })

    conn = get_db_conn()
    c = conn.cursor()

    # Replace old cache
    c.execute("DELETE FROM arp_cache WHERE device_id = ?", (device_id,))
    for e in enriched:
        c.execute("""
            INSERT INTO arp_cache
                (device_id, ip_address, mac_address, interface, entry_type,
                 age_minutes, mac_vendor, device_category, device_hint, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            device_id, e["ip"], e["mac"], e.get("interface", ""),
            e.get("entry_type", "dynamic"), e.get("age", 0),
            e["mac_vendor"], e["device_category"], e["device_hint"], now,
        ))

    c.execute(
        "INSERT INTO arp_history (device_id, arp_count, fetched_at) VALUES (?,?,?)",
        (device_id, len(enriched), now),
    )
    c.execute(
        "UPDATE devices SET status='online', last_seen=? WHERE id=?",
        (now, device_id),
    )
    conn.commit()
    conn.close()

    return {
        "success":     True,
        "count":       len(enriched),
        "entries":     enriched,
        "fetched_at":  now,
    }


@router.get("/arp/summary")
async def arp_summary():
    """ARP summary per device, including unique MAC addresses for dashboard deduplication."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT d.id, d.name, d.ip, d.device_type, d.protocol, d.status,
               d.group_id, dg.name AS group_name,
               MAX(a.fetched_at) AS last_fetched
        FROM   devices d
        LEFT JOIN arp_cache a ON d.id = a.device_id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        GROUP BY d.id
        ORDER BY d.name COLLATE NOCASE
    """)
    devices = [dict(r) for r in c.fetchall()]
    
    # Get all mac_addresses from arp_cache to group them
    c.execute("SELECT device_id, mac_address FROM arp_cache WHERE mac_address IS NOT NULL AND mac_address != ''")
    arp_entries = c.fetchall()
    
    # Group by device_id
    macs_by_device = {}
    for entry in arp_entries:
        dev_id = entry["device_id"]
        mac = entry["mac_address"].strip().upper()
        if mac:
            if dev_id not in macs_by_device:
                macs_by_device[dev_id] = set()
            macs_by_device[dev_id].add(mac)
            
    # Enrich devices
    for d in devices:
        dev_macs = list(macs_by_device.get(d["id"], set()))
        d["mac_addresses"] = dev_macs
        d["arp_count"] = len(dev_macs)
        
    conn.close()
    return devices


@router.get("/arp/history/{device_id}")
async def arp_history(device_id: int):
    """Last 50 ARP count data points for a sparkline/trend chart."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT arp_count, fetched_at
        FROM   arp_history
        WHERE  device_id = ?
        ORDER  BY id DESC
        LIMIT  50
    """, (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows[::-1]   # Chronological order


@router.get("/arp/all")
async def get_all_arp_entries():
    """Retrieve all ARP cache entries from all devices, enriched with device name and group."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT a.*, d.name AS device_name, d.ip AS device_ip, d.group_id, dg.name AS group_name
        FROM arp_cache a
        JOIN devices d ON a.device_id = d.id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        ORDER BY a.ip_address
    """)
    entries = [dict(r) for r in c.fetchall()]
    conn.close()
    return entries


@router.get("/mac/lookup")
async def mac_lookup(mac: str):
    """One-shot MAC → vendor lookup (useful for manual queries)."""
    result = await lookup_vendor(mac)
    return result


@router.get("/network/history")
async def get_network_history(timeframe: str = "week", current_user: dict = Depends(get_current_user)):
    """Retrieve historical unique ARP and MAC counts filtered by timeframe (day, week, month)."""
    now = datetime.now()
    if timeframe == "day":
        start_time = now - timedelta(days=1)
    elif timeframe == "week":
        start_time = now - timedelta(weeks=1)
    elif timeframe == "month":
        start_time = now - timedelta(days=30)
    else:
        raise HTTPException(
            status_code=400,
            detail="Timeframe tidak valid. Gunakan 'day', 'week', atau 'month'."
        )

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT arp_count, mac_count, fetched_at
        FROM network_history
        WHERE fetched_at >= ?
        ORDER BY fetched_at ASC
    """, (start_time.isoformat(),))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

