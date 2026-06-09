from fastapi import APIRouter
from typing import Dict, List, Callable, Any

class BasePlugin:
    name: str = ""
    title: str = ""
    description: str = ""
    version: str = "1.0.0"

    router: APIRouter = None
    prefix: str = ""
    dependencies: List[Any] = []

    # Map of task names to their async handlers: {"refresh_arp": refresh_arp_logic}
    tasks: Dict[str, Callable] = {}

    # List of periodic task schedules: [{"task_name": "anomaly_scan", "interval": 300, "queue": "default"}]
    scheduled_tasks: List[Dict[str, Any]] = []

    async def on_startup(self, app: Any) -> None:
        """Called during FastAPI startup event."""
        pass

    async def on_shutdown(self, app: Any) -> None:
        """Called during FastAPI shutdown event."""
        pass
