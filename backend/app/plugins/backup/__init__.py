from app.plugins.base import BasePlugin
from app.routers.backup import router

class BackupPlugin(BasePlugin):
    name = "backup"
    title = "System Backups"
    description = "Provides manual system configuration backups."
    version = "1.0.0"
    router = router

plugin = BackupPlugin()
