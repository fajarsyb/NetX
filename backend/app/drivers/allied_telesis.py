import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class AlliedTelesisDriver(BaseDriver):
    name: str = "allied_telesis"
    enterprise_oid: str = "1.3.6.1.4.1.207"
    netmiko_device_type: str = "allied_telesis_awplus"
    supports_cdp: bool = False

    # Commands
    arp_command: str = "show arp"
    lldp_command: List[str] = ["show lldp neighbors", "show lldp neighbors detail"]
    cdp_command: str = ""
    routing_command: str = "show ip route"
    info_command: List[str] = ["show version", "show system"]
    mac_table_command: str = "show mac address-table"
    backup_command: str = "show running-config"

    def is_physical_interface(self, if_name: str) -> bool:
        if not if_name:
            return False
        name_lower = if_name.lower().strip()
        if not name_lower or name_lower.isnumeric():
            return False
        if '.' in name_lower:
            if re.match(r"^port\d+\.\d+\.\d+$", name_lower):
                return True
            return False
        return super().is_physical_interface(if_name)

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if '52' in m:
            return 52
        if '28' in m:
            return 28
        if '18' in m:
            return 18
        return super().get_expected_port_count(model_str)

    def parse_arp(self, output: str) -> List[Dict]:
        from app.services.arp_parser import _allied_telesis
        return _allied_telesis(output)

    def parse_lldp(self, output: str) -> List[Dict]:
        from app.services.lldp_parser import _allied_telesis_lldp
        return _allied_telesis_lldp(output)

    def parse_routing(self, output: str) -> List[Dict]:
        from app.services.routing_parser import parse_routing
        return parse_routing(output, "allied_telesis")

    def parse_mac_table(self, output: str) -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, "allied_telesis")

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = ""
        v_match = re.search(r"Software Version\s*:\s*(?:AW\+\s+)?v?(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"Allied Telesis Switch ([^,\s]+)", sys_descr, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1)
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str) -> Dict:
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
            else:
                mac_match = re.search(r"MAC Address\s*:\s*([0-9a-fA-F:\.\-]{14,17})", output, re.IGNORECASE)
                if mac_match:
                    cleaned = re.sub(r"[.\-:]", "", mac_match.group(1)).upper()
                    if len(cleaned) == 12:
                        mac_address = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))

        # Parse OS Version
        v_match = re.search(r"Software Version\s*:\s*(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        else:
            v_match = re.search(r"AlliedWare Plus.*?v(\S+)", output, re.IGNORECASE)
            if v_match:
                os_version = v_match.group(1)

        # Parse Serial and Model from stack info or system info
        base_match = re.search(r"Base\s+\d+\s+(?:Base\s+)?(\S+)\s+\S+\s+(\S+)", output, re.IGNORECASE)
        if base_match:
            hardware_model = base_match.group(1)
            serial_number = base_match.group(2)

        if not serial_number:
            s_match = re.search(r"Serial Number\s*:\s*(\S+)", output, re.IGNORECASE)
            if s_match:
                serial_number = s_match.group(1)

        if not hardware_model:
            h_match = re.search(r"Chassis\s*:\s*(\S+)", output, re.IGNORECASE)
            if h_match:
                hardware_model = h_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model
        }
