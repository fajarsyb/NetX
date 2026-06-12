from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
import json
from app.database import get_db_conn
from app.services.auth import get_current_user, require_operator_or_admin

router = APIRouter(prefix="/api/devices", tags=["l2-analysis"])

def _require_device(device_id: int) -> dict:
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")
    return dict(row)

@router.get("/{device_id}/l2/overview")
async def get_l2_overview(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch health scores, loop risk, broadcast risk, and summary of physical interfaces."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    
    # 1. Fetch interfaces summary
    c.execute("SELECT oper_status, health_score, sfp_health FROM device_l2_interfaces WHERE device_id = ?", (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    
    # 2. Fetch STP overview
    c.execute("SELECT stp_mode, root_bridge_id, root_port, confidence_score, data_source, validation_status FROM device_l2_spanning_tree WHERE device_id = ?", (device_id,))
    stp_row = c.fetchone()
    stp = dict(stp_row) if stp_row else {"stp_mode": "unknown", "root_bridge_id": "—", "root_port": "—", "confidence_score": 100, "data_source": "Simulation", "validation_status": "Verified"}
    
    # 3. Fetch active loop alerts
    c.execute("SELECT COUNT(*) as loop_cnt FROM network_anomalies WHERE device_id = ? AND anomaly_type = 'port_flapping' AND is_active = 1", (device_id,))
    loop_row = c.fetchone()
    active_loops = loop_row["loop_cnt"] if loop_row else 0
    
    conn.close()
    
    # Default scores fallback if no records yet
    port_score = 100
    stp_score = 100
    sfp_score = 100
    loop_risk = 0
    broadcast_risk = 0
    
    total_ports = len(rows)
    active_ports = sum(1 for r in rows if r["oper_status"] == "up")
    inactive_ports = total_ports - active_ports
    
    if rows:
        port_score = int(sum(r["health_score"] for r in rows) / total_ports)
        # Calculate SFP alarm count
        sfp_alarms = sum(1 for r in rows if r["sfp_health"] in ("Warning", "Critical"))
        sfp_score = 100 if sfp_alarms == 0 else (50 if any(r["sfp_health"] == "Critical" for r in rows) else 80)
        
        # Risk levels
        if any(r["health_score"] < 50 for r in rows): # Storms/flaps trigger low score
            loop_risk = 85
            broadcast_risk = 90
            stp_score = 45
            
    l2_health_score = int((port_score * 0.4) + (stp_score * 0.3) + ((100 - loop_risk) * 0.3))
    
    return {
        "scores": {
            "l2": l2_health_score,
            "port": port_score,
            "stp": stp_score,
            "sfp": sfp_score,
            "loop_risk": loop_risk,
            "broadcast_risk": broadcast_risk,
            "confidence_score": stp.get("confidence_score", 100),
            "data_source": stp.get("data_source", "Simulation"),
            "validation_status": stp.get("validation_status", "Verified")
        },
        "summary": {
            "total_ports": total_ports,
            "active_ports": active_ports,
            "inactive_ports": inactive_ports,
            "stp_mode": stp["stp_mode"],
            "root_bridge": stp["root_bridge_id"],
            "root_port": stp["root_port"],
            "active_loops": active_loops
        }
    }

@router.get("/{device_id}/l2/ports")
async def get_l2_ports(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch physical interfaces detailed L2 analytics, transceiver info, and recommendations."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_l2_interfaces WHERE device_id = ? ORDER BY interface_name", (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.get("/{device_id}/l2/stp")
async def get_l2_stp(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch STP global bridge states, root bridge status, and individual STP port roles."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    
    c.execute("SELECT * FROM device_l2_spanning_tree WHERE device_id = ?", (device_id,))
    stp_row = c.fetchone()
    stp = dict(stp_row) if stp_row else {}
    
    c.execute("SELECT * FROM device_l2_stp_ports WHERE device_id = ? ORDER BY interface_name", (device_id,))
    ports = [dict(r) for r in c.fetchall()]
    
    conn.close()
    return {
        "bridge": stp,
        "ports": ports
    }

@router.get("/{device_id}/l2/vlans")
async def get_l2_vlans(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch VLAN configuration tables and detect mismatches or unused VLAN list configurations."""
    device = _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    
    # 1. VLAN Table
    c.execute("SELECT * FROM device_l2_vlans WHERE device_id = ? ORDER BY vlan_id", (device_id,))
    vlans = [dict(r) for r in c.fetchall()]
    
    # 2. Extract port trunk configs
    c.execute("SELECT interface_name, port_type, vlan, native_vlan, allowed_vlans FROM device_l2_interfaces WHERE device_id = ?", (device_id,))
    ifs = [dict(r) for r in c.fetchall()]
    
    # 3. Detect Native VLAN Mismatches
    mismatches = []
    # If device has native VLAN mismatch simulated
    for item in ifs:
        if item["port_type"] == "Trunk" and item["native_vlan"] and item["native_vlan"] != "1":
            mismatches.append({
                "interface": item["interface_name"],
                "type": "Native VLAN Mismatch",
                "severity": "critical",
                "details": f"VLAN Native terkonfigurasi {item['native_vlan']} sedangkan switch seberang mengonfigurasikan VLAN Native 1."
            })
            
    # 4. Check for unused VLAN list (Allowed VLAN list contains VLANs not active in database)
    unused_vlans = []
    active_vids = {v["vlan_id"] for v in vlans}
    for item in ifs:
        if item["port_type"] == "Trunk" and item["allowed_vlans"]:
            try:
                allowed_str = item["allowed_vlans"]
                allowed_list = []
                for p in allowed_str.split(","):
                    if "-" in p:
                        start, end = map(int, p.split("-"))
                        allowed_list.extend(range(start, end + 1))
                    elif p.isdigit():
                        allowed_list.append(int(p))
                
                # VLANs allowed but not active in device VLAN table
                missing = [vid for vid in allowed_list if vid not in active_vids and vid != 1]
                if len(missing) > 10:
                    unused_vlans.append({
                        "interface": item["interface_name"],
                        "vlan_count": len(missing),
                        "recommendation": f"Pruning VLANs: Hapus {len(missing)} VLAN tidak terpakai dari allowed list di port {item['interface_name']}."
                    })
            except Exception:
                pass
                
    conn.close()
    
    return {
        "vlans": vlans,
        "mismatches": mismatches,
        "pruning_recommendations": unused_vlans
    }

@router.get("/{device_id}/l2/macs")
async def get_l2_macs(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch learned MAC Address tables, move counters, and flapping detections."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    
    c.execute("SELECT * FROM device_l2_macs WHERE device_id = ? ORDER BY interface_name, mac_address", (device_id,))
    macs = [dict(r) for r in c.fetchall()]
    
    # Detect duplicates
    duplicates = []
    seen = {}
    for m in macs:
        mac = m["mac_address"]
        if mac in seen:
            duplicates.append({
                "mac_address": mac,
                "vlan": m["vlan"],
                "port_1": seen[mac],
                "port_2": m["interface_name"]
            })
        else:
            seen[mac] = m["interface_name"]
            
    conn.close()
    return {
        "entries": macs,
        "duplicates": duplicates
    }

@router.get("/{device_id}/l2/timeline")
async def get_l2_timeline(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch Layer 2 events logs timeline for links, loops, and topology shifts."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_l2_timeline WHERE device_id = ? ORDER BY timestamp DESC LIMIT 100", (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.get("/{device_id}/l2/lifecycle")
async def get_l2_lifecycle(device_id: int, current_user: dict = Depends(get_current_user)):
    """Fetch physical port lifecycle data including traffic utilization, classification, and event histories."""
    _require_device(device_id)
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_l2_port_lifecycle WHERE device_id = ? ORDER BY interface_name", (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    
    # Deserialize JSON list histories before returning
    for r in rows:
        for history_col in ["mac_history", "neighbor_history", "vlan_history"]:
            if r.get(history_col):
                try:
                    r[history_col] = json.loads(r[history_col])
                except Exception:
                    r[history_col] = []
            else:
                r[history_col] = []
    return rows

@router.post("/{device_id}/l2/refresh")
async def refresh_l2_data(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Triggers L2 data refresh scan on-demand via the job queue."""
    _require_device(device_id)
    
    from app.queue.queue import job_queue
    try:
        res = await job_queue.run_sync_over_async("refresh_l2", {
            "device_id": device_id,
            "user_id": user["id"],
            "username": user["username"]
        }, priority="high", timeout=90.0)
        
        if not res.get("success"):
            raise HTTPException(status_code=503, detail=res.get("error", "Refresh L2 Analysis gagal."))
            
        return {"success": True, "message": "Informasi Layer 2 berhasil disinkronkan."}
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout: Sinkronisasi Layer 2 melebihi batas waktu.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
