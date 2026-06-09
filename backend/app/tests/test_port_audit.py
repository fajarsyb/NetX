import unittest
from app.routers.snmp import is_physical_interface, parse_show_interface_status
from app.routers.port_analysis import get_expected_port_count

class TestPortAudit(unittest.TestCase):
    def test_is_physical_interface(self):
        # Allied Telesis physical formats
        self.assertTrue(is_physical_interface("port1.0.1"))
        self.assertTrue(is_physical_interface("port2.0.24"))
        
        # Physical interfaces
        self.assertTrue(is_physical_interface("GigabitEthernet0/1"))
        self.assertTrue(is_physical_interface("FastEthernet0/2"))
        self.assertTrue(is_physical_interface("xe-0/0/1"))
        self.assertTrue(is_physical_interface("et-0/0/2"))
        self.assertTrue(is_physical_interface("eth0"))
        
        # Virtual / Logical exclusions
        self.assertFalse(is_physical_interface("vlan100"))
        self.assertFalse(is_physical_interface("vlanif200"))
        self.assertFalse(is_physical_interface("v707")) # Ruckus VLAN format
        self.assertFalse(is_physical_interface("v1148"))
        self.assertFalse(is_physical_interface("loopback0"))
        self.assertFalse(is_physical_interface("lo0"))
        self.assertFalse(is_physical_interface("null0"))
        self.assertFalse(is_physical_interface("tunnel1"))
        self.assertFalse(is_physical_interface("gre0"))
        self.assertFalse(is_physical_interface("port-channel1"))
        self.assertFalse(is_physical_interface("po2"))
        self.assertFalse(is_physical_interface("ae0")) # Juniper LAG
        self.assertFalse(is_physical_interface("mgmt0"))
        self.assertFalse(is_physical_interface("me0"))
        self.assertFalse(is_physical_interface("fxp0"))
        
        # Subinterfaces (dots)
        self.assertFalse(is_physical_interface("ge-0/0/0.0"))
        self.assertFalse(is_physical_interface("GigabitEthernet0/1.100"))
        self.assertFalse(is_physical_interface("port1.0.1.10")) # subinterface of Allied Telesis format

    def test_get_expected_port_count(self):
        # Juniper
        self.assertEqual(get_expected_port_count("EX3400-48T"), 54)
        self.assertEqual(get_expected_port_count("EX3400-24P"), 30)
        self.assertEqual(get_expected_port_count("EX4650-48Y-8C"), 56)
        
        # Cisco
        self.assertEqual(get_expected_port_count("C9200-48T"), 52)
        self.assertEqual(get_expected_port_count("WS-C2960X-48TS-L"), 52)
        self.assertEqual(get_expected_port_count("WS-C2960-24TT-L"), 28)
        
        # Ruijie
        self.assertEqual(get_expected_port_count("S2910-24GT4XS-UP-H"), 28)
        
        # Allied Telesis
        self.assertEqual(get_expected_port_count("AT-x530L-52GTX"), 52)
        self.assertEqual(get_expected_port_count("AT-x530L-28GPX"), 28)
        self.assertEqual(get_expected_port_count("AT-x550-18XSQ"), 18)
        
        # Ruckus
        self.assertEqual(get_expected_port_count("ICX7150-24-POE"), 28)
        self.assertEqual(get_expected_port_count("ICX7550-24Z-POE"), 28)

    def test_parse_show_interface_status(self):
        cli_output = """
Interface      Status      Vlan      Duplex   Speed    Type
------------------------------------------------------------
GigabitEthernet 0/1   Connected   10        a-Full   a-1000   1000Base-T
GigabitEthernet 0/2   Not-connect 10        Auto     Auto     1000Base-T
GigabitEthernet 0/3   Disabled    1         Auto     Auto     1000Base-T
Vlan 10               Connected   Routed    Full     Auto     SVI
Null 0                Connected   Routed    Full     Auto     Null
"""
        parsed = parse_show_interface_status(cli_output)
        self.assertEqual(len(parsed), 3)
        
        # Interface 1
        self.assertEqual(parsed[0]["name"], "GigabitEthernet0/1")
        self.assertEqual(parsed[0]["status"], "up")
        self.assertEqual(parsed[0]["admin_status"], "up")
        self.assertEqual(parsed[0]["speed"], "1 Gbps")
        self.assertEqual(parsed[0]["speed_mbps"], 1000)
        self.assertEqual(parsed[0]["vlan"], "10")
        
        # Interface 2
        self.assertEqual(parsed[1]["name"], "GigabitEthernet0/2")
        self.assertEqual(parsed[1]["status"], "down")
        self.assertEqual(parsed[1]["admin_status"], "up")
        self.assertEqual(parsed[1]["speed"], "Auto/Unknown")
        self.assertEqual(parsed[1]["speed_mbps"], 0)
        self.assertEqual(parsed[1]["vlan"], "10")
        
        # Interface 3
        self.assertEqual(parsed[2]["name"], "GigabitEthernet0/3")
        self.assertEqual(parsed[2]["status"], "down")
        self.assertEqual(parsed[2]["admin_status"], "down")
        self.assertEqual(parsed[2]["speed"], "Auto/Unknown")
        self.assertEqual(parsed[2]["speed_mbps"], 0)
        self.assertEqual(parsed[2]["vlan"], "1")

if __name__ == "__main__":
    unittest.main()
