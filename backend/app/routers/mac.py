from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from app.database import get_db_conn, get_device_credentials
from app.services.connector import get_mac_table_raw
from app.services.mac_parser import parse_mac_table
from app.services.oui_lookup import lookup_vendor
from app.services.auth import require_operator_or_admin

router = APIRouter(prefix="/api", tags=["mac"])

def _require_device(device_id: int) -> dict:
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    return dict(row)

@router.get("/devices/{device_id}/mac")
async def get_mac_cache(device_id: int):
    """Return MAC address table from local DB cache."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        "SELECT * FROM mac_addresses WHERE device_id = ? ORDER BY interface, vlan",
        (device_id,),
    )
    entries = [dict(r) for r in c.fetchall()]
    conn.close()

    last_fetched = None
    if entries:
        last_fetched = max(e["fetched_at"] for e in entries)

    return {
        "count": len(entries),
        "entries": entries,
        "last_fetched": last_fetched,
    }

@router.post("/devices/{device_id}/mac/refresh")
async def refresh_mac_table(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Connect to device, fetch raw MAC table, parse and save to DB cache."""
    device = _require_device(device_id)
    username, password = get_device_credentials(device)
    device["username"] = username

    raw = await get_mac_table_raw(device, password)
    if raw.startswith("ERROR:"):
        conn = get_db_conn()
        conn.execute(
            "UPDATE devices SET status='offline' WHERE id=?", (device_id,)
        )
        conn.commit()
        conn.close()
        raise HTTPException(status_code=503, detail=raw)

    entries = parse_mac_table(raw, device["device_type"])
    now = datetime.now().isoformat()
    enriched_entries = []

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("DELETE FROM mac_addresses WHERE device_id = ?", (device_id,))
    for e in entries:
        mac = e.get("mac_address", "")
        vendor_info = await lookup_vendor(mac)
        mac_vendor = vendor_info.get("vendor", "Unknown")

        c.execute("""
            INSERT INTO mac_addresses (device_id, vlan, mac_address, entry_type, interface, mac_vendor, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            device_id,
            e.get("vlan", "1"),
            mac,
            e.get("entry_type", "dynamic"),
            e.get("interface", ""),
            mac_vendor,
            now,
        ))

        enriched = dict(e)
        enriched["mac_vendor"] = mac_vendor
        enriched["fetched_at"] = now
        enriched_entries.append(enriched)

    c.execute(
        "UPDATE devices SET status='online', last_seen=? WHERE id=?",
        (now, device_id),
    )
    conn.commit()
    conn.close()

    return {
        "success": True,
        "count": len(enriched_entries),
        "message": f"Tabel MAC Address berhasil disegarkan. Menemukan {len(enriched_entries)} entri.",
        "entries": enriched_entries
    }

# ─── MAC ADDRESS TRACKER / INVESTIGATION HELPERS ─────────────────────────────
import re
import asyncio

def normalize_mac_address(mac: str) -> str:
    if not mac:
        return ""
    clean = re.sub(r"[^a-fA-F0-9]", "", mac)
    if len(clean) != 12:
        return ""
    return ":".join(clean[i:i+2].upper() for i in range(0, 12, 2))

def normalize_port_name(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    s = s.split('.')[0]
    s = s.replace(" ", "")
    s = s.replace("gigabitethernet", "gi")
    s = s.replace("tengigabitethernet", "te")
    s = s.replace("fastethernet", "fa")
    s = s.replace("ethernet", "eth")
    s = s.replace("port-channel", "po")
    s = s.replace("fortygigabitethernet", "fo")
    s = s.replace("hundredgigabitethernet", "hu")
    s = s.replace("twogigabitethernet", "tw")
    return s

def ports_match(port1: str, port2: str) -> bool:
    return normalize_port_name(port1) == normalize_port_name(port2)

# ─── MAC ADDRESS TRACKER / INVESTIGATION ENDPOINTS ───────────────────────────

@router.get("/mac/investigate")
async def investigate_mac(mac: str):
    """Investigate a MAC address or IP address location and association."""
    query_str = mac.strip()
    is_ip = re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", query_str)
    
    resolved_ip = None
    query_mac = None
    
    if is_ip:
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("""
            SELECT mac_address FROM arp_cache 
            WHERE ip_address = ? 
            ORDER BY fetched_at DESC LIMIT 1
        """, (query_str,))
        row = c.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(
                status_code=404, 
                detail=f"IP Address {query_str} tidak ditemukan di cache ARP mana pun."
            )
        query_mac = row["mac_address"]
        resolved_ip = query_str
    else:
        query_mac = query_str

    normalized = normalize_mac_address(query_mac)
    if not normalized:
        raise HTTPException(status_code=400, detail="Format MAC Address atau IP Address tidak valid.")

    # 1. Resolve vendor
    vendor_info = await lookup_vendor(normalized)
    mac_vendor = vendor_info.get("vendor", "Unknown")

    conn = get_db_conn()
    c = conn.cursor()

    # Get prefix (first 15 characters, e.g. "XX:XX:XX:XX:XX:")
    prefix = normalized[:15]

    # Helper to check proximity (difference of last octet <= 3)
    def is_close(mac_candidate: str) -> bool:
        if not mac_candidate:
            return False
        cand = normalize_mac_address(mac_candidate)
        if cand[:15] != prefix:
            return False
        try:
            val_query = int(normalized[15:17], 16)
            val_cand = int(cand[15:17], 16)
            return abs(val_query - val_cand) <= 3
        except Exception:
            return False

    # 2. Get ARP info (IP mappings)
    c.execute("""
        SELECT a.ip_address, a.mac_address, a.device_id, d.name as device_name, d.ip as device_ip, a.interface, a.fetched_at
        FROM arp_cache a
        JOIN devices d ON a.device_id = d.id
        WHERE a.mac_address LIKE ?
        ORDER BY a.fetched_at DESC
    """, (prefix + "%",))
    all_arp = [dict(r) for r in c.fetchall()]
    arp_entries = [a for a in all_arp if is_close(a["mac_address"])]

    # 3. Get MAC Table locations
    c.execute("""
        SELECT m.vlan, m.mac_address, m.entry_type, m.interface, m.fetched_at, m.device_id, d.name as device_name, d.ip as device_ip, d.device_role
        FROM mac_addresses m
        JOIN devices d ON m.device_id = d.id
        WHERE m.mac_address LIKE ?
        ORDER BY d.name, m.interface
    """, (prefix + "%",))
    all_macs = [dict(r) for r in c.fetchall()]
    mac_locations = [m for m in all_macs if is_close(m["mac_address"])]

    # Get all managed devices list for inter-switch connection check
    c.execute("SELECT name, ip FROM devices")
    all_devices = [dict(r) for r in c.fetchall()]
    managed_ips = {d["ip"] for d in all_devices if d["ip"]}
    managed_names = {d["name"].lower() for d in all_devices if d["name"]}

    locations = []
    edge_port = None

    # 4. Check neighbors for each MAC location to identify uplinks vs access ports
    for loc in mac_locations:
        device_id = loc["device_id"]
        local_port = loc["interface"]

        # Fetch LLDP and CDP neighbors
        c.execute("""
            SELECT local_port, neighbor_name, neighbor_ip, neighbor_port 
            FROM lldp_neighbors 
            WHERE device_id = ?
        """, (device_id,))
        lldp_neigs = [dict(r) for r in c.fetchall()]

        c.execute("""
            SELECT local_port, neighbor_name, neighbor_ip, neighbor_port 
            FROM cdp_neighbors 
            WHERE device_id = ?
        """, (device_id,))
        cdp_neigs = [dict(r) for r in c.fetchall()]

        neighbor = None
        is_uplink = False

        for n in lldp_neigs + cdp_neigs:
            if ports_match(n["local_port"], local_port):
                neighbor = n
                n_ip = n.get("neighbor_ip") or ""
                n_name = (n.get("neighbor_name") or "").lower()
                
                # If neighbor matches a known switch IP or name
                is_managed_switch = (
                    n_ip in managed_ips or 
                    any(mn in n_name for mn in managed_names) or
                    "switch" in n_name or 
                    "router" in n_name
                )
                if is_managed_switch:
                    is_uplink = True
                break

        loc_enriched = {
            **loc,
            "is_uplink": is_uplink,
            "neighbor": neighbor
        }
        locations.append(loc_enriched)

    conn.close()

    # Identify the access port (Edge Port) where it connects to the user/endpoint
    # It MUST be located on a device with category "Access Switch"
    edge_ports = [loc for loc in locations if loc.get("device_role") == "Access Switch" and not loc["is_uplink"]]
    if edge_ports:
        # Sort by fetched_at desc to get the latest updated edge port
        edge_ports.sort(key=lambda x: x["fetched_at"], reverse=True)
        edge_port = edge_ports[0]
    else:
        # Fallback to any port on an Access Switch if no non-uplink port is found
        access_switch_ports = [loc for loc in locations if loc.get("device_role") == "Access Switch"]
        if access_switch_ports:
            edge_port = access_switch_ports[0]
        elif locations:
            # Absolute fallback to first location if no Access Switch is found
            edge_port = locations[0]

    return {
        "query_mac": normalized,
        "query_ip": resolved_ip,
        "vendor": mac_vendor,
        "arp_info": arp_entries,
        "locations": locations,
        "edge_port": edge_port
    }

@router.post("/mac/scan-all")
async def scan_all_mac_tables(user: dict = Depends(require_operator_or_admin)):
    """Trigger MAC Address table refresh on all online devices in parallel."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name FROM devices")
    devices = [dict(r) for r in c.fetchall()]
    conn.close()

    # Run all refreshes in parallel with gather
    tasks = []
    for d in devices:
        tasks.append(refresh_mac_table(d["id"]))

    results = []
    gathered_results = await asyncio.gather(*tasks, return_exceptions=True)

    success_count = 0
    fail_count = 0

    for dev, res in zip(devices, gathered_results):
        if isinstance(res, Exception):
            results.append({
                "device_id": dev["id"],
                "name": dev["name"],
                "success": False,
                "error": str(res)
            })
            fail_count += 1
        elif isinstance(res, dict) and res.get("success"):
            results.append({
                "device_id": dev["id"],
                "name": dev["name"],
                "success": True,
                "count": res.get("count", 0)
            })
            success_count += 1
        else:
            results.append({
                "device_id": dev["id"],
                "name": dev["name"],
                "success": False,
                "error": "Error tidak diketahui"
            })
            fail_count += 1

    return {
        "message": f"Penyelarasan massal selesai. {success_count} perangkat sukses, {fail_count} gagal.",
        "success_count": success_count,
        "fail_count": fail_count,
        "details": results
    }


