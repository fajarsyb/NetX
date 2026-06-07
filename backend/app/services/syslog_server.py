import asyncio
import logging
import re
import json
from datetime import datetime, timedelta
from app.database import get_db_conn

logger = logging.getLogger("netx.syslog_server")

# Cache mapping sender IP -> device_id
# None represents an unregistered device
IP_TO_DEVICE_CACHE = {}
CACHE_LAST_CLEARED = datetime.now()

def clear_ip_cache():
    """Clears the IP-to-device mapping cache to pick up updates."""
    global IP_TO_DEVICE_CACHE, CACHE_LAST_CLEARED
    IP_TO_DEVICE_CACHE.clear()
    CACHE_LAST_CLEARED = datetime.now()
    logger.debug("IP to Device cache cleared.")

def resolve_device_id_by_ip(ip: str) -> int | None:
    """Resolves device_id from sender IP with caching."""
    global IP_TO_DEVICE_CACHE, CACHE_LAST_CLEARED
    
    # Auto-expire cache after 5 minutes
    if datetime.now() - CACHE_LAST_CLEARED > timedelta(minutes=5):
        clear_ip_cache()
        
    if ip in IP_TO_DEVICE_CACHE:
        return IP_TO_DEVICE_CACHE[ip]
        
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM devices WHERE ip = ?", (ip,))
    row = c.fetchone()
    conn.close()
    
    device_id = row["id"] if row else None
    IP_TO_DEVICE_CACHE[ip] = device_id
    return device_id

