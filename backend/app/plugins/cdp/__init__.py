from app.plugins.base import BasePlugin
from app.routers.cdp import router, refresh_cdp_logic

class CdpPlugin(BasePlugin):
    name = "cdp"
    title = "CDP Neighbors"
    description = "Tracks Cisco Discovery Protocol neighbors."
    version = "1.0.0"
    router = router

    tasks = {
        "refresh_cdp": refresh_cdp_logic
    }

plugin = CdpPlugin()
