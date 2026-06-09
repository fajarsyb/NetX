from app.plugins.base import BasePlugin
from app.routers.arp import router, refresh_arp_logic

class ArpPlugin(BasePlugin):
    name = "arp"
    title = "ARP Monitoring"
    description = "Tracks ARP tables and associations."
    version = "1.0.0"
    router = router
    prefix = ""

    tasks = {
        "refresh_arp": refresh_arp_logic
    }

plugin = ArpPlugin()
