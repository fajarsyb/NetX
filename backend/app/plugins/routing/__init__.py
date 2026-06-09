from app.plugins.base import BasePlugin
from app.routers.routing import router

class RoutingPlugin(BasePlugin):
    name = "routing"
    title = "Routing Tables"
    description = "Tracks IPv4 route prefixes and gateways."
    version = "1.0.0"
    router = router

plugin = RoutingPlugin()
