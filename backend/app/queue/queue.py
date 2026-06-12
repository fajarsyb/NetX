import json
import uuid
from datetime import datetime
import redis.asyncio as aioredis
import os

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

class RedisJobQueue:
    def __init__(self, redis_url: str = REDIS_URL):
        self.redis = aioredis.from_url(redis_url)

    async def enqueue(self, task_name: str, params: dict, priority: str = "default", max_retries: int = 3) -> str:
        """Pushes job to queue:high, queue:default, or queue:low."""
        job_id = str(uuid.uuid4())
        payload = {
            "job_id": job_id,
            "task_name": task_name,
            "params": params,
            "created_at": datetime.utcnow().isoformat(),
            "retries": 0,
            "max_retries": max_retries
        }
        queue_name = f"queue:{priority}"
        await self.redis.lpush(queue_name, json.dumps(payload))
        return job_id

    async def run_sync_over_async(self, task_name: str, params: dict, priority: str = "high", timeout: float = 30.0) -> dict:
        import asyncio
        job_id = await self.enqueue(task_name, params, priority)
        result_key = f"job:result:{job_id}"
        
        # Poll Redis for results
        elapsed = 0.0
        poll_interval = 0.2
        while elapsed < timeout:
            try:
                data = await self.redis.get(result_key)
                if data:
                    await self.redis.delete(result_key)
                    return json.loads(data.decode("utf-8"))
            except Exception:
                pass
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            
        raise TimeoutError(f"Job {job_id} ({task_name}) timed out after {timeout} seconds.")

# Global queue instance
job_queue = RedisJobQueue()

