import asyncio
import os
import logging
import redis
from dotenv import load_dotenv

# Load env file
load_dotenv()

from main_worker import worker_loop
from app.services.syslog_server import start_syslog_server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("netx.worker_launcher")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

async def run_scheduler_tick_loop(redis_client):
    from main_scheduler import schedule_check_tick, ANOMALY_INTERVAL, HISTORY_INTERVAL
    import main_scheduler
    import time
    
    logger.info("Starting Scheduler Tick Loop...")
    # Initialize scheduler variables
    current_time = time.time()
    main_scheduler.last_anomaly_scan = current_time - ANOMALY_INTERVAL + 30.0
    main_scheduler.last_history_snapshot = current_time - HISTORY_INTERVAL + 15.0
    
    while True:
        try:
            schedule_check_tick(redis_client)
        except Exception as e:
            logger.error(f"Error in scheduler tick: {e}")
        await asyncio.sleep(30)

async def main():
    logger.info("Initializing NetX Background Engine (Redis Queue + Syslog + Scheduler)...")
    r = redis.from_url(REDIS_URL)
    
    # Test Redis connectivity
    try:
        r.ping()
        logger.info("Successfully connected to Redis.")
    except Exception as e:
        logger.error(f"Failed to connect to Redis at {REDIS_URL}: {e}")
        return

    # Start the worker loop in the background
    asyncio.create_task(worker_loop())
    
    # Start the scheduler tick loop in the background
    asyncio.create_task(run_scheduler_tick_loop(r))
    
    # Start the syslog UDP server
    syslog_transport = await start_syslog_server()
    
    if syslog_transport is None:
        logger.warning("Syslog UDP Server failed to bind. Running worker and scheduler...")
        while True:
            await asyncio.sleep(3600)
    else:
        try:
            while not syslog_transport.is_closing():
                await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Worker runtime error: {e}")
        finally:
            syslog_transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Background Worker Engine stopped by user.")
