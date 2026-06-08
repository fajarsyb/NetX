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

# Track periodic schedule timestamps
last_anomaly_scan = 0.0
last_history_snapshot = 0.0

# Initial delays (seconds) to let worker/server start smoothly
ANOMALY_INTERVAL = 300.0  # 5 minutes
HISTORY_INTERVAL = 600.0  # 10 minutes

def schedule_check_tick(redis_client: redis.Redis):
    global last_anomaly_scan, last_history_snapshot
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
        
    conn.close()

    # 2. Check Anomaly Scan Interval
    if current_time - last_anomaly_scan >= ANOMALY_INTERVAL:
        logger.info("Triggering network anomaly scan task...")
        job_payload = {
            "job_id": f"sched_anomaly_{int(current_time)}",
            "task_name": "anomaly_scan",
            "params": {},
            "created_at": now_str,
            "retries": 0,
            "max_retries": 1
        }
        redis_client.lpush("queue:default", json.dumps(job_payload))
        last_anomaly_scan = current_time

    # 3. Check Network History Snapshot Interval
    if current_time - last_history_snapshot >= HISTORY_INTERVAL:
        logger.info("Triggering network history snapshot task...")
        job_payload = {
            "job_id": f"sched_history_{int(current_time)}",
            "task_name": "network_history_snapshot",
            "params": {},
            "created_at": now_str,
            "retries": 0,
            "max_retries": 1
        }
        redis_client.lpush("queue:low", json.dumps(job_payload))
        last_history_snapshot = current_time

def main():
    global last_anomaly_scan, last_history_snapshot
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
    last_anomaly_scan = current_time - ANOMALY_INTERVAL + 30.0  # run scan in 30 seconds
    last_history_snapshot = current_time - HISTORY_INTERVAL + 15.0  # run snapshot in 15 seconds

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
