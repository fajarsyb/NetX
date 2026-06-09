import os
import asyncio
from app.plugins.base import BasePlugin
from app.routers.syslog import router
from app.services.syslog_server import start_syslog_server

class SyslogPlugin(BasePlugin):
    name = "syslog"
    title = "Syslog Server"
    description = "Listens for syslog messages over UDP and parses/stores them."
    version = "1.0.0"
    router = router

    async def on_startup(self, app) -> None:
        mode = os.environ.get("NETX_MODE", "api").lower()
        if mode != "api":
            asyncio.create_task(start_syslog_server())

plugin = SyslogPlugin()
