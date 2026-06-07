import asyncio
import logging
import difflib
from datetime import datetime, timedelta
from app.database import get_db_conn, get_device_credentials
from app.services.connector import connect_and_run

logger = logging.getLogger("netx.device_backup_service")


# ─── CONFIGURATION COMMANDS PER DEVICE TYPE ─────────────────────────────────
CONFIG_COMMANDS = {
    "cisco_ios":        "show running-config",
    "cisco_xe":         "show running-config",
    "cisco_nxos":       "show running-config",
    "cisco_asa":        "show running-config",
    "mikrotik_routeros":"export",
    "juniper_junos":    "show configuration | display set",
    "hp_procurve":      "show running-config",
    "hp_comware":       "display current-configuration",
    "ruckus_fastiron":  "show running-config",
    "huawei":           "display current-configuration",
    "fortinet":         "show",
    "aruba_os":         "show running-config",
    "extreme_exos":     "show configuration",
    "dell_os10":        "show running-configuration",
    "paloalto_panos":   "show config running",
    "allied_telesis":   "show running-config",
    "vyos":             "show configuration",
    "ruijie_os":        "show running-config",
}


def calculate_next_run(frequency: str, time_str: str = "", day_of_week: int = 0) -> datetime:
    """
    Calculates the next run datetime based on frequency, time_str (HH:MM), and day_of_week (0-6).
    """
    now = datetime.now()
    if frequency == "hourly":
        return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)

    try:
        hour, minute = map(int, time_str.split(":"))
    except Exception:
        hour, minute = 0, 0

    if frequency == "daily":
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target

    if frequency == "weekly":
        # day_of_week: 0=Monday, 6=Sunday
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        # Shift days until we match the day of week and it is in the future
        while target <= now or target.weekday() != day_of_week:
            target += timedelta(days=1)
        return target

    # Fallback to daily
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


