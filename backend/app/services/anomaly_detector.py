import asyncio
import logging
import json
from datetime import datetime, timedelta
from app.database import get_db_conn
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, get_cmd, next_cmd, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)

logger = logging.getLogger("netx.anomaly_detector")

def load_device_thresholds(device_id: int, conn) -> dict:
    """Loads custom thresholds for a device, falling back to system defaults if none set."""
    c = conn.cursor()
    try:
        c.execute("""
            SELECT tp.* 
            FROM devices d
            JOIN threshold_profiles tp ON d.threshold_profile_id = tp.id
            WHERE d.id = ?
        """, (device_id,))
        row = c.fetchone()
    except Exception:
        row = None
    
    defaults = {
        "broadcast_storm_warning": 1000,
        "broadcast_storm_critical": 5000,
        "multicast_storm_warning": 1000,
        "multicast_storm_critical": 5000,
        "unicast_storm_warning": 80000,
        "unicast_storm_critical": 120000,
        "port_flap_warning": 3,
        "port_flap_critical": 6,
        "port_flap_window": 300,
        "crc_error_rate": 0.05,
        "crc_error_delta": 5,
        "frame_error_rate": 0.05,
        "frame_error_delta": 5,
        "transmission_error_rate": 0.1,
        "transmission_error_delta": 5
    }
    
    if not row:
        return defaults
        
    profile = dict(row)
    for k, default_val in defaults.items():
        if k in profile and profile[k] is not None:
            defaults[k] = profile[k]
            
    return defaults


# Configuration / Thresholds
BROADCAST_STORM_CRITICAL = 5000  # packets per second (pps)
BROADCAST_STORM_WARNING = 1000

MULTICAST_STORM_CRITICAL = 5000  # pps
MULTICAST_STORM_WARNING = 1000

UNICAST_STORM_CRITICAL = 100000  # pps
UNICAST_STORM_WARNING = 20000

PORT_FLAP_CRITICAL_COUNT = 6    # state changes in 5 mins
PORT_FLAP_WARNING_COUNT = 3     # state changes in 5 mins
PORT_FLAP_WINDOW_SECONDS = 300  # 5 minutes

STP_TCN_AUTO_RESOLVE_SECONDS = 300 # 5 minutes

