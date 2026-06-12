import time
import logging

logger = logging.getLogger("netx.locks")

class RedisLock:
    def __init__(self, redis_client, resource_key: str, expire_seconds: int = 300):
        self.redis = redis_client
        self.key = f"lock:device:{resource_key}"
        self.expire = expire_seconds

    async def acquire(self) -> bool:
        """Acquires lock via SET NX EX."""
        val = str(time.time())
        # NX: Set if not exists, EX: expiry in seconds
        try:
            acquired = await self.redis.set(self.key, val, nx=True, ex=self.expire)
            return bool(acquired)
        except Exception as e:
            logger.error(f"Failed to acquire lock for {self.key}: {e}")
            return False

    async def release(self):
        """Releases the lock."""
        try:
            await self.redis.delete(self.key)
        except Exception as e:
            logger.error(f"Failed to release lock for {self.key}: {e}")

