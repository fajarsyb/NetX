from app.plugins.base import BasePlugin
from app.routers.mac import router, refresh_mac_table_logic

class MacPlugin(BasePlugin):
    name = "mac"
    title = "MAC Address Table"
    description = "Tracks dynamic/static MAC table entries."
    version = "1.0.0"
    router = router

    tasks = {
        "refresh_mac": refresh_mac_table_logic
    }

plugin = MacPlugin()
