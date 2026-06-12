import asyncio
import logging
import re
import json
import hashlib
from datetime import datetime, timedelta
from app.database import get_db_conn

logger = logging.getLogger("netx.syslog_server")

def get_log_template(message: str) -> tuple[str, str]:
    """
    Groups/clusters syslog messages by replacing variables with placeholders.
    Returns (template_string, pattern_hash).
    """
    # 1. Clean timestamps or counters (e.g. "123: *Oct 11 22:14:14: ")
    msg = re.sub(r"^\d+:\s*(?:\*\w{3}\s+\d+\s+\d+:\d+:\d+(?:\.\d+)?:\s*)?", "", message)
    
    # 2. Replace IP addresses
    msg = re.sub(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", "<IP>", msg)
    
    # 3. Replace MAC addresses
    msg = re.sub(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}(?:[0-9A-Fa-f]{2})\b", "<MAC>", msg)
    msg = re.sub(r"\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b", "<MAC>", msg)
    
    # 4. Replace standard Interface names (e.g. GigabitEthernet0/1, ge-0/0/0, port1)
    msg = re.sub(r"\b(?:[a-zA-Z]{2,15}\d+(?:\/\d+)+(?:\.\d+)?|port\d+(?:\.\d+)*)\b", "<IF>", msg)
    
    # 5. Replace hex numbers
    msg = re.sub(r"\b0x[0-9a-fA-F]+\b", "<HEX>", msg)
    
    # 6. Replace integers
    msg = re.sub(r"\b\d+\b", "<NUM>", msg)
    
    template = msg.strip()
    pattern_hash = hashlib.md5(template.encode("utf-8", errors="ignore")).hexdigest()
    
    return template, pattern_hash


# Cache mapping sender IP / hostname -> device info
# None represents unregistered devices
IP_TO_DEVICE_CACHE = {}
HOSTNAME_TO_DEVICE_CACHE = {}
CACHE_LAST_CLEARED = datetime.now()

def clear_ip_cache():
    """Clears the IP-to-device and hostname mapping cache to pick up updates."""
    global IP_TO_DEVICE_CACHE, HOSTNAME_TO_DEVICE_CACHE, CACHE_LAST_CLEARED
    IP_TO_DEVICE_CACHE.clear()
    HOSTNAME_TO_DEVICE_CACHE.clear()
    CACHE_LAST_CLEARED = datetime.now()
    logger.debug("IP and Hostname to Device cache cleared.")

def resolve_device(ip: str, hostname: str | None) -> tuple[int | None, str]:
    """
    Resolves device_id and actual device IP by comparing with both socket IP and parsed hostname.
    Returns (device_id, ip_to_log)
    """
    global IP_TO_DEVICE_CACHE, HOSTNAME_TO_DEVICE_CACHE, CACHE_LAST_CLEARED
    
    # Auto-expire cache after 30 seconds
    if datetime.now() - CACHE_LAST_CLEARED > timedelta(seconds=30):
        clear_ip_cache()
        
    # 1. Search by hostname in devices name/ip/syslog_hostname first
    if hostname and hostname != "-":
        if hostname in HOSTNAME_TO_DEVICE_CACHE:
            return HOSTNAME_TO_DEVICE_CACHE[hostname]
            
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT id, ip FROM devices WHERE name = ? OR ip = ? OR syslog_hostname = ?", (hostname, hostname, hostname))
        row = c.fetchone()
        conn.close()
        
        if row:
            res = (row["id"], row["ip"])
            HOSTNAME_TO_DEVICE_CACHE[hostname] = res
            return res
        else:
            HOSTNAME_TO_DEVICE_CACHE[hostname] = (None, ip)

    # 2. Lookup by socket sender IP
    if ip:
        if ip in IP_TO_DEVICE_CACHE:
            device_id = IP_TO_DEVICE_CACHE[ip]
            return device_id, ip
            
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT id FROM devices WHERE ip = ?", (ip,))
        row = c.fetchone()
        conn.close()
        
        device_id = row["id"] if row else None
        IP_TO_DEVICE_CACHE[ip] = device_id
        return device_id, ip

    return None, ip

def parse_syslog_message(raw_msg: str) -> tuple[int, int, str, str, str, str | None]:
    """
    Parses a raw syslog message.
    Returns (facility, severity, program, message, timestamp, hostname)
    """
    facility = 1  # user-level messages default
    severity = 5  # notice default
    program = "syslog"
    message = raw_msg
    timestamp = datetime.now().isoformat()
    hostname = None
    
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
            
    # Check if the message matches RFC 5424 format:
    # VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA [MSG]
    rfc5424_match = re.match(
        r"^([1-9]\d*)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(-|(?:\[.+?\])+)(?:\s+(.*))?$",
        message
    )
    if rfc5424_match:
        ts_str = rfc5424_match.group(2)
        host_str = rfc5424_match.group(3)
        app_name = rfc5424_match.group(4)
        msg_body = rfc5424_match.group(8) or ""
        
        if host_str != "-":
            hostname = host_str
            
        if app_name != "-":
            program = app_name
            
        if ts_str != "-":
            try:
                datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                timestamp = ts_str
            except ValueError:
                pass
        message = msg_body
    else:
        # Check if the message matches RFC 3164 (legacy) with a hostname, e.g. "Jun  7 22:23:32 AT48-LT-9A dhclient: ..."
        # BSD timestamp typically looks like "Mmm dd hh:mm:ss" or "yyyy Mmm dd hh:mm:ss"
        rfc3164_match = re.match(
            r"^(?:\d{4}\s+)?(?:[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$",
            message
        )
        if rfc3164_match:
            host_str = rfc3164_match.group(1)
            msg_body = rfc3164_match.group(2)
            
            if host_str != "-":
                hostname = host_str
            message = msg_body

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
                
    return facility, severity, program, message, timestamp, hostname

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

def save_and_analyze_syslog_db(device_id, ip, facility, severity, program, message, timestamp, raw_msg, template, pattern_hash) -> bool:
    """
    Saves syslog message, updates patterns, performs spike and critical pattern detection.
    Returns True if the log was processed and NOT blocked, False if blocked.
    """
    conn = get_db_conn()
    c = conn.cursor()
    try:
        # Check if pattern is blocked or anomaly
        c.execute("SELECT is_blocked, is_anomaly FROM syslog_patterns WHERE pattern_hash = ?", (pattern_hash,))
        p_row = c.fetchone()
        
        is_blocked = 0
        is_anomaly = 0
        if p_row:
            is_blocked = p_row["is_blocked"]
            is_anomaly = p_row["is_anomaly"]
        else:
            # Register new pattern
            c.execute("""
                INSERT INTO syslog_patterns (pattern_hash, template, program, severity, is_blocked, is_anomaly, created_at)
                VALUES (?, ?, ?, ?, 0, 0, ?)
                ON CONFLICT (pattern_hash) DO NOTHING
            """, (pattern_hash, template, program, severity, timestamp))
            
        if is_blocked == 1:
            conn.commit()
            return False
            
        # Save syslog with pattern_hash
        c.execute("""
            INSERT INTO device_syslogs (device_id, sender_ip, facility, severity, program, message, timestamp, raw_message, pattern_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (device_id, ip, facility, severity, program, message, timestamp, raw_msg, pattern_hash))
        
        # Spike Detection: count same pattern in last 5 minutes
        if device_id:
            five_mins_ago = (datetime.fromisoformat(timestamp) - timedelta(minutes=5)).isoformat()
            c.execute("""
                SELECT COUNT(*) as cnt 
                FROM device_syslogs 
                WHERE pattern_hash = ? AND device_id = ? AND timestamp >= ?
            """, (pattern_hash, device_id, five_mins_ago))
            cnt_row = c.fetchone()
            recent_count = cnt_row["cnt"] if cnt_row else 0
            
            if recent_count >= 50:
                # Check if there is already an active syslog_spike anomaly for this device and pattern
                c.execute("""
                    SELECT id FROM network_anomalies 
                    WHERE device_id = ? AND anomaly_type = 'syslog_spike' AND details LIKE ? AND is_active = 1
                """, (device_id, f"%{pattern_hash}%"))
                if not c.fetchone():
                    details = f"Lonjakan log terdeteksi untuk pola [{pattern_hash}]. Diterima {recent_count} log dalam 5 menit terakhir. Contoh pesan: {message[:180]}"
                    c.execute("""
                        INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                        VALUES (?, 'syslog_spike', 'warning', 'Syslog', ?, 1, ?)
                    """, (device_id, details, timestamp))
                    
            if is_anomaly == 1:
                # Check if there is already an active syslog_critical anomaly for this device and pattern
                c.execute("""
                    SELECT id FROM network_anomalies 
                    WHERE device_id = ? AND anomaly_type = 'syslog_critical' AND details LIKE ? AND is_active = 1
                """, (device_id, f"%{pattern_hash}%"))
                if not c.fetchone():
                    details = f"Log kritis terdeteksi (pola ditandai sebagai anomali) [{pattern_hash}]: {message[:180]}"
                    c.execute("""
                        INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                        VALUES (?, 'syslog_critical', 'critical', 'Syslog', ?, 1, ?)
                    """, (device_id, details, timestamp))
                    
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error in save_and_analyze_syslog_db: {e}")
        conn.rollback()
        return True
    finally:
        conn.close()

class SyslogProtocol(asyncio.DatagramProtocol):
    """UDP datagram receiver protocol for Syslog Server."""
    def datagram_received(self, data: bytes, addr: tuple[str, int]):
        raw_msg = data.decode("utf-8", errors="ignore").strip()
        if not raw_msg:
            return
            
        asyncio.create_task(self.process_datagram(raw_msg, addr[0]))

    async def process_datagram(self, raw_msg: str, ip: str):
        try:
            loop = asyncio.get_running_loop()
            
            # Parse log first to get hostname
            facility, severity, program, message, timestamp, hostname = parse_syslog_message(raw_msg)
            
            # Resolve device_id and actual ip in a background thread to avoid blocking the event loop
            device_id, actual_ip = await loop.run_in_executor(None, resolve_device, ip, hostname)
            
            # Get template and hash
            template, pattern_hash = get_log_template(message)
            
            # Save and analyze in background thread (using actual_ip instead of socket ip)
            not_blocked = await loop.run_in_executor(
                None,
                save_and_analyze_syslog_db,
                device_id, actual_ip, facility, severity, program, message, timestamp, raw_msg, template, pattern_hash
            )
            
            # Trigger real-time anomaly checks only if not blocked and device_id is valid
            if not_blocked and device_id:
                await loop.run_in_executor(
                    None, 
                    analyze_syslog_for_anomalies, 
                    device_id, 
                    severity, 
                    program, 
                    message, 
                    timestamp
                )
        except Exception as e:
            logger.error(f"Error processing syslog datagram asynchronously: {e}")

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

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] syslog_daemon: %(message)s")
    
    async def run_daemon():
        # Bind to standard syslog port (514) first
        transport = await start_syslog_server()
        if transport:
            try:
                while not transport.is_closing():
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                pass
            finally:
                transport.close()
                
    try:
        asyncio.run(run_daemon())
    except KeyboardInterrupt:
        logger.info("Syslog daemon stopped by user.")