def get_expected_speed_mbps(if_name: str) -> int:
    """Returns the expected speed in Mbps based on interface name, or 0 if unknown."""
    name_lower = if_name.lower()
    
    # 100G
    if any(name_lower.startswith(x) for x in ('hu', 'hundredgig')) or '100g' in name_lower:
        return 100000
    # 40G
    if any(name_lower.startswith(x) for x in ('fo', 'fortygig')) or '40g' in name_lower:
        return 40000
    # 25G
    if '25g' in name_lower:
        return 25000
        
    # 10G
    if name_lower.startswith('tengig') or '10g' in name_lower or \
       (name_lower.startswith('te') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('xe'):
        return 10000
        
    # 1G
    if name_lower.startswith('gigabit') or '1g' in name_lower or \
       (name_lower.startswith('gi') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('ge') or '1000base' in name_lower:
        return 1000
        
    # 100M
    if name_lower.startswith('fastethernet') or \
       (name_lower.startswith('fa') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('fe'):
        return 100
        
    # 10G/40G/100G Juniper 'et-'
    if name_lower.startswith('et-'):
        return 100000
    
    # 10M
    if name_lower.startswith('ethernet') or \
       (name_lower.startswith('et') and any(x.isdigit() for x in name_lower)):
        return 10
        
    return 0

async def walk_oid(ip: str, community: str, mp_model: int, oid_str: str, snmp_engine=None) -> dict:
    """Walks an OID and returns a dict mapping index (int) to value string."""
    results = {}
    local_engine = snmp_engine is None
    engine = snmp_engine if snmp_engine else SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
        authData = CommunityData(community, mpModel=mp_model)
        contextData = ContextData()
        
        start_oid_clean = oid_str.strip('.')
        prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
        varBinds = [ObjectType(ObjectIdentity(oid_str))]
        
        while True:
            res = await next_cmd(engine, authData, transport, contextData, *varBinds)
            errorIndication, errorStatus, errorIndex, varBindTable = res
            if errorIndication or errorStatus or not varBindTable:
                break
                
            firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
            if not firstVarBinds:
                break
            
            current_var_bind = firstVarBinds[0]
            current_oid_tuple = current_var_bind[0].asTuple()
            
            if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                break
                
            idx = current_oid_tuple[-1]
            val = current_var_bind[1]
            results[idx] = val.prettyPrint()
            
            varBinds = firstVarBinds
    except Exception as e:
        logger.debug(f"SNMP walk error on {ip} for {oid_str}: {e}")
    finally:
        if local_engine:
            try:
                engine.close_dispatcher()
            except Exception:
                pass
    return results

async def get_scalar_oid(ip: str, community: str, mp_model: int, oid_str: str, snmp_engine=None) -> str:
    """Gets a single scalar OID value (e.g. dot1dStpTopChanges.0)."""
    local_engine = snmp_engine is None
    engine = snmp_engine if snmp_engine else SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
        res = await get_cmd(
            engine,
            CommunityData(community, mpModel=mp_model),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(oid_str))
        )
        errorIndication, errorStatus, errorIndex, varBinds = res
        if not errorIndication and not errorStatus and varBinds:
            return varBinds[0][1].prettyPrint()
    except Exception as e:
        logger.debug(f"SNMP get error on {ip} for {oid_str}: {e}")
    finally:
        if local_engine:
            try:
                engine.close_dispatcher()
            except Exception:
                pass
    return ""

def check_mac_flapping(device_id: int, mac_entries: list, conn) -> list:
    """
    Checks for MAC address movements/flaps.
    Called during device sync or periodic scans.
    """
    now = datetime.now()
    now_iso = now.isoformat()
    c = conn.cursor()
    
    detected_flaps = []
    
    # Get device name for details logging
    c.execute("SELECT name FROM devices WHERE id = ?", (device_id,))
    row_dev = c.fetchone()
    device_name = row_dev["name"] if row_dev else f"Device #{device_id}"
    
    for entry in mac_entries:
        mac = entry.get("mac_address")
        if not mac or mac == "00:00:00:00:00:00":
            continue
            
        mac = mac.strip().upper()
        interface = entry.get("interface", "")
        vlan = entry.get("vlan", "1")
        
        # Check if MAC exists in history
        c.execute("SELECT device_id, interface_name, vlan, updated_at FROM mac_history_tracking WHERE mac_address = ?", (mac,))
        row = c.fetchone()
        
        if row:
            old_device_id = row["device_id"]
            old_interface = row["interface_name"]
            old_vlan = row["vlan"]
            old_time_str = row["updated_at"]
            
            # If location changed
            if old_device_id != device_id or old_interface != interface:
                # Check time difference
                try:
                    old_time = datetime.fromisoformat(old_time_str)
                    diff_seconds = (now - old_time).total_seconds()
                except Exception:
                    diff_seconds = 9999
                    
                if diff_seconds < 900: # 15 minutes threshold
                    # We have a MAC flap!
                    # Get old device name
                    c.execute("SELECT name FROM devices WHERE id = ?", (old_device_id,))
                    row_old_dev = c.fetchone()
                    old_device_name = row_old_dev["name"] if row_old_dev else f"Device #{old_device_id}"
                    
                    details = f"MAC address {mac} berpindah dari {old_device_name} ({old_interface}) ke {device_name} ({interface}) dalam {int(diff_seconds)} detik."
                    
                    # Raise anomaly if not already active
                    c.execute("""
                        SELECT id FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'mac_flapping' AND interface_name = ? AND is_active = 1
                    """, (device_id, interface))
                    act_row = c.fetchone()
                    
                    if not act_row:
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'mac_flapping', 'warning', ?, ?, 1, ?)
                        """, (device_id, interface, details, now_iso))
                        
                        detected_flaps.append({
                            "mac": mac,
                            "old": f"{old_device_name}:{old_interface}",
                            "new": f"{device_name}:{interface}",
                            "details": details
                        })
            
            # Update history
            c.execute("""
                UPDATE mac_history_tracking 
                SET device_id = ?, interface_name = ?, vlan = ?, updated_at = ? 
                WHERE mac_address = ?
            """, (device_id, interface, vlan, now_iso, mac))
        else:
            # Insert history
            c.execute("""
                INSERT INTO mac_history_tracking (mac_address, device_id, interface_name, vlan, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (mac, device_id, interface, vlan, now_iso))
            
    return detected_flaps

async def scan_device_anomalies(device: dict):
    """Polls SNMP data for a single device and computes anomaly metrics."""
    device_id = device["id"]
    ip = device["ip"]
    community = device["snmp_community"]
    version = device["snmp_version"] or "v2c"
    mp_model = 1 if version == "v2c" else 0
    
    now = datetime.now()
    now_iso = now.isoformat()
    
    logger.info(f"Scanning anomalies for device {device['name']} ({ip})...")
    
    # 1. Fetch Interface details in parallel using a single SnmpEngine
    snmp_engine = SnmpEngine()
    try:
        tasks = [
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.2', snmp_engine=snmp_engine),     # descrs (ifDescr)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.8', snmp_engine=snmp_engine),     # statuses (ifOperStatus)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.3', snmp_engine=snmp_engine), # in_broadcast (ifInBroadcastPkts)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.5', snmp_engine=snmp_engine), # out_broadcast (ifOutBroadcastPkts)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.2', snmp_engine=snmp_engine), # in_multicast (ifInMulticastPkts)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.4', snmp_engine=snmp_engine), # out_multicast (ifOutMulticastPkts)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.11', snmp_engine=snmp_engine),    # in_unicast (ifInUcastPkts)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.17', snmp_engine=snmp_engine),    # out_unicast (ifOutUcastPkts)
            get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.4.0', snmp_engine=snmp_engine), # dot1dStpTopChanges.0
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.5', snmp_engine=snmp_engine),     # speeds (ifSpeed)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.15', snmp_engine=snmp_engine), # high_speeds (ifHighSpeed)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.14', snmp_engine=snmp_engine),    # in_errors (ifInErrors)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.20', snmp_engine=snmp_engine),    # out_errors (ifOutErrors)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.10.7.2.1.3', snmp_engine=snmp_engine),  # crc_errors (dot3StatsFCSErrors)
            walk_oid(ip, community, mp_model, '1.3.6.1.2.1.10.7.2.1.2', snmp_engine=snmp_engine),  # frame_errors (dot3StatsAlignmentErrors)
        ]
        res = await asyncio.gather(*tasks)
    except Exception as e:
        logger.error(f"Error gathering SNMP data for {device['name']}: {e}")
        return
    finally:
        try:
            snmp_engine.close_dispatcher()
        except Exception:
            pass
        
    descrs, statuses, in_broad, out_broad, in_multi, out_multi, in_uni, out_uni, stp_tc, speeds, high_speeds, in_errors, out_errors, crc_errors, frame_errors = res
    
    if not descrs:
        logger.warning(f"Device {device['name']} did not return any interface descriptors via SNMP.")
        return
        
    # Open local connection for this device's updates
    conn = get_db_conn()
    try:
        th = load_device_thresholds(device_id, conn)
        c = conn.cursor()
        # Get active/previous stats from DB
        c.execute("SELECT * FROM interface_stats_latest WHERE device_id = ?", (device_id,))
        prev_stats_rows = c.fetchall()
        prev_stats = {r["interface_name"]: dict(r) for r in prev_stats_rows}
        
        # 2. Parse STP Topology Changes (TCN)
        try:
            current_stp_tc = int(stp_tc) if stp_tc else 0
        except ValueError:
            current_stp_tc = 0
            
        # Get previous STP TCN from first available interface row or 0
        prev_stp_tc = 0
        if prev_stats_rows:
            prev_stp_tc = dict(prev_stats_rows[0]).get("stp_top_changes") or 0
            
        if current_stp_tc > prev_stp_tc:
            delta_tc = current_stp_tc - prev_stp_tc
            details = f"Deteksi perubahan topologi Layer 2 (STP Topology Change). Counter naik dari {prev_stp_tc} ke {current_stp_tc}."
            
            # Insert L2 topology change anomaly if not already active
            c.execute("""
                SELECT id FROM network_anomalies 
                WHERE device_id = ? AND anomaly_type = 'stp_tcn' AND is_active = 1
            """, (device_id,))
            if not c.fetchone():
                c.execute("""
                    INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                    VALUES (?, 'stp_tcn', 'warning', 'Global', ?, 1, ?)
                """, (device_id, details, now_iso))
                logger.warning(f"L2 topology change detected on {device['name']}!")

        # 3. Looping for each physical interface
        for idx, descr in descrs.items():
            if descr.startswith('0x'):
                try:
                    if_name = bytes.fromhex(descr[2:]).decode('utf-8', errors='ignore')
                except Exception:
                    if_name = descr
            else:
                if_name = descr
                
            if not if_name:
                continue
                
            # Skip Null / Loopback / Virtual / Management / LAGs / Subinterfaces
            name_lower = if_name.lower()
            if '.' in name_lower or any(name_lower.startswith(x) for x in (
                   'null', 'loopback', 'vlan', 'mgmt', 'management', 'port-channel', 'po', 
                   'bridge', 'bdi', 'tunnel', 'tu', 'lo', 'virtual', 'vl', 'stack', 'portchannel',
                   'wlan', 'veth', 'docker'
               )):
                c.execute("""
                    UPDATE network_anomalies 
                    SET is_active = 0, resolved_at = ? 
                    WHERE device_id = ? AND interface_name = ? AND is_active = 1
                """, (now_iso, device_id, if_name))
                continue
                
            # Extract operational status
            raw_status = statuses.get(idx, 'unknown')
            status_map = {'1': 'up', '2': 'down'}
            oper_status = status_map.get(raw_status, 'unknown')
            
            # Get SNMP counter values
            ib = int(in_broad.get(idx, 0))
            ob = int(out_broad.get(idx, 0))
            im = int(in_multi.get(idx, 0))
            om = int(out_multi.get(idx, 0))
            iu = int(in_uni.get(idx, 0))
            ou = int(out_uni.get(idx, 0))
            
            # Physical port error counters
            rx_err = int(in_errors.get(idx, 0))
            tx_err = int(out_errors.get(idx, 0))
            crc_err = int(crc_errors.get(idx, 0))
            frame_err = int(frame_errors.get(idx, 0))
            
            # Speed calculations
            speed_bps = 0
            try:
                high_val = int(high_speeds.get(idx, 0))
                if high_val > 0:
                    speed_bps = high_val * 1000000
                else:
                    speed_bps = int(speeds.get(idx, 0))
            except:
                pass
            speed_mbps = speed_bps // 1000000

            prev = prev_stats.get(if_name)
            
            prev_rx_err = 0
            prev_tx_err = 0
            prev_crc_err = 0
            prev_frame_err = 0
            if prev:
                try: prev_rx_err = int(prev.get("in_errors") or 0)
                except: pass
                try: prev_tx_err = int(prev.get("out_errors") or 0)
                except: pass
                try: prev_crc_err = int(prev.get("crc_errors") or 0)
                except: pass
                try: prev_frame_err = int(prev.get("frame_errors") or 0)
                except: pass
            
            # Initial status changes history
            changes_hist = []
            
            if prev:
                # Calculate delta time
                try:
                    prev_time = datetime.fromisoformat(prev["updated_at"])
                    delta_t = (now - prev_time).total_seconds()
                except Exception:
                    delta_t = 60.0
                    
                if delta_t <= 0:
                    delta_t = 1.0
                    
                # Compute rates
                rate_in_broad = max(0, (ib - prev["in_broadcast"])) / delta_t
                rate_out_broad = max(0, (ob - prev["out_broadcast"])) / delta_t
                rate_in_multi = max(0, (im - prev["in_multicast"])) / delta_t
                rate_out_multi = max(0, (om - prev["out_multicast"])) / delta_t
                rate_in_uni = max(0, (iu - prev["in_unicast"])) / delta_t
                rate_out_uni = max(0, (ou - prev["out_unicast"])) / delta_t
                
                # Compute absolute delta of errors
                delta_rx_err = max(0, rx_err - prev_rx_err)
                delta_tx_err = max(0, tx_err - prev_tx_err)
                delta_crc_err = max(0, crc_err - prev_crc_err)
                delta_frame_err = max(0, frame_err - prev_frame_err)
                
                # Compute error rates
                rate_rx_err = delta_rx_err / delta_t
                rate_tx_err = delta_tx_err / delta_t
                rate_crc_err = delta_crc_err / delta_t
                rate_frame_err = delta_frame_err / delta_t
                
                # --- Port & Cable Physical Health Detection ---
                # 1. CRC / LAN Cable Errors (Requires rate >= th["crc_error_rate"] AND delta >= th["crc_error_delta"])
                if rate_crc_err >= th["crc_error_rate"] and delta_crc_err >= th["crc_error_delta"]:
                    details = f"Peningkatan CRC errors terdeteksi pada interface {if_name}: {rate_crc_err:.2f} errors/detik. Total: {crc_err}. Mengindikasikan kerusakan fisik kabel LAN atau pin port kotor."
                    c.execute("""
                        SELECT id FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'crc_errors' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'crc_errors', 'critical', ?, ?, 1, ?)
                        """, (device_id, if_name, details, now_iso))
                elif rate_crc_err == 0.0:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'crc_errors' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))

                # 2. Framing Errors (Requires rate >= th["frame_error_rate"] AND delta >= th["frame_error_delta"])
                if rate_frame_err >= th["frame_error_rate"] and delta_frame_err >= th["frame_error_delta"]:
                    details = f"Peningkatan Framing errors terdeteksi pada interface {if_name}: {rate_frame_err:.2f} errors/detik. Total: {frame_err}. Adanya kerusakan sirkuit fisik atau interferensi berat."
                    c.execute("""
                        SELECT id FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'framing_errors' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'framing_errors', 'warning', ?, ?, 1, ?)
                        """, (device_id, if_name, details, now_iso))
                elif rate_frame_err == 0.0:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'framing_errors' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))

                # 3. Transmission Errors (RX-ERR / TX-ERR) (Requires rate >= th["transmission_error_rate"] AND delta >= th["transmission_error_delta"])
                if (rate_rx_err >= th["transmission_error_rate"] or rate_tx_err >= th["transmission_error_rate"]) and (delta_rx_err + delta_tx_err) >= th["transmission_error_delta"]:
                    details = f"Deteksi transmission errors pada interface {if_name}: Laju RX-ERR {rate_rx_err:.2f}/s, TX-ERR {rate_tx_err:.2f}/s. Total RX-ERR: {rx_err}, TX-ERR: {tx_err}. Kerusakan sirkuit port internal."
                    c.execute("""
                        SELECT id FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'transmission_errors' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'transmission_errors', 'critical', ?, ?, 1, ?)
                        """, (device_id, if_name, details, now_iso))
                elif rate_rx_err == 0.0 and rate_tx_err == 0.0:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'transmission_errors' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))

                # 4. Link Speed Drop (Accurate check based on classification)
                speed_drop_warning = None
                if oper_status == 'up':
                    expected_speed = get_expected_speed_mbps(if_name)
                    if expected_speed > 0 and speed_mbps > 0 and speed_mbps < expected_speed:
                        if expected_speed >= 100000:
                            speed_type = "100G"
                        elif expected_speed >= 40000:
                            speed_type = "40G"
                        elif expected_speed >= 10000:
                            speed_type = "10G"
                        elif expected_speed >= 1000:
                            speed_type = "Gigabit"
                        elif expected_speed >= 100:
                            speed_type = "FastEthernet"
                        else:
                            speed_type = "Ethernet"
                            
                        curr_speed_str = f"{speed_mbps / 1000:.1f} Gbps".replace('.0 ', ' ') if speed_mbps >= 1000 else f"{speed_mbps} Mbps"
                        speed_drop_warning = f"Port {speed_type} sinkron pada {curr_speed_str} (Link Speed Drop!)."
                
                if speed_drop_warning:
                    details = f"Penurunan kecepatan link terdeteksi pada interface {if_name}: {speed_drop_warning}. Pin port kotor, berkarat, atau kabel LAN rusak."
                    c.execute("""
                        SELECT id FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'speed_drop' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'speed_drop', 'warning', ?, ?, 1, ?)
                        """, (device_id, if_name, details, now_iso))
                else:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'speed_drop' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))
                
                # --- Storm Detection ---
                # Broadcast Storm
                rate_broad = max(rate_in_broad, rate_out_broad)
                if rate_broad >= th["broadcast_storm_warning"]:
                    sev = 'critical' if rate_broad >= th["broadcast_storm_critical"] else 'warning'
                    details = f"Trafik Broadcast tinggi pada interface {if_name}: {int(rate_broad)} pps (Batas: {th['broadcast_storm_warning']} pps)."
                    
                    # Check if already active
                    c.execute("""
                        SELECT id, severity FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'broadcast_storm' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    act = c.fetchone()
                    if act:
                        if act["severity"] != sev:
                            c.execute("UPDATE network_anomalies SET severity = ?, details = ? WHERE id = ?", (sev, details, act["id"]))
                    else:
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'broadcast_storm', ?, ?, ?, 1, ?)
                        """, (device_id, sev, if_name, details, now_iso))
                else:
                    # Resolve broadcast storm
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'broadcast_storm' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))
                    
                # Multicast Storm
                rate_mult = max(rate_in_multi, rate_out_multi)
                if rate_mult >= th["multicast_storm_warning"]:
                    sev = 'critical' if rate_mult >= th["multicast_storm_critical"] else 'warning'
                    details = f"Trafik Multicast tinggi pada interface {if_name}: {int(rate_mult)} pps (Batas: {th['multicast_storm_warning']} pps)."
                    
                    c.execute("""
                        SELECT id, severity FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'multicast_storm' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    act = c.fetchone()
                    if act:
                        if act["severity"] != sev:
                            c.execute("UPDATE network_anomalies SET severity = ?, details = ? WHERE id = ?", (sev, details, act["id"]))
                    else:
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'multicast_storm', ?, ?, ?, 1, ?)
                        """, (device_id, sev, if_name, details, now_iso))
                else:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'multicast_storm' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))

                # Unicast Storm (Dynamic threshold based on interface speed)
                rate_unic = max(rate_in_uni, rate_out_uni)
                
                # Get speed to scale threshold
                port_speed = speed_mbps if speed_mbps > 0 else get_expected_speed_mbps(if_name)
                port_speed = port_speed if port_speed > 0 else 1000 # default to 1G if unknown
                
                # Dynamic unicast threshold: scale base thresholds (warning=80k, critical=120k for 1G)
                unicast_warn = th["unicast_storm_warning"] * (port_speed / 1000)
                unicast_crit = th["unicast_storm_critical"] * (port_speed / 1000)
                
                if rate_unic >= unicast_warn:
                    sev = 'critical' if rate_unic >= unicast_crit else 'warning'
                    details = f"Trafik Unicast tinggi pada interface {if_name}: {int(rate_unic)} pps (Batas: {int(unicast_warn)} pps)."
                    
                    c.execute("""
                        SELECT id, severity FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'unicast_storm' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    act = c.fetchone()
                    if act:
                        if act["severity"] != sev:
                            c.execute("UPDATE network_anomalies SET severity = ?, details = ? WHERE id = ?", (sev, details, act["id"]))
                    else:
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'unicast_storm', ?, ?, ?, 1, ?)
                        """, (device_id, sev, if_name, details, now_iso))
                else:
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'unicast_storm' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))
                    
                # --- Flapping Detection ---
                try:
                    changes_hist = json.loads(prev["status_changes_history"])
                except Exception:
                    changes_hist = []
                    
                # If oper status changed
                if oper_status != prev["oper_status"] and oper_status in ('up', 'down') and prev["oper_status"] in ('up', 'down'):
                    changes_hist.append(now_iso)
                    
                # Filter changes older than 5 minutes
                cutoff = now - timedelta(seconds=th["port_flap_window"])
                valid_changes = []
                for t_str in changes_hist:
                    try:
                        t = datetime.fromisoformat(t_str)
                        if t > cutoff:
                            valid_changes.append(t_str)
                    except Exception:
                        pass
                changes_hist = valid_changes
                
                changes_count = len(changes_hist)
                if changes_count >= th["port_flap_warning"]:
                    sev = 'critical' if changes_count >= th["port_flap_critical"] else 'warning'
                    details = f"Port Flapping terdeteksi pada interface {if_name}: status berubah {changes_count} kali dalam {int(th['port_flap_window']/60)} menit terakhir."
                    
                    c.execute("""
                        SELECT id, severity FROM network_anomalies 
                        WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
                    """, (device_id, if_name))
                    act = c.fetchone()
                    if act:
                        if act["severity"] != sev:
                            c.execute("UPDATE network_anomalies SET severity = ?, details = ? WHERE id = ?", (sev, details, act["id"]))
                    else:
                        c.execute("""
                            INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                            VALUES (?, 'port_flapping', ?, ?, ?, 1, ?)
                        """, (device_id, sev, if_name, details, now_iso))
                else:
                    # Resolve port flapping
                    c.execute("""
                        UPDATE network_anomalies 
                        SET is_active = 0, resolved_at = ? 
                        WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
                    """, (now_iso, device_id, if_name))
            
            # Save current stats to DB (using upsert/replace)
            c.execute("""
                INSERT OR REPLACE INTO interface_stats_latest (
                    device_id, interface_name, in_broadcast, out_broadcast,
                    in_multicast, out_multicast, in_unicast, out_unicast,
                    oper_status, stp_top_changes, status_changes_history, updated_at,
                    in_errors, out_errors, crc_errors, frame_errors, link_speed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                device_id, if_name, ib, ob, im, om, iu, ou,
                oper_status, current_stp_tc, json.dumps(changes_hist), now_iso,
                rx_err, tx_err, crc_err, frame_err, speed_mbps
            ))
        conn.commit()
    except Exception as e:
        logger.error(f"Database error in anomaly scanning for {device['name']}: {e}")
        conn.rollback()
    finally:
        conn.close()
        try:
            from app.services.health_monitor import monitor
            monitor.record_scan_completed()
        except Exception:
            pass

def correlate_active_anomalies(conn):
    """
    Performs Event Correlation & Root Cause Analysis (RCA).
    Links dependent anomalies to their root cause by setting parent_anomaly_id.
    """
    c = conn.cursor()
    now_iso = datetime.now().isoformat()
    
    # 1. Sync device_offline anomalies based on device status
    c.execute("SELECT id, name, status FROM devices")
    devices = c.fetchall()
    for dev in devices:
        dev_id = dev["id"]
        dev_name = dev["name"]
        if dev["status"] == "offline":
            # Ensure active device_offline anomaly exists
            c.execute("""
                SELECT id FROM network_anomalies 
                WHERE device_id = ? AND anomaly_type = 'device_offline' AND is_active = 1
            """, (dev_id,))
            if not c.fetchone():
                details = f"Perangkat {dev_name} terdeteksi offline. Tidak dapat terhubung via SSH/Telnet atau SNMP."
                c.execute("""
                    INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                    VALUES (?, 'device_offline', 'critical', 'Global', ?, 1, ?)
                """, (dev_id, details, now_iso))
        else:
            # Resolve any active device_offline anomaly
            c.execute("""
                UPDATE network_anomalies 
                SET is_active = 0, resolved_at = ? 
                WHERE device_id = ? AND anomaly_type = 'device_offline' AND is_active = 1
            """, (now_iso, dev_id))
            
    # 2. Reset parent links for all active anomalies
    c.execute("UPDATE network_anomalies SET parent_anomaly_id = NULL WHERE is_active = 1")
    
    # 3. Fetch all active anomalies
    c.execute("SELECT * FROM network_anomalies WHERE is_active = 1")
    active_anoms = [dict(r) for r in c.fetchall()]
    if not active_anoms:
        return
        
    # Map device_id -> anomalies
    device_anoms = {}
    for anom in active_anoms:
        did = anom["device_id"]
        if did not in device_anoms:
            device_anoms[did] = []
        device_anoms[did].append(anom)
        
    # 4. Fetch topology mapping (LLDP and CDP)
    c.execute("SELECT id, ip, name FROM devices")
    dev_rows = c.fetchall()
    ip_to_id = {}
    name_to_id = {}
    for d in dev_rows:
        ip_to_id[d["ip"]] = d["id"]
        name_to_id[d["name"].lower().strip()] = d["id"]
        
    # Fetch LLDP links
    c.execute("SELECT device_id, local_port, neighbor_name, neighbor_ip, neighbor_port FROM lldp_neighbors")
    lldp_rows = c.fetchall()
    
    def clean_port(port_name: str) -> str:
        if not port_name:
            return ""
        token = port_name.split()[0] if port_name.split() else port_name
        if token.endswith(".0"):
            token = token[:-2]
        return token.lower()
        
    links = {}
    
    for row in lldp_rows:
        n_id = None
        n_ip = row["neighbor_ip"]
        n_name = row["neighbor_name"]
        
        if n_ip in ip_to_id:
            n_id = ip_to_id[n_ip]
        elif n_name:
            n_key = n_name.lower().strip()
            if n_key in name_to_id:
                n_id = name_to_id[n_key]
                
        if n_id:
            did = row["device_id"]
            lp = clean_port(row["local_port"])
            np = clean_port(row["neighbor_port"])
            links[(did, lp)] = (n_id, np)
            links[(n_id, np)] = (did, lp)
            
    # Fetch CDP links
    c.execute("SELECT device_id, local_port, neighbor_name, neighbor_ip, neighbor_port FROM cdp_neighbors")
    cdp_rows = c.fetchall()
    for row in cdp_rows:
        n_id = None
        n_ip = row["neighbor_ip"]
        n_name = row["neighbor_name"]
        if n_ip in ip_to_id:
            n_id = ip_to_id[n_ip]
        elif n_name:
            n_key = n_name.lower().strip()
            if n_key in name_to_id:
                n_id = name_to_id[n_key]
                
        if n_id:
            did = row["device_id"]
            lp = clean_port(row["local_port"])
            np = clean_port(row["neighbor_port"])
            links[(did, lp)] = (n_id, np)
            links[(n_id, np)] = (did, lp)
            
    # 5. Correlate
    for anom in active_anoms:
        anom_id = anom["id"]
        did = anom["device_id"]
        atype = anom["anomaly_type"]
        iface = clean_port(anom["interface_name"])
        
        # Scenario A: Device is offline
        if atype == 'device_offline':
            for (src_id, src_port), (dst_id, dst_port) in links.items():
                if src_id == did:
                    if dst_id in device_anoms:
                        for neighbor_anom in device_anoms[dst_id]:
                            n_port = clean_port(neighbor_anom["interface_name"])
                            if n_port == dst_port and neighbor_anom["anomaly_type"] in ('port_flapping', 'port_down', 'crc_errors'):
                                c.execute("UPDATE network_anomalies SET parent_anomaly_id = ? WHERE id = ?", (neighbor_anom["id"], anom_id))
                                break
                        else:
                            for neighbor_anom in device_anoms[dst_id]:
                                if neighbor_anom["anomaly_type"] == 'device_offline':
                                    c.execute("UPDATE network_anomalies SET parent_anomaly_id = ? WHERE id = ?", (neighbor_anom["id"], anom_id))
                                    break
        
        # Scenario B: Interface anomalies
        elif atype in ('port_flapping', 'port_down') and iface:
            if (did, iface) in links:
                n_id, n_port = links[(did, iface)]
                if n_id in device_anoms:
                    for neighbor_anom in device_anoms[n_id]:
                        if clean_port(neighbor_anom["interface_name"]) == n_port and neighbor_anom["anomaly_type"] in ('port_flapping', 'port_down'):
                            if neighbor_anom["detected_at"] <= anom["detected_at"]:
                                c.execute("UPDATE network_anomalies SET parent_anomaly_id = ? WHERE id = ?", (neighbor_anom["id"], anom_id))
                                break

def auto_resolve_transient_anomalies(conn):
    """Automatically resolves transient anomalies (like stp_tcn) after a timeout."""
    c = conn.cursor()
    now = datetime.now()
    now_iso = now.isoformat()
    
    # 1. STP TCN resolution: 5 minutes timeout
    cutoff_stp = (now - timedelta(seconds=STP_TCN_AUTO_RESOLVE_SECONDS)).isoformat()
    c.execute("""
        UPDATE network_anomalies 
        SET is_active = 0, resolved_at = ? 
        WHERE anomaly_type = 'stp_tcn' AND is_active = 1 AND detected_at < ?
    """, (now_iso, cutoff_stp))
    
    # 2. MAC Flapping resolution: 15 minutes timeout
    cutoff_mac = (now - timedelta(minutes=15)).isoformat()
    c.execute("""
        UPDATE network_anomalies 
        SET is_active = 0, resolved_at = ? 
        WHERE anomaly_type = 'mac_flapping' AND is_active = 1 AND detected_at < ?
    """, (now_iso, cutoff_mac))
    
async def run_anomaly_detection():
    """Runs a single round of scanning for all devices."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        # Avoid scanning devices that are offline
        c.execute("SELECT id, name, ip, snmp_version, snmp_community FROM devices WHERE status != 'offline'")
        devices = [dict(r) for r in c.fetchall()]
    except Exception as e:
        logger.error(f"Error querying devices for anomaly detection: {e}")
        return
    finally:
        conn.close()
        
    snmp_devices = [d for d in devices if d["snmp_community"]]
    
    # Use a Semaphore to limit parallel SNMP requests to at most 3 devices at a time
    sem = asyncio.Semaphore(3)
    
    async def sem_scan(device):
        async with sem:
            try:
                await scan_device_anomalies(device)
            except Exception as e:
                logger.error(f"Exception during scanning anomalies for {device['name']}: {e}")
                
    tasks = [sem_scan(d) for d in snmp_devices]
    
    if not tasks:
        logger.debug("No active SNMP-enabled devices to scan for anomalies.")
        return
        
    try:
        await asyncio.gather(*tasks)
        
        # Apply auto-resolves with a dedicated transaction/connection
        conn_resolve = get_db_conn()
        try:
            auto_resolve_transient_anomalies(conn_resolve)
            correlate_active_anomalies(conn_resolve)
            conn_resolve.commit()
        except Exception as ex:
            logger.error(f"Error auto-resolving/correlating anomalies: {ex}")
            conn_resolve.rollback()
        finally:
            conn_resolve.close()
    except Exception as e:
        logger.error(f"Error in anomaly detection scan iteration: {e}")

async def start_anomaly_detection_scheduler():
    """Background loop that ticks every 300 seconds to scan for anomalies."""
    logger.info("Initializing Network Anomaly Detection Scheduler...")
    
    # Delay the initial scan by 30 seconds to allow the web server to start up smoothly
    await asyncio.sleep(30)
    logger.info("Running initial network anomaly detection scan...")
    try:
        await run_anomaly_detection()
    except Exception as e:
        logger.error(f"Initial anomaly detection run failed: {e}")
        
    while True:
        await asyncio.sleep(300)  # Scan every 5 minutes (300 seconds) instead of 60 seconds
        try:
            await run_anomaly_detection()
        except Exception as e:
            logger.error(f"Error in anomaly detection scheduler tick: {e}")
