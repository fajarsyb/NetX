from app.plugins.base import BasePlugin
from app.routers.port_analysis import router
from app.services.l2_service import L2AnalysisService

class PortAnalysisPlugin(BasePlugin):
    name = "port_analysis"
    title = "Port Mapping and Utilization Analysis"
    description = "Maps physical device interfaces and detects port usage recommendations."
    version = "2.0.0"
    router = router
    tasks = {
        "refresh_l2": L2AnalysisService.refresh_device_l2_data
    }

plugin = PortAnalysisPlugin()
