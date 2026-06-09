import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class GenericDriver(BaseDriver):
    name: str = "generic"
    netmiko_device_type: str = "generic"

    def parse_arp(self, output: str, device_type: str = "generic") -> List[Dict]:
        from app.services.arp_parser import parse_arp
        return parse_arp(output, device_type)

    def parse_lldp(self, output: str, device_type: str = "generic") -> List[Dict]:
        from app.services.lldp_parser import parse_lldp
        return parse_lldp(output, device_type)

    def parse_cdp(self, output: str, device_type: str = "generic") -> List[Dict]:
        from app.services.cdp_parser import parse_cdp
        return parse_cdp(output, device_type)

    def parse_routing(self, output: str, device_type: str = "generic") -> List[Dict]:
        from app.services.routing_parser import parse_routing
        return parse_routing(output, device_type)

    def parse_mac_table(self, output: str, device_type: str = "generic") -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, device_type)

    def parse_show_interface_status(self, output: str, device_type: str = "generic") -> List[Dict]:
        # Generic status parser
        interfaces = []
        if not output or output.startswith("ERROR:"):
            return interfaces
        for line in output.splitlines():
            line = line.strip()
            if not line or line.startswith('---') or 'interface' in line.lower() or 'status' in line.lower():
                continue
            tokens = line.split()
            if len(tokens) < 2:
                continue
            if_name = tokens[0]
            if not self.is_physical_interface(if_name):
                continue
            status_raw = tokens[1].lower()
            if 'connected' in status_raw or 'up' in status_raw or 'active' in status_raw:
                status = 'up'
                admin_status = 'up'
            elif 'disabled' in status_raw or 'disable' in status_raw:
                status = 'down'
                admin_status = 'down'
            else:
                status = 'down'
                admin_status = 'up'
            
            vlan = tokens[2] if len(tokens) >= 3 else "1"
            duplex = tokens[3] if len(tokens) >= 4 else "Auto"
            speed = tokens[4] if len(tokens) >= 5 else "Auto/Unknown"
            
            interfaces.append({
                "name": if_name,
                "status": status,
                "admin_status": admin_status,
                "speed": speed,
                "speed_mbps": 0,
                "vlan": vlan,
                "duplex": duplex
            })
        return interfaces

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = ""
        v_match = re.search(r"Version\s*[:\s]\s*(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        s_match = re.search(r"Serial\s*(?:Number)?\s*[:\s]\s*(\S+)", sys_descr, re.IGNORECASE)
        if s_match:
            hardware_model = "Generic Device"
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str, device_type: str = "generic") -> Dict:
        os_version = ""
        serial_number = ""
        mac_address = ""
        hardware_model = ""

        # MAC Address
        m_match = re.search(r"([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})", output)
        if m_match:
            cleaned = m_match.group(1).replace('.', '').upper()
            mac_address = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))
        else:
            m_match = re.search(r"([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})", output)
            if m_match:
                mac_address = m_match.group(1).replace('-', ':').upper()

        v_match = re.search(r"Version\s*[:\s]\s*(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)

        s_match = re.search(r"Serial\s*(?:Number)?\s*[:\s]\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model or "Generic"
        }
