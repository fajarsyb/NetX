import unittest
from app.core.drivers import driver_manager
from app.services.arp_parser import parse_arp
from app.services.lldp_parser import parse_lldp

class TestDriverParsers(unittest.TestCase):
    def setUp(self):
        self.cisco = driver_manager.get_driver("cisco_ios")
        self.juniper = driver_manager.get_driver("juniper_junos")
        self.allied = driver_manager.get_driver("allied_telesis")
        self.huawei = driver_manager.get_driver("huawei")

    def test_cisco_parser(self):
        # 1. Test Cisco ARP parsing
        ios_arp = (
            "Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n"
            "Internet  192.168.1.1             0   0011.2233.4455  ARPA   GigabitEthernet1\n"
            "Internet  192.168.1.2             -   0011.2233.4456  ARPA   GigabitEthernet2\n"
        )
        entries = self.cisco.parse_arp(ios_arp)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["ip"], "192.168.1.1")
        self.assertEqual(entries[0]["mac"], "00:11:22:33:44:55")
        self.assertEqual(entries[0]["interface"], "GigabitEthernet1")
        self.assertEqual(entries[0]["entry_type"], "dynamic")
        self.assertEqual(entries[1]["entry_type"], "static")

        nxos_arp = "192.168.1.3     00:10:00  0011.2233.4457   Ethernet1/1\n"
        entries = self.cisco.parse_arp(nxos_arp)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["ip"], "192.168.1.3")
        self.assertEqual(entries[0]["interface"], "Ethernet1/1")

        # 2. Test Cisco Info parsing
        version_output = (
            "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 12.2(55)SE9, RELEASE SOFTWARE (fc1)\n"
            "System Serial Number: FOC12345678\n"
            "Model Number: WS-C2960-24TT-L\n"
            "Processor board ID FOC12345678\n"
            "Base ethernet MAC Address: 00:11:22:33:44:55\n"
        )
        info = self.cisco.parse_info(version_output)
        self.assertEqual(info["os_version"], "12.2(55)SE9")
        self.assertEqual(info["serial_number"], "FOC12345678")
        self.assertEqual(info["hardware_model"], "WS-C2960-24TT-L")

        # 3. Test Cisco Interface Status parsing
        status_output = (
            "Port      Name               Status       Vlan       Duplex  Speed Type\n"
            "Gi1/0/1                      connected    1          a-full  a-1000 10/100/1000BaseTX\n"
            "Gi1/0/2                      disabled     trunk      a-full  a-1000 10/100/1000BaseTX\n"
        )
        interfaces = self.cisco.parse_show_interface_status(status_output)
        self.assertEqual(len(interfaces), 2)
        self.assertEqual(interfaces[0]["name"], "Gi1/0/1")
        self.assertEqual(interfaces[0]["status"], "up")
        self.assertEqual(interfaces[1]["status"], "down")
        self.assertEqual(interfaces[1]["admin_status"], "down")

    def test_juniper_parser(self):
        # 1. Test Juniper ARP parsing
        arp_output = (
            "MAC Address       Address         Name       Interface   Flags\n"
            "00:50:56:a1:b2:c3 192.168.2.1     192.168.2.1 ge-0/0/0.0 none\n"
            "00:50:56:a1:b2:c4 192.168.2.2     192.168.2.2 ge-0/0/1.0 permanent\n"
        )
        entries = self.juniper.parse_arp(arp_output)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["ip"], "192.168.2.1")
        self.assertEqual(entries[0]["mac"], "00:50:56:A1:B2:C3")
        self.assertEqual(entries[1]["entry_type"], "static")

        # 2. Test Juniper Info parsing
        version_output = (
            "Model: ex3400-24t\n"
            "Junos: 18.2R1.9\n"
            "Chassis                 EX3400-24T           PE3718000001\n"
            "Base address      00:11:22:33:44:56\n"
        )
        info = self.juniper.parse_info(version_output)
        self.assertEqual(info["os_version"], "18.2R1.9")
        self.assertEqual(info["serial_number"], "PE3718000001")
        self.assertEqual(info["hardware_model"], "EX3400-24T")

        # 3. Test Juniper Interfaces parsing
        terse_output = (
            "Interface               Admin Link Proto    Local                 Remote\n"
            "ge-0/0/0                up    up\n"
            "ge-0/0/0.0              up    up   eth-switch\n"
            "ge-0/0/1                up    down\n"
        )
        interfaces = self.juniper.parse_show_interface_status(terse_output)
        self.assertEqual(len(interfaces), 2)
        self.assertEqual(interfaces[0]["name"], "ge-0/0/0")
        self.assertEqual(interfaces[0]["status"], "up")
        self.assertEqual(interfaces[1]["name"], "ge-0/0/1")
        self.assertEqual(interfaces[1]["status"], "down")

        # 4. Test Juniper VLANs parsing
        vlans_output = (
            "VLAN Name        VLAN ID  Ports\n"
            "default          1        ge-0/0/0.0*, ge-0/0/1.0\n"
            "vlan10           10       ge-0/0/2.0\n"
        )
        vlans = self.juniper.parse_vlans(vlans_output)
        self.assertEqual(len(vlans), 2)
        self.assertEqual(vlans[0]["name"], "default")
        self.assertEqual(vlans[0]["vlan_id"], 1)
        self.assertEqual(vlans[1]["vlan_id"], 10)

        # 5. Test Juniper Trunks parsing
        trunks_output = (
            "Interface    State       VLAN members        Tag   Tagging\n"
            "ge-0/0/1.0   up\n"
            "                         vlan10              10    tagged\n"
            "                         vlan20              20    tagged\n"
        )
        trunks = self.juniper.parse_trunks(trunks_output)
        self.assertEqual(len(trunks), 1)
        self.assertEqual(trunks[0]["interface_name"], "ge-0/0/1")
        self.assertEqual(trunks[0]["port_type"], "Trunk")
        self.assertEqual(trunks[0]["allowed_vlans"], "10,20")

    def test_allied_telesis_parser(self):
        # 1. Test Allied Telesis ARP parsing
        arp_output = (
            "IP Address      MAC Address       Port         Type      Age\n"
            "192.168.3.1     001a.eb12.3456    port1.0.1    dynamic   12\n"
            "192.168.3.2     001a.eb12.3457    port1.0.2    static    -\n"
        )
        entries = self.allied.parse_arp(arp_output)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["ip"], "192.168.3.1")
        self.assertEqual(entries[0]["mac"], "00:1A:EB:12:34:56")
        self.assertEqual(entries[0]["interface"], "port1.0.1")
        self.assertEqual(entries[1]["entry_type"], "static")

        # 2. Test Allied Telesis Info parsing
        version_output = (
            "AlliedWare Plus (TM) v5.4.8-2.6\n"
            "Software Version : 5.4.8-2.6\n"
            "Serial Number : 1234567890\n"
            "Chassis : x510-28GPX\n"
            "Base MAC Address : 00:1a:eb:12:34:56\n"
        )
        info = self.allied.parse_info(version_output)
        self.assertEqual(info["os_version"], "5.4.8-2.6")
        self.assertEqual(info["serial_number"], "1234567890")
        self.assertEqual(info["hardware_model"], "x510-28GPX")

        # 3. Test Allied Telesis Interfaces parsing
        status_output = (
            "Interface            Status        Admin       Speed      Duplex\n"
            "port1.0.1            admin up      running\n"
            "port1.0.2            down          disabled\n"
        )
        interfaces = self.allied.parse_show_interface_status(status_output)
        self.assertEqual(len(interfaces), 2)
        self.assertEqual(interfaces[0]["name"], "port1.0.1")
        self.assertEqual(interfaces[0]["status"], "up")
        self.assertEqual(interfaces[1]["status"], "down")

        # 4. Test Allied Telesis Trunks parsing
        trunks_output = (
            "Interface name: port1.0.1\n"
            "  Switchport mode: Trunk\n"
            "  Default Vlan: 1\n"
            "  Configured Vlans: 10 20 30\n"
        )
        trunks = self.allied.parse_trunks(trunks_output)
        self.assertEqual(len(trunks), 1)
        self.assertEqual(trunks[0]["interface_name"], "port1.0.1")
        self.assertEqual(trunks[0]["port_type"], "Trunk")
        self.assertEqual(trunks[0]["native_vlan"], "1")
        self.assertEqual(trunks[0]["allowed_vlans"], "10,20,30")

    def test_huawei_parser(self):
        # 1. Test Huawei ARP parsing
        arp_output = (
            "ARP Entry Types: D - Dynamic, S - Static, I - Interface\n"
            "IP ADDRESS      MAC ADDRESS     EXPIRE(M) TYPE INTERFACE      VPN-INSTANCE\n"
            "D  17  192.168.4.1     aabb-cc00-0100  10  GE0/0/1\n"
            "S      192.168.4.2     aabb-cc00-0200      GE0/0/2\n"
        )
        entries = self.huawei.parse_arp(arp_output)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["ip"], "192.168.4.1")
        self.assertEqual(entries[0]["mac"], "AA:BB:CC:00:01:00")
        self.assertEqual(entries[0]["interface"], "GE0/0/1")
        self.assertEqual(entries[0]["entry_type"], "dynamic")
        self.assertEqual(entries[1]["entry_type"], "static")

        # 2. Test Huawei Info parsing (omit 'Huawei' on the first line to avoid false matching 'Versatile' as model)
        version_output = (
            "Versatile Routing Platform Software\n"
            "VRP (R) software, Version 5.170 (S5700 V200R001C00)\n"
            "Huawei S5700-28X-LI-AC Switch\n"
            "Equipment Serial Number : 210235528410E4000123\n"
            "System MAC Address : aabb-cc00-0100\n"
        )
        info = self.huawei.parse_info(version_output)
        self.assertEqual(info["os_version"], "5.170")
        self.assertEqual(info["serial_number"], "210235528410E4000123")
        self.assertEqual(info["hardware_model"], "S5700-28X-LI-AC")

        # 3. Test Huawei Interfaces parsing
        status_output = (
            "Interface                   PHY      Protocol Speed      Duplex   Type\n"
            "GigabitEthernet0/0/1        up       up       1000M      full     main\n"
            "GigabitEthernet0/0/2        *down    down     auto       auto     main\n"
        )
        interfaces = self.huawei.parse_show_interface_status(status_output)
        self.assertEqual(len(interfaces), 2)
        self.assertEqual(interfaces[0]["name"], "GigabitEthernet0/0/1")
        self.assertEqual(interfaces[0]["status"], "up")
        self.assertEqual(interfaces[1]["status"], "down")

        # 4. Test Huawei VLANs parsing
        vlans_output = (
            "VLAN ID Type    Status   MAC Learning Broad-Cast Ports\n"
            "-------------------------------------------------------------------------------\n"
            "1       common  enable   enable       forward    GE0/0/1(U) GE0/0/2(U)\n"
            "10      common  enable   enable       forward    TG:GE0/0/3(T)\n"
        )
        vlans = self.huawei.parse_vlans(vlans_output)
        self.assertEqual(len(vlans), 2)
        self.assertEqual(vlans[0]["vlan_id"], 1)
        self.assertEqual(vlans[1]["vlan_id"], 10)

        # 5. Test Huawei Trunks parsing
        trunks_output = (
            "Port                    Link Type    PVID  Trunk VLAN List\n"
            "-------------------------------------------------------------------------------\n"
            "GigabitEthernet0/0/1    trunk        1     1 10 20\n"
            "GigabitEthernet0/0/2    access       10    -\n"
        )
        trunks = self.huawei.parse_trunks(trunks_output)
        self.assertEqual(len(trunks), 1)
        self.assertEqual(trunks[0]["interface_name"], "GigabitEthernet0/0/1")
        self.assertEqual(trunks[0]["port_type"], "Trunk")
        self.assertEqual(trunks[0]["native_vlan"], "1")
        self.assertEqual(trunks[0]["allowed_vlans"], "1,10,20")
