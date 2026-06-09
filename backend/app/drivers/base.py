import re
from typing import List, Dict, Union

class BaseDriver:
    name: str = "generic"
    enterprise_oid: str = ""
    netmiko_device_type: str = ""

    # Capability Detection
    supports_cdp: bool = True
    supports_lldp: bool = True
    supports_arp: bool = True
    supports_routing: bool = True
    supports_mac_table: bool = True
    supports_backup: bool = True

    # CLI commands
    arp_command: Union[str, List[str]] = "show ip arp"
    lldp_command: Union[str, List[str]] = "show lldp neighbors detail"
    cdp_command: Union[str, List[str]] = "show cdp neighbors detail"
    routing_command: Union[str, List[str]] = "show ip route"
    info_command: Union[str, List[str]] = "show version"
    mac_table_command: Union[str, List[str]] = "show mac address-table"
    backup_command: str = "show running-config"

    def get_netmiko_device_type(self, protocol: str = "ssh") -> str:
        """Returns the appropriate netmiko device type name for the given protocol."""
        dt = self.netmiko_device_type or self.name
        protocol = protocol.lower()
        if protocol == "telnet":
            telnet_capable = {
                "cisco_ios", "cisco_xe", "cisco_s300",
                "hp_procurve", "extreme_exos",
                "allied_telesis", "allied_telesis_awplus", "huawei",
            }
            if dt in telnet_capable:
                return dt + "_telnet"
        return dt

    @staticmethod
    def _norm_mac(mac: str) -> str:
        if not mac:
            return ""
        clean = re.sub(r"[:\-\.\s]", "", mac).upper()
        if len(clean) != 12:
            return mac.upper()
        return ":".join(clean[i:i+2] for i in range(0, 12, 2))

    def is_physical_interface(self, if_name: str) -> bool:
        """Checks if the interface is a physical device port (not virtual/logical/mgmt)."""
        if not if_name:
            return False
        name_lower = if_name.lower().strip()
        if not name_lower or name_lower.isnumeric():
            return False

        # Check for dots (subinterfaces / Allied Telesis check)
        if '.' in name_lower:
            if re.match(r"^port\d+\.\d+\.\d+$", name_lower):
                pass
            else:
                return False

        # Strict lists of prefixes/patterns to exclude
        if any(name_lower.startswith(x) for x in ('vlan', 'vlanif', 'svi', 'irb', 'bvi')):
            return False
        if re.match(r"^v\d+$", name_lower):
            return False

        # Loopback
        if name_lower.startswith('loopback') or re.match(r"^lo\d*$", name_lower):
            return False

        # Null, Tunnel, GRE, Virtual
        if any(name_lower.startswith(x) for x in ('null', 'nu', 'tunnel', 'tun', 'gre', 'virtual', 'vl', 'veth', 'docker')):
            return False

        # Management, CPU, Internal, Stacking, Logical/LAGs
        if any(name_lower.startswith(x) for x in (
            'mgmt', 'management', 'me', 'fxp', 'em', 'sc', 'cpu', 'internal', 'stack', 'fabric',
            'port-channel', 'portchannel', 'bundle', 'lag', 'ae'
        )):
            return False

        if re.match(r"^po\d*$", name_lower):
            return False

        if 'cpu' in name_lower or 'stack' in name_lower or 'internal' in name_lower:
            return False

        return True

    def get_expected_port_count(self, model_str: str) -> int:
        """Determines physical port count based on device model string."""
        if not model_str:
            return 0
        m = model_str.upper()
        if '52' in m:
            return 52
        if '48' in m:
            return 48
        if '24' in m:
            return 24
        if '28' in m:
            return 28
        if '18' in m:
            return 18
        if '16' in m:
            return 16
        if '12' in m:
            return 12
        if '8' in m:
            return 8

        # Generic check for numbers
        numbers = [int(n) for n in re.findall(r'\d+', m)]
        for p in (48, 24, 52, 28, 12, 8, 16, 96):
            if p in numbers:
                return p
        return 0

    def parse_arp(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_lldp(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_cdp(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_routing(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_info(self, output: str, device_type: str = "") -> Dict:
        return {}

    def parse_mac_table(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_show_interface_status(self, output: str, device_type: str = "") -> List[Dict]:
        return []

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        return {}
