import asyncio
import os
import logging
import redis
import redis.asyncio as aioredis
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

async def run_scheduler_tick_loop(redis_client_sync):
    from main_scheduler import schedule_check_tick
    import main_scheduler
    import time
    
    logger.info("Starting Scheduler Tick Loop...")
    # Seed timers to delay initial run after startup if needed
    current_time = time.time()
    from app.core.plugins import plugin_manager
    for task_def in plugin_manager.get_scheduled_tasks():
        task_name = task_def["task_name"]
        interval = task_def["interval"]
        main_scheduler.last_run_times[task_name] = current_time - interval + 30.0
        
    while True:
        try:
            # Run blocking database and sync redis calls in a thread pool to avoid event loop lag
            await asyncio.to_thread(schedule_check_tick, redis_client_sync)
        except Exception as e:
            logger.error(f"Error in scheduler tick: {e}")
        await asyncio.sleep(30)

async def main():
    mode = os.environ.get("NETX_MODE", "all").lower()
    logger.info(f"Initializing NetX Background Engine (Mode: {mode})...")
    
    r_sync = None
    r_async = None
    
    # Check connections based on mode
    if mode in ("all", "scheduler"):
        r_sync = redis.from_url(REDIS_URL)
        try:
            r_sync.ping()
            logger.info("Successfully connected to Redis (sync).")
        except Exception as e:
            logger.error(f"Failed to connect to Redis (sync) at {REDIS_URL}: {e}")
            return

    if mode in ("all", "worker"):
        r_async = aioredis.from_url(REDIS_URL)
        try:
            await r_async.ping()
            logger.info("Successfully connected to Redis (async).")
        except Exception as e:
            logger.error(f"Failed to connect to Redis (async) at {REDIS_URL}: {e}")
            return

    tasks = []
    
    if mode in ("all", "worker"):
        tasks.append(asyncio.create_task(worker_loop()))
        
    if mode in ("all", "scheduler"):
        tasks.append(asyncio.create_task(run_scheduler_tick_loop(r_sync)))
        
    if mode in ("all", "syslog"):
        syslog_transport = await start_syslog_server()
        if syslog_transport is None:
            logger.warning("Syslog UDP Server failed to bind.")
            # If syslog only mode, wait forever.
            if mode == "syslog":
                while True:
                    await asyncio.sleep(3600)
        else:
            try:
                while not syslog_transport.is_closing():
                    await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Syslog runtime error: {e}")
            finally:
                syslog_transport.close()
            return

    if tasks:
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Background Worker Engine stopped by user.")

