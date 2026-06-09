from app.plugins.base import BasePlugin
from app.routers.lldp import router, refresh_lldp_logic

class LldpPlugin(BasePlugin):
    name = "lldp"
    title = "LLDP Topology"
    description = "Tracks LLDP neighbors and connectivity."
    version = "1.0.0"
    router = router

    tasks = {
        "refresh_lldp": refresh_lldp_logic
    }

plugin = LldpPlugin()