def parse_syslog_message(raw_msg: str) -> tuple[int, int, str, str, str]:
    """
    Parses a raw syslog message.
    Returns (facility, severity, program, message, timestamp)
    """
    facility = 1  # user-level messages default
    severity = 5  # notice default
    program = "syslog"
    message = raw_msg
    timestamp = datetime.now().isoformat()
    
    # Parse priority <PRI> (e.g. <30> or <189>)
    pri_match = re.match(r"^<(\d+)>", raw_msg)
    if pri_match:
        try:
            pri = int(pri_match.group(1))
            facility = pri // 8
            severity = pri % 8
            # Strip the priority from message body
            message = raw_msg[pri_match.end():].strip()
        except ValueError:
            pass
            
    # Try to extract program/tag (Cisco style %LINK-3-UPDOWN: or %SYS-5-CONFIG_I: or similar)
    # Common format: %TAG: or TAG: or TAG[PID]:
    tag_match = re.search(r"%([A-Z0-9_\-]+)(?:-\d+-[A-Z0-9_\-]+)?\s*:", message)
    if tag_match:
        program = tag_match.group(1)
    else:
        # Generic program tag (e.g. "sshd[1234]:")
        generic_match = re.search(r"(\b[a-zA-Z0-9_\-]+)(?:\[\d+\])?\s*:", message)
        if generic_match:
            candidate = generic_match.group(1)
            # Avoid matching timestamps or common text like "Interface" as program
            if candidate.lower() not in ("interface", "port", "vlan", "state", "changed", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep"):
                program = candidate
                
    # Clean up timestamp strings if they are printed in the syslog message body
    # e.g. "82: *Oct 11 22:14:14.123: %LINK..." -> Strip prefixes
    clean_msg = message
    time_prefix_match = re.search(r"^\d+:\s*(?:\*\w{3}\s+\d+\s+\d+:\d+:\d+(?:\.\d+)?:\s*)?%[A-Z0-9_]+", message)
    if time_prefix_match:
        # It's a Cisco formatted message with sequence and timestamp
        pass
        
    return facility, severity, program, message, timestamp

def analyze_syslog_for_anomalies(device_id: int, severity: int, program: str, message: str, now_iso: str):
    """Parses syslog text to detect network anomalies in real-time."""
    if not device_id:
        return
        
    conn = get_db_conn()
    c = conn.cursor()
    
    try:
        # Get device name
        c.execute("SELECT name FROM devices WHERE id = ?", (device_id,))
        row_dev = c.fetchone()
        device_name = row_dev["name"] if row_dev else f"Device #{device_id}"
        
        # 1. Port Flapping / Link Down Detection
        # Match Cisco: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down
        # Match Allied Telesis: Interface port1.0.1 is link down
        # Match Juniper: ge-0/0/0.0 link down
        is_link_down = False
        is_link_up = False
        interface = "unknown"
        
        # Check down conditions
        if "changed state to down" in message.lower() or "link down" in message.lower() or "port.linkdown" in message.lower() or "link_down" in message.lower():
            is_link_down = True
        elif "changed state to up" in message.lower() or "link up" in message.lower() or "port.linkup" in message.lower() or "link_up" in message.lower():
            is_link_up = True
            
        if is_link_down or is_link_up:
            # Try to extract interface name
            # Match "Interface GigabitEthernet0/1" or "Interface port1.0.1" or "ge-0/0/0"
            if_match = re.search(r"interface\s+([a-zA-Z0-9\/\.\-]+)", message, re.IGNORECASE)
            if if_match:
                interface = if_match.group(1)
            else:
                # Fallback matching like "port1.0.1" or "ge-0/0/0.0"
                if_match = re.search(r"\b(port\d+\.\d+\.\d+|[a-z]{2}-\d+\/\d+\/\d+(?:\.\d+)?|[a-zA-Z]+\d+\/\d+)\b", message)
                if if_match:
                    interface = if_match.group(1)
            
            if is_link_down:
                details = f"Syslog mendeteksi port DOWN pada interface {interface}: {message}"
                
                # Check if port flapping is already active
                c.execute("""
                    SELECT id FROM network_anomalies 
                    WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
                """, (device_id, interface))
                if not c.fetchone():
                    c.execute("""
                        INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                        VALUES (?, 'port_flapping', 'warning', ?, ?, 1, ?)
                    """, (device_id, interface, details, now_iso))
                    logger.warning(f"Syslog anomaly: Link Down on {device_name}:{interface}")
            
            elif is_link_up:
                # Auto-resolve link down anomaly when link comes up!
                c.execute("""
                    UPDATE network_anomalies 
                    SET is_active = 0, resolved_at = ? 
                    WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
                """, (now_iso, device_id, interface))
                logger.info(f"Syslog anomaly resolved: Link Up on {device_name}:{interface}")
                
        # 2. STP Topology Change Detection
        # Match Cisco: %STP-6-TCN: or Allied: stp.tcn
        if "stp-6-tcn" in message.lower() or "stp.tcn" in message.lower() or ("topology change" in message.lower() and "spanning" in message.lower()):
            details = f"Syslog mendeteksi Spanning Tree Topology Change: {message}"
            
            c.execute("""
                SELECT id FROM network_anomalies 
                WHERE device_id = ? AND anomaly_type = 'stp_tcn' AND is_active = 1
            """, (device_id,))
            if not c.fetchone():
                c.execute("""
                    INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                    VALUES (?, 'stp_tcn', 'warning', 'Global', ?, 1, ?)
                """, (device_id, details, now_iso))
                logger.warning(f"Syslog anomaly: STP TCN on {device_name}")
                
        # 3. Authentication / Login Failure Detection
        # Match "AUTH_FAIL", "login failed", "authentication failed", "bad password", "%SEC-6-IA_AUTH_FAIL"
        if "auth_fail" in message.lower() or "login failed" in message.lower() or "authentication failed" in message.lower() or "bad password" in message.lower() or "sec-6-ia_auth_fail" in message.lower() or "failed password" in message.lower():
            details = f"Deteksi kegagalan login / autentikasi keamanan: {message}"
            
            c.execute("""
                SELECT id FROM network_anomalies 
                WHERE device_id = ? AND anomaly_type = 'auth_failure' AND details = ? AND is_active = 1
            """, (device_id, details))
            if not c.fetchone():
                c.execute("""
                    INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                    VALUES (?, 'auth_failure', 'critical', 'Security', ?, 1, ?)
                """, (device_id, details, now_iso))
                logger.warning(f"Syslog Security anomaly: Auth Failure on {device_name}")
                
        conn.commit()
    except Exception as e:
        logger.error(f"Error analyzing syslog for anomalies: {e}")
        conn.rollback()
    finally:
        conn.close()

class SyslogProtocol(asyncio.DatagramProtocol):
    """UDP datagram receiver protocol for Syslog Server."""
    def datagram_received(self, data: bytes, addr: tuple[str, int]):
        raw_msg = data.decode("utf-8", errors="ignore").strip()
        if not raw_msg:
            return
            
        ip = addr[0]
        device_id = resolve_device_id_by_ip(ip)
        
        # Parse log
        facility, severity, program, message, timestamp = parse_syslog_message(raw_msg)
        
        # Save to database
        conn = get_db_conn()
        c = conn.cursor()
        try:
            c.execute("""
                INSERT INTO device_syslogs (device_id, facility, severity, program, message, timestamp, raw_message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (device_id, facility, severity, program, message, timestamp, raw_msg))
            conn.commit()
        except Exception as e:
            logger.error(f"Failed to save syslog to database: {e}")
            conn.rollback()
        finally:
            conn.close()
            
        # Trigger real-time anomaly checks
        if device_id:
            analyze_syslog_for_anomalies(device_id, severity, program, message, timestamp)

async def clear_expired_syslogs():
    """Daily job that deletes logs older than 30 days."""
    conn = get_db_conn()
    c = conn.cursor()
    now = datetime.now()
    retention_cutoff = (now - timedelta(days=30)).isoformat()
    try:
        c.execute("DELETE FROM device_syslogs WHERE timestamp < ?", (retention_cutoff,))
        deleted_count = c.rowcount
        conn.commit()
        if deleted_count > 0:
            logger.info(f"Pembersihan otomatis Syslog: Berhasil menghapus {deleted_count} log yang berumur > 30 hari.")
    except Exception as e:
        logger.error(f"Gagal melakukan pembersihan berkala Syslog: {e}")
        conn.rollback()
    finally:
        conn.close()

async def run_syslog_retention_scheduler():
    """Background loop checking and deleting expired logs every 12 hours."""
    logger.info("Initializing Syslog Retention Scheduler (30-day policy)...")
    while True:
        try:
            await clear_expired_syslogs()
        except Exception as e:
            logger.error(f"Error in Syslog retention runner: {e}")
        await asyncio.sleep(43200)  # Check every 12 hours

async def start_syslog_server(port: int = 514, fallback_port: int = 5140):
    """Binds to UDP port 514 (fallback 5140) and starts the Syslog Server."""
    loop = asyncio.get_running_loop()
    
    # Try primary port
    try:
        logger.info(f"Mencoba menjalankan server Syslog UDP pada port {port}...")
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: SyslogProtocol(),
            local_addr=("0.0.0.0", port)
        )
        logger.info(f"Server Syslog UDP AKTIF dan mendengarkan pada port {port}.")
        # Launch retention scheduler in background
        asyncio.create_task(run_syslog_retention_scheduler())
        return transport
    except Exception as e:
        logger.warning(f"Gagal mengikat server Syslog ke port {port}: {e}.")
        logger.warning("Kemungkinan port sedang digunakan atau memerlukan hak akses administrator.")
        
    # Try fallback port
    try:
        logger.info(f"Mencoba mengikat ke port alternatif {fallback_port}...")
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: SyslogProtocol(),
            local_addr=("0.0.0.0", fallback_port)
        )
        logger.info(f"Server Syslog UDP AKTIF dan mendengarkan pada port {fallback_port}.")
        asyncio.create_task(run_syslog_retention_scheduler())
        return transport
    except Exception as e:
        logger.error(f"Gagal total mengikat server Syslog ke port {fallback_port}: {e}.")
        logger.error("Layanan Syslog Server tidak dapat dimulai.")
        return None
