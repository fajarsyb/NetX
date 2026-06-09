import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class RuckusDriver(BaseDriver):
    name: str = "ruckus"
    enterprise_oid: str = "1.3.6.1.4.1.1991"
    netmiko_device_type: str = "ruckus_fastiron"
    supports_cdp: bool = False

    # Commands
    arp_command: str = "show arp"
    lldp_command: List[str] = ["show lldp neighbors", "show lldp neighbors detail"]
    cdp_command: str = ""
    routing_command: str = "show ip route"
    info_command: str = "show version"
    mac_table_command: str = "show mac-address-table"
    backup_command: str = "show running-config"

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if 'ICX7150-24' in m or 'ICX7550-24' in m:
            return 28
        return super().get_expected_port_count(model_str)

    def parse_arp(self, output: str) -> List[Dict]:
        from app.services.arp_parser import _ruckus
        return _ruckus(output)

    def parse_lldp(self, output: str) -> List[Dict]:
        from app.services.lldp_parser import _ruckus_lldp
        return _ruckus_lldp(output)

    def parse_routing(self, output: str) -> List[Dict]:
        from app.services.routing_parser import parse_routing
        return parse_routing(output, "ruckus_fastiron")

    def parse_mac_table(self, output: str) -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, "ruckus_fastiron")

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = ""
        v_match = re.search(r"Version\s+([0-9a-zA-Z\.\-\_]+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"(ICX\d{3,4}(?:-[A-Za-z0-9\-]+)?)", sys_descr)
        if m_match:
            hardware_model = m_match.group(1)
            hardware_model = re.sub(r"[,\s]+$", "", hardware_model)
        else:
            m_match = re.search(r"Inc\.\s+(\S+)", sys_descr, re.IGNORECASE)
            if m_match:
                val = m_match.group(1)
                val = re.sub(r"[,\s]+$", "", val)
                if val.lower() not in ("wireless", "fastiron"):
                    hardware_model = val
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

        # Parse SW version
        v_match = re.search(r"SW:\s+Version\s+(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        else:
            v_match = re.search(r"Version\s+([0-9a-zA-Z\.\(\)\-\_]+)", output)
            if v_match:
                os_version = v_match.group(1)

        # Parse Serial Number
        s_match = re.search(r"Serial(?:#| Number)?\s*[:\s]\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        # Parse Hardware Model
        h_match = re.search(r"HW:\s+([^\r\n]+)", output, re.IGNORECASE)
        if h_match:
            hardware_model = h_match.group(1).strip()
            if hardware_model.lower().startswith("stackable "):
                hardware_model = hardware_model[10:].strip()
            if hardware_model.lower().endswith(" switch"):
                hardware_model = hardware_model[:-7].strip()
        else:
            h_match = re.search(r"(ICX\d{3,4}(?:-[A-Za-z0-9\-]+)?)", output)
            if h_match:
                hardware_model = h_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model
        }