async def backup_device_config(device_id: int, only_if_changed: bool = False, user_id: int = 1, username: str = "system") -> dict:
    """
    Connects to the network device, fetches the configuration via the vendor's command,
    and stores it in the database under a new version number.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return {"success": False, "error": "Perangkat tidak ditemukan."}

    device = dict(row)
    conn.close()

    # Check device type support
    device_type = device.get("device_type", "")
    if device_type not in CONFIG_COMMANDS:
        return {"success": False, "error": f"Tipe perangkat '{device_type}' tidak didukung untuk backup konfigurasi."}

    username_cred, password = get_device_credentials(device)
    device["username"] = username_cred

    now = datetime.now().isoformat()

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT MAX(version) as max_v FROM device_config_backups WHERE device_id = ? AND status = 'success'", (device_id,))
    max_row = c.fetchone()
    next_version = (max_row["max_v"] or 0) + 1

    try:
        # Run command via Netmiko connector
        command = CONFIG_COMMANDS[device_type]
        output = await connect_and_run(device, password, command)

        if output.startswith("ERROR:"):
            raise Exception(output)

        # Check for changes if requested
        if only_if_changed:
            c.execute("""
                SELECT config_content FROM device_config_backups 
                WHERE device_id = ? AND status = 'success' 
                ORDER BY version DESC LIMIT 1
            """, (device_id,))
            last_row = c.fetchone()
            if last_row and last_row["config_content"] == output:
                logger.info(f"Device {device_id} configuration has not changed. Skipping backup.")
                
                # Log audit
                from app.services.audit import log_audit
                log_audit(user_id, username, "DEVICE_BACKUP_SKIPPED", f"device_backups/{device_id}", 
                          f"Backup konfigurasi untuk {device['name']} dilewati karena tidak ada perubahan.")
                          
                return {"success": True, "skipped": True, "message": "Tidak ada perubahan konfigurasi."}

        # Save successful backup
        c.execute("""
            INSERT INTO device_config_backups (device_id, config_content, version, status, created_at)
            VALUES (?, ?, ?, 'success', ?)
        """, (device_id, output, next_version, now))
        conn.commit()

        # Log audit
        from app.services.audit import log_audit
        log_audit(user_id, username, "DEVICE_BACKUP_SUCCESS", f"device_backups/{device_id}", 
                  f"Backup konfigurasi {device_type} untuk {device['name']} versi {next_version} berhasil.")

        return {"success": True, "version": next_version}
    except Exception as e:
        error_msg = str(e)
        # Save failed backup log
        c.execute("""
            INSERT INTO device_config_backups (device_id, config_content, version, status, error_message, created_at)
            VALUES (?, '', 0, 'failed', ?, ?)
        """, (device_id, error_msg, now))
        conn.commit()

        from app.services.audit import log_audit
        log_audit(user_id, username, "DEVICE_BACKUP_FAILED", f"device_backups/{device_id}", 
                  f"Backup konfigurasi {device_type} untuk {device['name']} GAGAL: {error_msg}")

        return {"success": False, "error": error_msg}
    finally:
        conn.close()


def compare_backups(config1: str, config2: str, from_desc: str = "Versi A", to_desc: str = "Versi B") -> list[dict]:
    """
    Compares two configurations and returns a list of diff lines with status.
    Each line will have:
      - text: the line content
      - type: 'added', 'removed', 'unchanged', 'header'
    """
    diff = difflib.unified_diff(
        config1.splitlines(),
        config2.splitlines(),
        fromfile=from_desc,
        tofile=to_desc,
        lineterm=""
    )

    result = []
    for line in diff:
        if line.startswith("+++") or line.startswith("---"):
            result.append({"text": line, "type": "header"})
        elif line.startswith("+"):
            result.append({"text": line, "type": "added"})
        elif line.startswith("-"):
            result.append({"text": line, "type": "removed"})
        elif line.startswith("@@"):
            result.append({"text": line, "type": "header"})
        else:
            result.append({"text": line, "type": "unchanged"})

    return result


async def execute_schedule_backups(schedule: dict):
    """
    Retrieves devices targeted by the schedule and runs backups for them.
    """
    device_target = schedule["device_ids"]

    conn = get_db_conn()
    c = conn.cursor()
    if device_target == "all":
        supported_types = list(CONFIG_COMMANDS.keys())
        placeholders = ",".join("?" for _ in supported_types)
        c.execute(f"SELECT id FROM devices WHERE device_type IN ({placeholders})", supported_types)
        device_ids = [row["id"] for row in c.fetchall()]
    else:
        try:
            device_ids = [int(x.strip()) for x in device_target.split(",") if x.strip()]
        except Exception:
            device_ids = []
    conn.close()

    logger.info(f"Schedule '{schedule['name']}' backing up devices: {device_ids}")

    for dev_id in device_ids:
        try:
            await backup_device_config(dev_id, only_if_changed=True)
        except Exception as e:
            logger.error(f"Error running scheduled backup for device {dev_id}: {e}")
        # brief sleep between devices to avoid overloading
        await asyncio.sleep(1.0)


async def run_scheduler_tick():
    """
    Evaluates backup schedules and triggers backups if their scheduled time has arrived.
    """
    now = datetime.now()
    now_str = now.isoformat()

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_backup_schedules WHERE is_active = 1")
    schedules = [dict(row) for row in c.fetchall()]
    conn.close()

    for schedule in schedules:
        try:
            next_run_dt = datetime.fromisoformat(schedule["next_run"])
        except Exception:
            # If invalid next_run format, recalculate immediately
            next_run_dt = now - timedelta(seconds=1)

        if now >= next_run_dt:
            logger.info(f"Running device backup schedule: {schedule['name']}")

            # Calculate the next occurrence
            next_run_next = calculate_next_run(
                schedule["frequency"],
                schedule["time"],
                schedule["day_of_week"]
            )

            conn = get_db_conn()
            c = conn.cursor()
            c.execute("""
                UPDATE device_backup_schedules
                SET last_run = ?, next_run = ?
                WHERE id = ?
            """, (now_str, next_run_next.isoformat(), schedule["id"]))
            conn.commit()
            conn.close()

            # Execute schedule task asynchronously
            asyncio.create_task(execute_schedule_backups(schedule))


async def start_device_backup_scheduler():
    """
    Scheduler loop that ticks every 60 seconds.
    """
    logger.info("Starting Device Configuration Backup Scheduler Loop...")
    while True:
        try:
            await run_scheduler_tick()
        except Exception as e:
            logger.error(f"Error in device backup scheduler tick: {e}")
        await asyncio.sleep(60)
