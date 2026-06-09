from app.plugins.base import BasePlugin
from app.routers.port_analysis import router

class PortAnalysisPlugin(BasePlugin):
    name = "port_analysis"
    title = "Port Mapping and Utilization Analysis"
    description = "Maps physical device interfaces and detects port usage recommendations."
    version = "1.0.0"
    router = router

plugin = PortAnalysisPlugin()
