import logging
from typing import Dict
from app.drivers.base import BaseDriver

logger = logging.getLogger("netx.core.drivers")

class DriverManager:
    _instance = None
    _drivers: Dict[str, BaseDriver] = {}

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(DriverManager, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def __init__(self):
        if self._drivers:
            return
        self.load_drivers()

    def load_drivers(self):
        from app.drivers.cisco import CiscoDriver
        from app.drivers.juniper import JuniperDriver
        from app.drivers.ruijie import RuijieDriver
        from app.drivers.ruckus import RuckusDriver
        from app.drivers.allied_telesis import AlliedTelesisDriver
        from app.drivers.mikrotik import MikroTikDriver
        from app.drivers.huawei import HuaweiDriver
        from app.drivers.aruba import ArubaDriver
        from app.drivers.fortinet import FortinetDriver
        from app.drivers.generic import GenericDriver

        drivers_classes = [
            CiscoDriver,
            JuniperDriver,
            RuijieDriver,
            RuckusDriver,
            AlliedTelesisDriver,
            MikroTikDriver,
            HuaweiDriver,
            ArubaDriver,
            FortinetDriver,
            GenericDriver,
        ]

        for drv_cls in drivers_classes:
            drv = drv_cls()
            self._drivers[drv.name] = drv
            logger.info(f"Registered device driver: {drv.name}")

    def get_driver(self, device_type: str) -> BaseDriver:
        """Find driver by device_type or match fallback."""
        if not device_type:
            return self._drivers.get("generic")
        
        # Exact match
        if device_type in self._drivers:
            return self._drivers[device_type]

        # Handle variants
        dt_lower = device_type.lower()
        if dt_lower.startswith("cisco_") or dt_lower == "cisco":
            return self._drivers.get("cisco")
        if dt_lower == "juniper_junos" or dt_lower.startswith("juniper"):
            return self._drivers.get("juniper")
        if dt_lower == "ruijie_os" or dt_lower.startswith("ruijie"):
            return self._drivers.get("ruijie")
        if dt_lower == "ruckus_fastiron" or dt_lower.startswith("ruckus"):
            return self._drivers.get("ruckus")
        if dt_lower in ("allied_telesis", "allied_telesis_awplus") or dt_lower.startswith("allied"):
            return self._drivers.get("allied_telesis")
        if dt_lower == "mikrotik_routeros" or dt_lower.startswith("mikrotik"):
            return self._drivers.get("mikrotik")
        if dt_lower.startswith("huawei"):
            return self._drivers.get("huawei")
        if dt_lower == "aruba_os" or dt_lower.startswith("aruba"):
            return self._drivers.get("aruba")
        if dt_lower.startswith("fortinet") or dt_lower == "fortigate":
            return self._drivers.get("fortinet")

        return self._drivers.get("generic")

    def match_driver_by_sys_descr(self, sys_descr: str, device_type: str = "") -> BaseDriver:
        """Determines the correct driver by matching sysDescr or device_type."""
        dt_lower = device_type.lower() if device_type else ""
        sd_lower = sys_descr.lower() if sys_descr else ""

        if "cisco" in dt_lower or "cisco" in sd_lower:
            return self.get_driver("cisco")
        if "juniper" in dt_lower or "juniper" in sd_lower:
            return self.get_driver("juniper")
        if "ruijie" in dt_lower or "ruijie" in sd_lower:
            return self.get_driver("ruijie")
        if "ruckus" in dt_lower or "ruckus" in sd_lower or "fastiron" in sd_lower:
            return self.get_driver("ruckus")
        if "allied" in dt_lower or "allied" in sd_lower:
            return self.get_driver("allied_telesis")
        if "mikrotik" in dt_lower or "routeros" in sd_lower or "mikrotik" in sd_lower:
            return self.get_driver("mikrotik")
        if "huawei" in dt_lower or "huawei" in sd_lower:
            return self.get_driver("huawei")
        if "aruba" in dt_lower or "aruba" in sd_lower:
            return self.get_driver("aruba")
        if "fortinet" in dt_lower or "fortigate" in sd_lower or "fortinet" in sd_lower:
            return self.get_driver("fortinet")
        
        if device_type:
            return self.get_driver(device_type)
        return self.get_driver("generic")

driver_manager = DriverManager()
