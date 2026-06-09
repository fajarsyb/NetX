import os
import asyncio
from app.plugins.base import BasePlugin
from app.routers.device_backup import router
from app.services.device_backup_service import start_device_backup_scheduler, backup_device_config, execute_schedule_backups

class DeviceBackupPlugin(BasePlugin):
    name = "device_backup"
    title = "Device Backups"
    description = "Schedules and executes device configuration backups."
    version = "1.0.0"
    router = router

    tasks = {
        "device_backup": backup_device_config,
        "device_backup_schedule": execute_schedule_backups
    }

    async def on_startup(self, app) -> None:
        mode = os.environ.get("NETX_MODE", "api").lower()
        if mode != "api":
            asyncio.create_task(start_device_backup_scheduler())

plugin = DeviceBackupPlugin()