@router.get("/mac/summary")
async def mac_summary():
    """MAC address count per device for the Dashboard overview cards, including unique MACs for deduplication."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # Get device details and last fetched MAC time
    c.execute("""
        SELECT d.id, d.name, d.ip, d.device_type, d.protocol, d.status,
               d.group_id, dg.name AS group_name,
               MAX(m.fetched_at) AS last_fetched
        FROM   devices d
        LEFT JOIN mac_addresses m ON d.id = m.device_id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        GROUP BY d.id
        ORDER BY d.name COLLATE NOCASE
    """)
    devices = [dict(r) for r in c.fetchall()]
    
    # Get all mac_addresses from mac_addresses table
    c.execute("SELECT device_id, mac_address FROM mac_addresses WHERE mac_address IS NOT NULL AND mac_address != ''")
    mac_entries = c.fetchall()
    
    # Group by device_id
    macs_by_device = {}
    for entry in mac_entries:
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
        d["mac_count"] = len(dev_macs)
        
    conn.close()
    return devices


@router.get("/mac/all")
async def get_all_mac_addresses():
    """Retrieve all MAC address entries from all devices, enriched with device name and group."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT m.*, d.name AS device_name, d.ip AS device_ip, d.group_id, dg.name AS group_name
        FROM mac_addresses m
        JOIN devices d ON m.device_id = d.id
        LEFT JOIN device_groups dg ON d.group_id = dg.id
        ORDER BY m.mac_address
    """)
    entries = [dict(r) for r in c.fetchall()]
    conn.close()
    return entries
