import unittest
from app.core.drivers import driver_manager
from app.core.plugins import plugin_manager
from app.drivers.base import BaseDriver
from app.plugins.base import BasePlugin

class TestPlatformArchitecture(unittest.TestCase):
    def test_drivers_registry(self):
        # Retrieve concrete drivers
        cisco = driver_manager.get_driver("cisco_ios")
        self.assertEqual(cisco.name, "cisco")
        
        juniper = driver_manager.get_driver("juniper_junos")
        self.assertEqual(juniper.name, "juniper")
        
        ruijie = driver_manager.get_driver("ruijie_os")
        self.assertEqual(ruijie.name, "ruijie")
        
        ruckus = driver_manager.get_driver("ruckus_fastiron")
        self.assertEqual(ruckus.name, "ruckus")
        
        allied = driver_manager.get_driver("allied_telesis")
        self.assertEqual(allied.name, "allied_telesis")

        mikrotik = driver_manager.get_driver("mikrotik_routeros")
        self.assertEqual(mikrotik.name, "mikrotik")

        huawei = driver_manager.get_driver("huawei")
        self.assertEqual(huawei.name, "huawei")

        aruba = driver_manager.get_driver("aruba_os")
        self.assertEqual(aruba.name, "aruba")

        fortinet = driver_manager.get_driver("fortinet")
        self.assertEqual(fortinet.name, "fortinet")
        
        # Test sysDescr matching
        drv = driver_manager.match_driver_by_sys_descr("Cisco IOS Software, C2960 Software")
        self.assertEqual(drv.name, "cisco")
        
        drv = driver_manager.match_driver_by_sys_descr("Juniper Networks, Inc. ex3400-24t")
        self.assertEqual(drv.name, "juniper")

        drv = driver_manager.match_driver_by_sys_descr("MikroTik RouterOS 7.12.1")
        self.assertEqual(drv.name, "mikrotik")

        drv = driver_manager.match_driver_by_sys_descr("Huawei Versatile Routing Platform Software")
        self.assertEqual(drv.name, "huawei")

        drv = driver_manager.match_driver_by_sys_descr("ArubaOS (MODEL: 2930F)")
        self.assertEqual(drv.name, "aruba")

        drv = driver_manager.match_driver_by_sys_descr("Fortigate-100D v6.4.5")
        self.assertEqual(drv.name, "fortinet")

    def test_plugins_registry(self):
        plugins = plugin_manager.get_plugins()
        self.assertTrue(len(plugins) >= 5) # should have loaded arp, lldp, cdp, mac, etc.
        
        arp_plugin = plugin_manager.get_plugin("arp")
        self.assertIsNotNone(arp_plugin)
        self.assertEqual(arp_plugin.name, "arp")
        
        # Router checks
        routers = plugin_manager.get_routers()
        self.assertTrue(len(routers) > 0)
        
        # Task handlers
        arp_handler = plugin_manager.get_task_handler("refresh_arp")
        self.assertIsNotNone(arp_handler)
        
        anomaly_handler = plugin_manager.get_task_handler("anomaly_scan")
        self.assertIsNotNone(anomaly_handler)
        
        # Scheduled tasks
        scheduled = plugin_manager.get_scheduled_tasks()
        self.assertTrue(any(t["task_name"] == "anomaly_scan" for t in scheduled))

    def test_rfc5424_syslog_parsing(self):
        from app.services.syslog_server import parse_syslog_message
        
        # Test RFC 5424 message
        raw = "<30>1 2026-06-09T08:04:16.753+07:00 DS-Juniper-SDA-EX4650-LT4-01 jdhcpd - - - sdb_check_cos_queue_usage: sdb_parse_intf_name failed, interface=irb, ret=-6 :1670"
        facility, severity, program, message, timestamp, hostname = parse_syslog_message(raw)
        
        self.assertEqual(facility, 3)
        self.assertEqual(severity, 6)
        self.assertEqual(program, "jdhcpd")
        self.assertEqual(timestamp, "2026-06-09T08:04:16.753+07:00")
        self.assertEqual(hostname, "DS-Juniper-SDA-EX4650-LT4-01")
        self.assertEqual(message, "sdb_check_cos_queue_usage: sdb_parse_intf_name failed, interface=irb, ret=-6 :1670")

    def test_rfc3164_syslog_parsing(self):
        from app.services.syslog_server import parse_syslog_message
        
        # Test RFC 3164 legacy message
        raw = "<30>2026 Jun  7 22:23:32 AT48-LT-9A dhclient: DHCPDISCOVER on vlan116 to 255.255.255.255 port 67 interval 12"
        facility, severity, program, message, timestamp, hostname = parse_syslog_message(raw)
        
        self.assertEqual(facility, 3)
        self.assertEqual(severity, 6)
        self.assertEqual(program, "dhclient")
        self.assertEqual(hostname, "AT48-LT-9A")
        self.assertTrue(message.startswith("dhclient: DHCPDISCOVER"))

