import time
import logging
import os
import threading
from collections import defaultdict
from fastapi import Request, WebSocket, HTTPException
import redis.asyncio as aioredis

logger = logging.getLogger("netx.rate_limit")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Global Redis client
redis_client = None
try:
    redis_client = aioredis.from_url(REDIS_URL)
except Exception as e:
    logger.warning(f"Could not connect to Redis: {e}. Rate limiting will use in-memory fallback.")

# Global in-memory storage fallback
in_memory_store = defaultdict(list)
in_memory_lock = threading.Lock()

class RateLimiter:
    def __init__(self, limit: int, window: int, name: str = "default"):
        """
        limit: Max number of requests allowed in the window
        window: Window size in seconds
        name: Name identifier for the rate limit category
        """
        self.limit = limit
        self.window = window
        self.name = name

    async def __call__(self, request: Request = None, websocket: WebSocket = None):
        connection = request or websocket
        if connection is None:
            return

        # Determine client identifier (IP address)
        client_ip = connection.client.host if connection.client else "unknown"
        path = connection.url.path
        key = f"rate_limit:{self.name}:{path}:{client_ip}"

        
        current_time = time.time()
        window_start = current_time - self.window
        
        # Try using Redis first
        if redis_client is not None:
            try:
                # Test connection by running pipeline
                pipe = redis_client.pipeline()
                pipe.zremrangebyscore(key, 0, window_start)
                pipe.zadd(key, {str(current_time): current_time})
                pipe.zcard(key)
                pipe.expire(key, self.window)
                results = await pipe.execute()
                
                # results[2] is the count of requests in the ZSET after adding the current one
                request_count = results[2]
                if request_count > self.limit:
                    logger.warning(f"Rate limit exceeded (Redis) for key {key}. Limit: {self.limit}, Current: {request_count}")
                    raise HTTPException(
                        status_code=429,
                        detail="Too many requests. Please try again later."
                    )
                return
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Redis rate limiter failed, falling back to in-memory: {e}")
                
        # In-memory fallback
        with in_memory_lock:
            # Clean up old timestamps
            timestamps = in_memory_store[key]
            timestamps = [t for t in timestamps if t > window_start]
            
            # Check limit
            if len(timestamps) >= self.limit:
                logger.warning(f"Rate limit exceeded (In-Memory) for key {key}. Limit: {self.limit}, Current: {len(timestamps)}")
                # update the store with pruned list
                in_memory_store[key] = timestamps
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please try again later."
                )
            
            # Add current timestamp
            timestamps.append(current_time)
            in_memory_store[key] = timestamps
