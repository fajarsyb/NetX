import json
import asyncio
import logging
from datetime import datetime
from app.database import get_db_conn, decrypt_password
from app.services.connector import test_connection, TELNET_CAPABLE

logger = logging.getLogger("netx.credential_scanner")

DEFAULT_CREDENTIALS = [
    {"username": "manager", "password": "friend", "label": "Allied Telesis Default (manager/friend)"},
    {"username": "manager", "password": "manager", "label": "Allied Telesis Default (manager/manager)"},
    {"username": "admin", "password": "admin", "label": "Generic/Ruijie Default (admin/admin)"},
    {"username": "operator", "password": "operator", "label": "Generic Default (operator/operator)"},
    {"username": "ruijie", "password": "ruijie", "label": "Ruijie Default (ruijie/ruijie)"},
    {"username": "admin", "password": "ruijie", "label": "Ruijie Default (admin/ruijie)"},
    {"username": "super", "password": "super", "label": "Ruijie Default (super/super)"},
    {"username": "cisco", "password": "cisco", "label": "Cisco Default (cisco/cisco)"},
    {"username": "admin", "password": "", "label": "Empty Password (admin/)"},
    {"username": "admin", "password": "password", "label": "Generic Default (admin/password)"},
    {"username": "admin", "password": "admin123", "label": "Generic Default (admin/admin123)"},
    {"username": "root", "password": "root", "label": "Linux/Generic Default (root/root)"},
    {"username": "root", "password": "password", "label": "Linux/Generic Default (root/password)"},
    {"username": "root", "password": "", "label": "Linux/Generic Default (root/)"},
]

def _try_login_sync(device, username, password) -> tuple[bool, str]:
    try:
        from netmiko import ConnectHandler
        from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException
    except ImportError:
        return False, "netmiko_not_installed"

    device_type = device["device_type"]
    if device_type == "allied_telesis":
        device_type = "allied_telesis_awplus"

    protocol = device.get("protocol", "ssh").lower()
    if protocol == "telnet" and device_type in TELNET_CAPABLE:
        device_type = device_type + "_telnet"

    default_port = 23 if protocol == "telnet" else 22
    
    nm_device = {
        "device_type":   device_type,
        "host":          device["ip"],
        "username":      username,
        "password":      password,
        "port":          device.get("port") or default_port,
        "timeout":       5,        # Short timeout for scanning
        "auth_timeout":  5,
        "conn_timeout":  5,
        "fast_cli":      False,
    }
    
    try:
        with ConnectHandler(**nm_device) as conn:
            return True, "success"
    except (NetmikoAuthenticationException, ValueError) as e:
        return False, "auth_failed"
    except Exception as e:
        err_str = str(e).lower()
        if "auth" in err_str or "login" in err_str or "credentials" in err_str:
            return False, "auth_failed"
        return False, "unreachable"

async def test_credential_login(device, username, password) -> tuple[bool, str]:
    """Test login asynchronously in a thread pool."""
    return await asyncio.to_thread(_try_login_sync, device, username, password)

async def scan_single_device(device, db_templates, sem):
    async with sem:
        results = {
            "device_id": device["id"],
            "device_name": device["name"],
            "device_ip": device["ip"],
            "device_type": device["device_type"],
            "protocol": device["protocol"],
            "status": "secure",
            "working_defaults": [],
            "working_db_templates": [],
            "scanned_at": datetime.now().isoformat(),
            "error_message": None
        }

        # Determine assigned credentials
        assigned_user = device.get("username", "")
        assigned_pass = ""
        if device.get("password"):
            assigned_pass = decrypt_password(device["password"])
        elif device.get("credential_id"):
            matching = [t for t in db_templates if t["id"] == device["credential_id"]]
            if matching:
                assigned_user = matching[0]["username"]
                assigned_pass = matching[0]["password"]

        # 1. Base check with assigned credential (or fallback dummy test to verify reachability)
        if assigned_user:
            success, reason = await test_credential_login(device, assigned_user, assigned_pass)
        else:
            success, reason = await test_credential_login(device, "admin", "admin")
            if success:
                reason = "success"
                success = False
            elif reason == "auth_failed":
                success = False
            else:
                success = False
                reason = "unreachable"

        if not success and reason == "unreachable":
            results["status"] = "unreachable"
            results["error_message"] = "Perangkat tidak merespons (unreachable/port tertutup)."
            return results

        tested_pairs = set()
        # Add assigned to tested pairs to avoid scanning it again if it exists
        if assigned_user:
            tested_pairs.add((assigned_user, assigned_pass))

        # 2. Test other templates in db
        templates_succeeded = []
        for t in db_templates:
            user = t["username"]
            pw = t["password"]
            pair = (user, pw)
            if pair in tested_pairs:
                continue
            tested_pairs.add(pair)

            success_db, _ = await test_credential_login(device, user, pw)
            if success_db:
                templates_succeeded.append(t["name"])

        # 3. Test default passwords
        defaults_succeeded = []
        for d in DEFAULT_CREDENTIALS:
            user = d["username"]
            pw = d["password"]
            pair = (user, pw)
            if pair in tested_pairs:
                continue
            tested_pairs.add(pair)

            success_def, _ = await test_credential_login(device, user, pw)
            if success_def:
                defaults_succeeded.append(d["label"])

        # 4. Final status determination
        if len(defaults_succeeded) > 0:
            results["status"] = "vulnerable"
            results["working_defaults"] = defaults_succeeded
            results["working_db_templates"] = templates_succeeded
        elif len(templates_succeeded) > 0:
            results["status"] = "weak"
            results["working_db_templates"] = templates_succeeded
        elif not success and reason == "auth_failed" and assigned_user:
            results["status"] = "unreachable"
            results["error_message"] = "Gagal autentikasi menggunakan kredensial terdaftar."
        else:
            results["status"] = "secure"

        return results

