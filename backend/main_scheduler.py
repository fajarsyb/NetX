import os
import sys
import time
import json
import logging
from datetime import datetime, timedelta
import redis
from dotenv import load_dotenv

# Load env file
load_dotenv()

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import get_db_conn
from app.services.device_backup_service import calculate_next_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] scheduler: %(message)s",
)
logger = logging.getLogger("netx.scheduler")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Track periodic schedule timestamps dynamically
last_run_times = {}

def schedule_check_tick(redis_client: redis.Redis):
    now = datetime.now()
    now_str = now.isoformat()
    current_time = time.time()
    
    conn = get_db_conn()
    c = conn.cursor()
    
    # 1. Check Device Backup Schedules
    try:
        c.execute("SELECT * FROM device_backup_schedules WHERE is_active = 1")
        schedules = [dict(row) for row in c.fetchall()]
        
        for schedule in schedules:
            try:
                next_run_dt = datetime.fromisoformat(schedule["next_run"])
            except Exception:
                next_run_dt = now - timedelta(seconds=1)
                
            if now >= next_run_dt:
                logger.info(f"Triggering scheduled backup: {schedule['name']}")
                next_run_next = calculate_next_run(schedule["frequency"], schedule["time"], schedule["day_of_week"])
                
                c.execute("""
                     UPDATE device_backup_schedules SET last_run = ?, next_run = ? WHERE id = ?
                """, (now_str, next_run_next.isoformat(), schedule["id"]))
                conn.commit()
                
                # Enqueue backup schedule task parameters for the worker
                job_payload = {
                    "job_id": f"sched_bk_{schedule['id']}_{int(current_time)}",
                    "task_name": "device_backup_schedule",
                    "params": {
                        "schedule_id": schedule["id"],
                        "device_ids": schedule["device_ids"]
                    },
                    "created_at": now_str,
                    "retries": 0,
                    "max_retries": 1
                }
                redis_client.lpush("queue:default", json.dumps(job_payload))
    except Exception as e:
        logger.error(f"Error checking backup schedules: {e}")
        
    # Load system settings dynamically
    system_settings = {
        "ping_auto_refresh_enabled": "true",
        "ping_auto_refresh_interval": "300",
        "mac_auto_refresh_enabled": "true",
        "mac_auto_refresh_interval": "3600",
        "arp_auto_refresh_enabled": "true",
        "arp_auto_refresh_interval": "600",
    }
    try:
        c.execute("SELECT key, value FROM system_settings")
        for row in c.fetchall():
            system_settings[row["key"]] = row["value"]
    except Exception as e:
        logger.error(f"Error loading system settings in scheduler check: {e}")
        
    conn.close()

    # 2. Check Plugin-registered Scheduled Tasks
    from app.core.plugins import plugin_manager
    for task_def in plugin_manager.get_scheduled_tasks():
        task_name = task_def["task_name"]
        interval = task_def["interval"]
        queue = task_def.get("queue", "default")
        
        last_run = last_run_times.get(task_name, 0.0)
        if current_time - last_run >= interval:
            logger.info(f"Triggering scheduled plugin task: {task_name}...")
            job_payload = {
                "job_id": f"sched_{task_name}_{int(current_time)}",
                "task_name": task_name,
                "params": {},
                "created_at": now_str,
                "retries": 0,
                "max_retries": 1
            }
            redis_client.lpush(f"queue:{queue}", json.dumps(job_payload))
            last_run_times[task_name] = current_time

    # 3. Check Core Scheduled Tasks (Ping, MAC, ARP)
    # Ping
    ping_enabled = system_settings.get("ping_auto_refresh_enabled", "true") == "true"
    ping_interval = float(system_settings.get("ping_auto_refresh_interval", "300"))
    if ping_enabled and ping_interval > 0:
        last_ping = last_run_times.get("ping_all_devices", 0.0)
        if current_time - last_ping >= ping_interval:
            logger.info("Triggering scheduled task: ping_all_devices...")
            job_payload = {
                "job_id": f"sched_ping_{int(current_time)}",
                "task_name": "ping_all_devices",
                "params": {},
                "created_at": now_str,
                "retries": 0,
                "max_retries": 1
            }
            redis_client.lpush("queue:default", json.dumps(job_payload))
            last_run_times["ping_all_devices"] = current_time

    # MAC Table
    mac_enabled = system_settings.get("mac_auto_refresh_enabled", "true") == "true"
    mac_interval = float(system_settings.get("mac_auto_refresh_interval", "3600"))
    if mac_enabled and mac_interval > 0:
        last_mac = last_run_times.get("mac_all_devices", 0.0)
        if current_time - last_mac >= mac_interval:
            logger.info("Triggering scheduled task: mac_all_devices...")
            job_payload = {
                "job_id": f"sched_mac_{int(current_time)}",
                "task_name": "mac_all_devices",
                "params": {},
                "created_at": now_str,
                "retries": 0,
                "max_retries": 1
            }
            redis_client.lpush("queue:default", json.dumps(job_payload))
            last_run_times["mac_all_devices"] = current_time

    # ARP Table
    arp_enabled = system_settings.get("arp_auto_refresh_enabled", "true") == "true"
    arp_interval = float(system_settings.get("arp_auto_refresh_interval", "600"))
    if arp_enabled and arp_interval > 0:
        last_arp = last_run_times.get("arp_all_devices", 0.0)
        if current_time - last_arp >= arp_interval:
            logger.info("Triggering scheduled task: arp_all_devices...")
            job_payload = {
                "job_id": f"sched_arp_{int(current_time)}",
                "task_name": "arp_all_devices",
                "params": {},
                "created_at": now_str,
                "retries": 0,
                "max_retries": 1
            }
            redis_client.lpush("queue:default", json.dumps(job_payload))
            last_run_times["arp_all_devices"] = current_time


def main():
    logger.info("Initializing Network Scheduler Daemon...")
    r = redis.from_url(REDIS_URL)
    
    # Ping Redis on startup
    try:
        r.ping()
        logger.info("Successfully connected to Redis.")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        sys.exit(1)
        
    # Seed timers to delay initial run after startup if needed
    current_time = time.time()
    from app.core.plugins import plugin_manager
    for task_def in plugin_manager.get_scheduled_tasks():
        task_name = task_def["task_name"]
        interval = task_def["interval"]
        # Seed to delay the first run slightly (30 seconds)
        last_run_times[task_name] = current_time - interval + 30.0

    # Delay the first auto-ping slightly (15 seconds after start) to avoid startup contention
    last_run_times["ping_all_devices"] = current_time - 300.0 + 15.0
    last_run_times["mac_all_devices"] = current_time - 3600.0 + 45.0
    last_run_times["arp_all_devices"] = current_time - 600.0 + 30.0

    while True:
        try:
            schedule_check_tick(r)
        except Exception as e:
            logger.error(f"Error in scheduler tick: {e}")
        time.sleep(30)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Scheduler process terminated by user.")
