import unittest
from app.services.performance_monitor import get_vendor_key, format_uptime, get_simulated_performance

class TestPerformanceMonitor(unittest.TestCase):
    def test_vendor_key_resolution(self):
        self.assertEqual(get_vendor_key("cisco_ios"), "cisco")
        self.assertEqual(get_vendor_key("cisco_xe"), "cisco")
        self.assertEqual(get_vendor_key("juniper_junos"), "juniper")
        self.assertEqual(get_vendor_key("huawei"), "huawei")
        self.assertEqual(get_vendor_key("ruckus_fastiron"), "ruckus")
        self.assertEqual(get_vendor_key("ruijie_os"), "ruijie")
        self.assertEqual(get_vendor_key("aruba_os"), "aruba")
        self.assertEqual(get_vendor_key("mikrotik_routeros"), "mikrotik")
        self.assertEqual(get_vendor_key("unknown_vendor"), "generic")

    def test_format_uptime_ticks(self):
        # 123456 ticks = 1234.56 seconds = 20 minutes, 34 seconds
        self.assertEqual(format_uptime("123456"), "20 menit")
        
        # 9000000 ticks = 90000 seconds = 1 day, 1 hour, 0 minutes
        self.assertEqual(format_uptime("9000000"), "1 hari, 1 jam")

        # Invalid ticks
        self.assertEqual(format_uptime("invalid"), "invalid")

    def test_simulated_performance_offline(self):
        stats = get_simulated_performance(1, "offline")
        self.assertEqual(stats["cpu"], 0)
        self.assertEqual(stats["ram"], 0)
        self.assertEqual(stats["uptime"], "Offline")
        self.assertEqual(stats["source"], "simulated")

    def test_simulated_performance_online(self):
        stats = get_simulated_performance(5, "online")
        self.assertGreater(stats["cpu"], 0)
        self.assertGreater(stats["ram"], 0)
        self.assertIn("hari", stats["uptime"])
        self.assertEqual(stats["source"], "simulated")
