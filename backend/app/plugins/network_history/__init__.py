import os
import asyncio
from app.plugins.base import BasePlugin
from app.services.network_history_service import start_network_history_scheduler, record_network_history_snapshot

class NetworkHistoryPlugin(BasePlugin):
    name = "network_history"
    title = "Network History"
    description = "Captures periodic snapshots of network status."
    version = "1.0.0"

    tasks = {
        "network_history_snapshot": record_network_history_snapshot
    }

    # Define scheduled task configuration
    scheduled_tasks = [
        {
            "task_name": "network_history_snapshot",
            "interval": 600.0,
            "queue": "low"
        }
    ]

    async def on_startup(self, app) -> None:
        mode = os.environ.get("NETX_MODE", "api").lower()
        if mode != "api":
            asyncio.create_task(start_network_history_scheduler())

plugin = NetworkHistoryPlugin()
