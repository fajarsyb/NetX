import os
import re
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db_conn
from app.services.auth import get_current_user
from app.routers.snmp import is_physical_interface

router = APIRouter(prefix="/api/devices", tags=["port-analysis"])

def get_expected_port_count(model_str: str, device_type: str = "") -> int:
    if not model_str:
        return 0
    from app.core.drivers import driver_manager
    if device_type:
        driver = driver_manager.get_driver(device_type)
    else:
        m = model_str.lower()
        if "at-" in m or "x530" in m or "x550" in m:
            driver = driver_manager.get_driver("allied_telesis")
        elif "ex3400" in m or "ex4650" in m or "juniper" in m:
            driver = driver_manager.get_driver("juniper")
        elif "s2910" in m or "ruijie" in m:
            driver = driver_manager.get_driver("ruijie")
        elif "icx" in m or "ruckus" in m:
            driver = driver_manager.get_driver("ruckus")
        else:
            driver = driver_manager.get_driver("cisco")
    return driver.get_expected_port_count(model_str)

def parse_duration(delta_seconds):
    if delta_seconds is None or delta_seconds < 0:
        return "—"
    days = int(delta_seconds // 86400)
    hours = int((delta_seconds % 86400) // 3600)
    minutes = int((delta_seconds % 3600) // 60)
    
    parts = []
    if days > 0:
        parts.append(f"{days} hari")
    if hours > 0:
        parts.append(f"{hours} jam")
    if minutes > 0 or not parts:
        parts.append(f"{minutes} menit")
    return ", ".join(parts)

@router.get("/{device_id}/port-analysis")
async def get_port_utilization_analysis(device_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieve detailed port utilization analysis and recommendations for a device."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    dev_row = c.fetchone()
    if not dev_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")
    
    device = dict(dev_row)

    # 1. Fetch historical stats from DB
    c.execute("SELECT * FROM interface_stats_latest WHERE device_id = ?", (device_id,))
    db_stats = {r["interface_name"]: dict(r) for r in c.fetchall()}

    # 2. Fetch connection maps (MAC, LLDP, CDP, ARP)
    c.execute("""
        SELECT vlan, mac_address, entry_type, interface, mac_vendor 
        FROM mac_addresses 
        WHERE device_id = ?
    """, (device_id,))
    mac_rows = [dict(r) for r in c.fetchall()]

    c.execute("""
        SELECT local_port, neighbor_name, neighbor_ip, neighbor_mac, neighbor_port, neighbor_vendor, device_category, device_hint
        FROM lldp_neighbors 
        WHERE device_id = ?
    """, (device_id,))
    lldp_rows = [dict(r) for r in c.fetchall()]

    c.execute("""
        SELECT local_port, neighbor_name, neighbor_ip, neighbor_platform, neighbor_port
        FROM cdp_neighbors 
        WHERE device_id = ?
    """, (device_id,))
    cdp_rows = [dict(r) for r in c.fetchall()]

    c.execute("SELECT ip_address, mac_address FROM arp_cache")
    arp_rows = [dict(r) for r in c.fetchall()]
    
    # Check if there are active flapping anomalies on this device
    c.execute("""
        SELECT interface_name FROM network_anomalies 
        WHERE device_id = ? AND anomaly_type = 'port_flapping' AND is_active = 1
    """, (device_id,))
    flapping_interfaces = {r["interface_name"] for r in c.fetchall()}
    conn.close()

    # Normalization helpers
    def normalize_mac(mac: str) -> str:
        clean = re.sub(r"[:\-\.\s]", "", mac).upper()
        if len(clean) != 12:
            return mac.upper()
        return ":".join(clean[i:i+2] for i in range(0, 12, 2))

    mac_to_ip = {}
    for r in arp_rows:
        n_mac = normalize_mac(r["mac_address"])
        if n_mac and r["ip_address"]:
            mac_to_ip[n_mac] = r["ip_address"]

    def norm_iface(name: str) -> str:
        if not name:
            return ""
        s = name.lower().replace(" ", "").replace("-", "").replace("_", "")
        s = s.replace("gigabitethernet", "gi")
        s = s.replace("fastethernet", "fa")
        s = s.replace("ethernet", "eth")
        s = s.replace("tengigabitethernet", "te")
        s = s.replace("ten-gigabitethernet", "te")
        s = s.replace("fortygigabitethernet", "fo")
        s = s.replace("hundredgigabitethernet", "hu")
        s = s.replace("port-channel", "po")
        s = s.replace("portchannel", "po")
        s = s.replace("management", "mgmt")
        return s

    # 3. Try fetching real-time SNMP interface info
    snmp_ifs = []
    if device.get("snmp_community"):
        try:
            from app.routers.snmp import get_snmp_interfaces
            snmp_ifs = await get_snmp_interfaces(device_id)
        except Exception:
            pass

    ports = {}

    # Initialize ports dict
    if snmp_ifs:
        for i in snmp_ifs:
            name = i["name"]
            norm = norm_iface(name)
            ports[norm] = {
                "interface": name,
                "normalized": norm,
                "status": i["status"],
                "admin_status": i.get("admin_status", "up"),
                "speed": i["speed"],
                "speed_mbps": i.get("speed_mbps", 0),
                "alias": i["alias"],
                "rx_rate": i.get("rx_rate", "0 bps"),
                "tx_rate": i.get("tx_rate", "0 bps"),
                "rx_util": i.get("rx_util_val", 0.0),
                "tx_util": i.get("tx_util_val", 0.0),
                "mac_entries": [],
                "lldp_neighbor": None,
                "cdp_neighbor": None,
                "health_status": i.get("health_status", "excellent"),
                "health_score": i.get("health_score", 100)
            }
    else:
        # Fallback to DB stats
        for name, r in db_stats.items():
            norm = norm_iface(name)
            ports[norm] = {
                "interface": name,
                "normalized": norm,
                "status": r["oper_status"],
                "admin_status": "up", # default
                "speed": f"{r.get('link_speed', 0)} Mbps" if r.get('link_speed') else "Auto/Unknown",
                "speed_mbps": r.get("link_speed", 0),
                "alias": "",
                "rx_rate": "—",
                "tx_rate": "—",
                "rx_util": 0.0,
                "tx_util": 0.0,
                "mac_entries": [],
                "lldp_neighbor": None,
                "cdp_neighbor": None,
                "health_status": "excellent",
                "health_score": 100
            }

    def get_or_create_port(original_name: str):
        if not original_name:
            return None
        norm = norm_iface(original_name)
        if norm not in ports:
            ports[norm] = {
                "interface": original_name,
                "normalized": norm,
                "status": "unknown",
                "admin_status": "unknown",
                "speed": "—",
                "speed_mbps": 0,
                "alias": "",
                "rx_rate": "—",
                "tx_rate": "—",
                "rx_util": 0.0,
                "tx_util": 0.0,
                "mac_entries": [],
                "lldp_neighbor": None,
                "cdp_neighbor": None,
                "health_status": "excellent",
                "health_score": 100
            }
        return ports[norm]

    # Populate MAC entries
    for m in mac_rows:
        p = get_or_create_port(m["interface"])
        if p:
            n_mac = normalize_mac(m["mac_address"])
            resolved_ip = mac_to_ip.get(n_mac, "—")
            p["mac_entries"].append({
                "mac_address": m["mac_address"],
                "mac_vendor": m["mac_vendor"] or "Unknown",
                "vlan": m["vlan"] or "—",
                "entry_type": m["entry_type"] or "dynamic",
                "ip_address": resolved_ip
            })

    # Populate LLDP neighbors
    for l in lldp_rows:
        p = get_or_create_port(l["local_port"])
        if p:
            p["lldp_neighbor"] = {
                "neighbor_name": l["neighbor_name"] or "—",
                "neighbor_ip": l["neighbor_ip"] or "—",
                "neighbor_mac": l["neighbor_mac"] or "—",
                "neighbor_port": l["neighbor_port"] or "—",
                "neighbor_vendor": l["neighbor_vendor"] or "Unknown",
                "device_category": l["device_category"] or "unknown",
                "device_hint": l["device_hint"] or "Unknown"
            }

    # Populate CDP neighbors
    for c_row in cdp_rows:
        p = get_or_create_port(c_row["local_port"])
        if p:
            p["cdp_neighbor"] = {
                "neighbor_name": c_row["neighbor_name"] or "—",
                "neighbor_ip": c_row["neighbor_ip"] or "—",
                "neighbor_platform": c_row["neighbor_platform"] or "—",
                "neighbor_port": c_row["neighbor_port"] or "—"
            }

    # Natural sorting helper
    def natural_sort_key(s):
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s["interface"])]

    sorted_ports = list(ports.values())
    try:
        sorted_ports.sort(key=natural_sort_key)
    except Exception:
        sorted_ports.sort(key=lambda x: x["interface"])

    # 4. Perform Port Utilization Analysis & Classification
    now = datetime.now()
    analysis_ports = []
    
    summary = {
        "total_ports": 0,
        "active_ports": 0,
        "inactive_ports": 0,
        "never_used_ports": 0,
        "flapping_ports": 0
    }
    
    categories = {
        "unused_30_days": [],
        "unused_90_days": [],
        "never_used": [],
        "flapping": [],
        "low_utilization": [],
        "high_utilization": []
    }
    
    recommendations = {
        "safe_to_disable": [],
        "candidate_for_reassignment": [],
        "monitor_closely": [],
        "investigate": []
    }

    for p in sorted_ports:
        ifname = p["interface"]
        db_rec = db_stats.get(ifname, {})

        # Skip virtual/management ports from core port analysis if required
        # For switch ports, we usually analyze physical ethernet ports
        if not is_physical_interface(ifname):
            continue

        summary["total_ports"] += 1

        # Uptime and Inactive calculations
        up_time_iso = db_rec.get("last_link_up_time")
        down_time_iso = db_rec.get("last_link_down_time")
        
        uptime_sec = -1
        inactive_sec = -1
        
        if up_time_iso:
            try:
                up_dt = datetime.fromisoformat(up_time_iso)
                uptime_sec = (now - up_dt).total_seconds()
            except Exception:
                pass
                
        if down_time_iso:
            try:
                down_dt = datetime.fromisoformat(down_time_iso)
                inactive_sec = (now - down_dt).total_seconds()
            except Exception:
                pass

        # Determine port states & statistics
        status = p["status"]
        if status == 'up':
            summary["active_ports"] += 1
            port_uptime_str = parse_duration(uptime_sec)
            port_inactive_str = "—"
        else:
            summary["inactive_ports"] += 1
            port_uptime_str = "—"
            port_inactive_str = parse_duration(inactive_sec)
            if not up_time_iso:
                summary["never_used_ports"] += 1

        # Connected device info
        connected_device = "—"
        if p["lldp_neighbor"]:
            connected_device = f"LLDP: {p['lldp_neighbor']['neighbor_name']} ({p['lldp_neighbor']['neighbor_ip']})"
        elif p["cdp_neighbor"]:
            connected_device = f"CDP: {p['cdp_neighbor']['neighbor_name']} ({p['cdp_neighbor']['neighbor_ip']})"
        elif p["mac_entries"]:
            connected_device = f"Host: {p['mac_entries'][0]['ip_address']} ({p['mac_entries'][0]['mac_vendor']})"

        # VLAN Info
        vlan = "—"
        if p["mac_entries"]:
            vlans = {m["vlan"] for m in p["mac_entries"] if m["vlan"] != "—"}
            if vlans:
                vlan = ", ".join(sorted(list(vlans)))

        # Traffic util rates
        rx_util = p["rx_util"]
        tx_util = p["tx_util"]
        max_util = max(rx_util, tx_util)

        # Flapping status
        is_flapping = ifname in flapping_interfaces
        if not is_flapping and db_rec.get("status_changes_history"):
            try:
                history = json.loads(db_rec["status_changes_history"])
                # Flapping if changed > 2 times in 5 minutes
                if len(history) >= 2:
                    is_flapping = True
            except:
                pass
        
        if is_flapping:
            summary["flapping_ports"] += 1

        # Classifications
        is_unused_30 = (status == 'down' and inactive_sec >= 30 * 86400)
        is_unused_90 = (status == 'down' and inactive_sec >= 90 * 86400)
        is_never_used = (status == 'down' and not up_time_iso)
        is_low_util = (status == 'up' and max_util > 0.0 and max_util < 0.1)
        is_high_util = (status == 'up' and max_util >= 70.0)

        if is_unused_90:
            categories["unused_90_days"].append(ifname)
        elif is_unused_30:
            categories["unused_30_days"].append(ifname)
            
        if is_never_used:
            categories["never_used"].append(ifname)
        if is_flapping:
            categories["flapping"].append(ifname)
        if is_low_util:
            categories["low_utilization"].append(ifname)
        if is_high_util:
            categories["high_utilization"].append(ifname)

        # Recommendations logic
        rec_action = "—"
        rec_text = "Port beroperasi normal."
        rec_code = "ok"

        if status == 'down' and p["admin_status"] == 'up':
            if is_unused_90 or is_never_used:
                rec_action = "Safe to disable"
                rec_text = "Port tidak aktif lebih dari 90 hari atau belum pernah digunakan. Matikan port secara administratif demi keamanan."
                rec_code = "safe_to_disable"
                recommendations["safe_to_disable"].append(ifname)
            elif is_unused_30:
                rec_action = "Candidate for reassignment"
                rec_text = "Port tidak aktif lebih dari 30 hari. Port siap dialokasikan kembali untuk perangkat lain."
                rec_code = "reassign"
                recommendations["candidate_for_reassignment"].append(ifname)
        elif status == 'up':
            if is_flapping:
                rec_action = "Monitor closely"
                rec_text = "Port mengalami fluktuasi status (flapping). Periksa fisik kabel, konektor switch, atau stabilitas link."
                rec_code = "monitor"
                recommendations["monitor_closely"].append(ifname)
            elif is_high_util:
                rec_action = "Monitor closely"
                rec_text = "Utilisasi link sangat tinggi (>= 70%). Monitor kapasitas, pertimbangkan LACP port-channel untuk peningkatan bandwith."
                rec_code = "monitor"
                recommendations["monitor_closely"].append(ifname)
            elif p.get("health_status") in ("warning", "critical") or db_rec.get("crc_errors", 0) > 10:
                rec_action = "Investigate behavior"
                rec_text = f"Deteksi anomali/error pada port (CRC/Framing errors). Cek duplex mismatch atau bersihkan konektor RJ45."
                rec_code = "investigate"
                recommendations["investigate"].append(ifname)

        # Visual indicator colors
        visual_indicator = "green"
        if status == 'up':
            if is_flapping or p.get("health_status") == "critical":
                visual_indicator = "red"
            elif is_low_util:
                visual_indicator = "yellow"
        else: # down
            if is_never_used:
                visual_indicator = "red"
            elif is_unused_90:
                visual_indicator = "orange"
            elif is_unused_30:
                visual_indicator = "orange"

        # Determine port role / classification
        port_role = "Access"  # default
        if status == 'down':
            port_role = "Unused"
        elif p.get("lldp_neighbor") or p.get("cdp_neighbor"):
            port_role = "Uplink"
        else:
            # Check if MAC entries have multiple VLANs
            vlans = set()
            for m in p.get("mac_entries", []):
                v = m.get("vlan")
                if v and v != "—":
                    vlans.add(v)
            vlan_raw = p.get("vlan", "")
            if len(vlans) > 1:
                port_role = "Trunk"
            elif "trunk" in str(vlan_raw).lower():
                port_role = "Trunk"
            else:
                port_role = "Access"

        port_data = {
            "interface": ifname,
            "status": status,
            "admin_status": p["admin_status"],
            "speed": p["speed"],
            "speed_mbps": p["speed_mbps"],
            "last_link_up_time": up_time_iso or "Never",
            "last_link_down_time": down_time_iso or "Never",
            "port_uptime_duration": port_uptime_str,
            "port_inactive_duration": port_inactive_str,
            "traffic_in": p["rx_rate"],
            "traffic_out": p["tx_rate"],
            "rx_util": rx_util,
            "tx_util": tx_util,
            "connected_device": connected_device,
            "vlan": vlan,
            "recommendation_action": rec_action,
            "recommendation_text": rec_text,
            "recommendation_code": rec_code,
            "visual_indicator": visual_indicator,
            "role": port_role
        }
        
        analysis_ports.append(port_data)

    # Expected Port Count Validation
    model_name = device.get("hardware_model", "")
    expected_count = get_expected_port_count(model_name, device.get("device_type", ""))
    actual_count = summary["total_ports"]
    
    port_count_status = "ok"
    port_count_message = ""
    if expected_count > 0 and actual_count != expected_count:
        port_count_status = "mismatch"
        port_count_message = f"Peringatan: Jumlah port fisik terdeteksi ({actual_count}) tidak sesuai dengan spesifikasi model hardware ({model_name} mengharapkan {expected_count} port)."

    return {
        "summary": summary,
        "categories": categories,
        "recommendations": recommendations,
        "ports": analysis_ports,
        "hardware_validation": {
            "model": model_name,
            "expected_ports": expected_count,
            "actual_ports": actual_count,
            "status": port_count_status,
            "message": port_count_message
        }
    }
