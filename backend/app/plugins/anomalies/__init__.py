import os
import asyncio
from app.plugins.base import BasePlugin
from app.routers.anomalies import router
from app.services.anomaly_detector import start_anomaly_detection_scheduler, run_anomaly_detection

class AnomaliesPlugin(BasePlugin):
    name = "anomalies"
    title = "Anomaly Detection"
    description = "Scans interfaces for traffic, error, and discard anomalies."
    version = "1.0.0"
    router = router

    tasks = {
        "anomaly_scan": run_anomaly_detection
    }

    # Define scheduled task configuration
    scheduled_tasks = [
        {
            "task_name": "anomaly_scan",
            "interval": 300.0,
            "queue": "default"
        }
    ]

    async def on_startup(self, app) -> None:
        mode = os.environ.get("NETX_MODE", "api").lower()
        if mode != "api":
            asyncio.create_task(start_anomaly_detection_scheduler())

plugin = AnomaliesPlugin()
