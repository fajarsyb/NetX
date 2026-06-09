from app.plugins.base import BasePlugin
from app.routers.mibs import router

class MibsPlugin(BasePlugin):
    name = "mibs"
    title = "MIB Parser"
    description = "Parses and compiles custom SNMP MIBs."
    version = "1.0.0"
    router = router

plugin = MibsPlugin()