async def run_credential_scan(device_ids=None, credential_ids=None):
    """Run credential security scan on devices and save to DB."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # 1. Fetch credentials templates
    if credential_ids:
        placeholders = ",".join(["?"] * len(credential_ids))
        c.execute(f"SELECT id, name, username, password FROM device_credentials WHERE id IN ({placeholders})", tuple(credential_ids))
    else:
        c.execute("SELECT id, name, username, password FROM device_credentials")
        
    db_templates = []
    for row in c.fetchall():
        db_templates.append({
            "id": row["id"],
            "name": row["name"],
            "username": row["username"],
            "password": decrypt_password(row["password"])
        })
        
    # 2. Fetch devices to scan
    if device_ids:
        placeholders = ",".join(["?"] * len(device_ids))
        query = f"SELECT id, name, ip, protocol, port, username, password, device_type, credential_id FROM devices WHERE id IN ({placeholders})"
        c.execute(query, tuple(device_ids))
    else:
        c.execute("SELECT id, name, ip, protocol, port, username, password, device_type, credential_id FROM devices")
        
    devices = [dict(r) for r in c.fetchall()]
    conn.close()
    
    if not devices:
        return []
        
    sem = asyncio.Semaphore(5)
    
    tasks = [scan_single_device(d, db_templates, sem) for d in devices]
    scan_results = await asyncio.gather(*tasks)
    
    # 3. Store results in the database
    conn = get_db_conn()
    c = conn.cursor()
    for r in scan_results:
        c.execute("DELETE FROM device_credential_compliance WHERE device_id = ?", (r["device_id"],))
        c.execute(
            """
            INSERT INTO device_credential_compliance 
            (device_id, status, working_defaults, working_db_templates, scanned_at, error_message) 
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                r["device_id"],
                r["status"],
                json.dumps(r["working_defaults"]),
                json.dumps(r["working_db_templates"]),
                r["scanned_at"],
                r["error_message"] or ""
            )
        )
    conn.commit()
    conn.close()
    
    return scan_results

def get_compliance_records():
    """Retrieve compliance records from DB."""
    conn = get_db_conn()
    c = conn.cursor()
    query = """
        SELECT c.device_id, d.name as device_name, d.ip as device_ip, d.device_type, d.protocol,
               c.status, c.working_defaults, c.working_db_templates, c.scanned_at, c.error_message
        FROM device_credential_compliance c
        JOIN devices d ON c.device_id = d.id
        ORDER BY d.name COLLATE NOCASE
    """
    c.execute(query)
    records = []
    for r in c.fetchall():
        records.append({
            "device_id": r["device_id"],
            "device_name": r["device_name"],
            "device_ip": r["device_ip"],
            "device_type": r["device_type"],
            "protocol": r["protocol"],
            "status": r["status"],
            "working_defaults": json.loads(r["working_defaults"] or "[]"),
            "working_db_templates": json.loads(r["working_db_templates"] or "[]"),
            "scanned_at": r["scanned_at"],
            "error_message": r["error_message"]
        })
    conn.close()
    return records


async def scan_custom_target(ip: str, protocol: str, port: int | None, device_type: str, username: str | None = None, password: str | None = None, credential_id: int | None = None):
    """Scan a custom target (not registered in database devices)."""
    # 1. Fetch credentials templates
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, username, password FROM device_credentials")
    db_templates = []
    for row in c.fetchall():
        db_templates.append({
            "id": row["id"],
            "name": row["name"],
            "username": row["username"],
            "password": decrypt_password(row["password"])
        })
    
    # 2. Determine if a specific credential is selected
    assigned_user = ""
    assigned_pass = ""
    if username is not None:
        assigned_user = username
        assigned_pass = password or ""
    elif credential_id is not None:
        matching = [t for t in db_templates if t["id"] == credential_id]
        if matching:
            assigned_user = matching[0]["username"]
            assigned_pass = matching[0]["password"]
            
    conn.close()
    
    # 3. Build temporary device dictionary
    device = {
        "id": 0,
        "name": f"Custom Target ({ip})",
        "ip": ip,
        "protocol": protocol,
        "port": port,
        "device_type": device_type,
        "username": assigned_user,
        "password": encrypt_password(assigned_pass) if assigned_pass else ""
    }
    
    # 4. Scan without semaphore restrictions
    sem = asyncio.Semaphore(1)
    result = await scan_single_device(device, db_templates, sem)
    return result

