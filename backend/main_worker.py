import os
import sys
import json
import asyncio
import logging
import redis.asyncio as aioredis
from dotenv import load_dotenv

# Load env file
load_dotenv()

# Add current directory to path to allow importing app module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.queue.locks import RedisLock
from app.worker.handlers import handle_job

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("netx.worker")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
MAX_CONCURRENT_SSH = int(os.environ.get("MAX_CONCURRENT_SSH", "20"))

# Semaphore to control concurrent execution and limit active sockets/file descriptors
sem = asyncio.Semaphore(MAX_CONCURRENT_SSH)

async def process_job(job_data: dict, redis_client):
    job_id = job_data.get("job_id")
    task_name = job_data.get("task_name")
    params = job_data.get("params", {})
    device_id = params.get("device_id")

    # Limit total concurrent active SSH/network sessions inside this worker process
    async with sem:
        if device_id:
            # Acquire distributed lock for this physical device to avoid concurrent connection collisons
            lock = RedisLock(redis_client, str(device_id))
            if not await lock.acquire():
                logger.warning(f"Device {device_id} is currently locked by another process. Re-queueing job {job_id}...")
                await asyncio.sleep(2.0)
                # Put back into default queue
                await redis_client.lpush("queue:default", json.dumps(job_data))
                return
            
            try:
                logger.info(f"Running device-locked job {job_id} ({task_name}) for device {device_id}")
                res = await handle_job(task_name, params)
                logger.info(f"Successfully finished job {job_id} ({task_name})")
                # Save result to Redis for sync-over-async
                await redis_client.setex(f"job:result:{job_id}", 300, json.dumps({"success": True, "result": res}))
            except Exception as e:
                logger.error(f"Job {job_id} failed with error: {e}")
                # Save failure result to Redis
                await redis_client.setex(f"job:result:{job_id}", 300, json.dumps({"success": False, "error": str(e)}))
                # Retry logic
                retries = job_data.get("retries", 0)
                max_retries = job_data.get("max_retries", 3)
                if retries < max_retries:
                    job_data["retries"] = retries + 1
                    logger.info(f"Retrying job {job_id} ({job_data['retries']}/{max_retries}) in default queue")
                    await redis_client.lpush("queue:default", json.dumps(job_data))
                else:
                    logger.error(f"Job {job_id} exceeded max retries. Pushing to DLQ.")
                    await redis_client.lpush("queue:dlq", json.dumps(job_data))
            finally:
                await lock.release()
        else:
            # Non-device-bound job (e.g. anomaly scans or network history tracking)
            try:
                logger.info(f"Running non-device job {job_id} ({task_name})")
                res = await handle_job(task_name, params)
                logger.info(f"Successfully finished job {job_id} ({task_name})")
                await redis_client.setex(f"job:result:{job_id}", 300, json.dumps({"success": True, "result": res}))
            except Exception as e:
                logger.error(f"Job {job_id} failed with error: {e}")
                await redis_client.setex(f"job:result:{job_id}", 300, json.dumps({"success": False, "error": str(e)}))
                retries = job_data.get("retries", 0)
                max_retries = job_data.get("max_retries", 3)
                if retries < max_retries:
                    job_data["retries"] = retries + 1
                    await redis_client.lpush("queue:default", json.dumps(job_data))
                else:
                    await redis_client.lpush("queue:dlq", json.dumps(job_data))

async def worker_loop():
    logger.info("Initializing NetX Background Worker Daemon...")
    r = aioredis.from_url(REDIS_URL, socket_timeout=30.0)
    
    # Test Redis connectivity on startup
    try:
        await r.ping()
        logger.info("Successfully connected to Redis.")
    except Exception as e:
        logger.error(f"Failed to connect to Redis at {REDIS_URL}: {e}")
        sys.exit(1)

    while True:
        try:
            # BRPOP blocks until a job is available in any of high, default, or low queues
            result = await r.brpop(["queue:high", "queue:default", "queue:low"], timeout=5)
            if not result:
                await asyncio.sleep(0.5)
                continue
                
            queue_name, raw_payload = result
            job_data = json.loads(raw_payload.decode("utf-8"))
            
            # Run job process in the background loop under semaphore constraint
            asyncio.create_task(process_job(job_data, r))
        except Exception as e:
            logger.error(f"Error in worker loop: {e}")
            await asyncio.sleep(5)


if __name__ == "__main__":
    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        logger.info("Worker process terminated by user.")
