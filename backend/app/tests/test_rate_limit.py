import unittest
from fastapi import Request, HTTPException
from app.core.rate_limit import RateLimiter
import asyncio

class TestRateLimiter(unittest.TestCase):
    def test_in_memory_rate_limiting(self):
        limiter = RateLimiter(limit=2, window=60, name="test_limiter")
        
        # Mock HTTP request scope
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/test-limit",
            "headers": [],
            "client": ("127.0.0.99", 54321)
        }
        request = Request(scope)
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # 1st request -> Allowed
            loop.run_until_complete(limiter(request))
            
            # 2nd request -> Allowed
            loop.run_until_complete(limiter(request))
            
            # 3rd request -> Must raise 429 Too Many Requests
            with self.assertRaises(HTTPException) as context:
                loop.run_until_complete(limiter(request))
            self.assertEqual(context.exception.status_code, 429)
        finally:
            loop.close()
