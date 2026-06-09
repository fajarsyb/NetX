import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class HuaweiDriver(BaseDriver):
    name: str = "huawei"
    enterprise_oid: str = "1.3.6.1.4.1.2011"
    netmiko_device_type: str = "huawei"

    supports_cdp: bool = False
    supports_lldp: bool = True
    supports_arp: bool = True
    supports_routing: bool = True
    supports_mac_table: bool = True
    supports_backup: bool = True

    arp_command: str = "display arp"
    lldp_command: str = "display lldp neighbor brief"
    cdp_command: str = ""
    routing_command: str = "display ip routing-table"
    info_command: str = "display version"
    mac_table_command: str = "display mac-address"
    backup_command: str = "display current-configuration"

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = "VRP"
        v_match = re.search(r"Version\s+(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"Huawei\s+(\S+)", sys_descr, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1)
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str) -> Dict:
        os_version = ""
        serial_number = ""
        mac_address = ""
        hardware_model = ""

        # VRP version
        v_match = re.search(r"VRP.*?software,?\s+Version\s+(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)

        # Serial Number
        s_match = re.search(r"Equipment Serial Number\s*:\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        # Hardware Model
        m_match = re.search(r"Huawei\s+(\S+)\s+Routing", output, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1)
        else:
            m_match = re.search(r"Huawei\s+(\S+)\s+Switch", output, re.IGNORECASE)
            if m_match:
                hardware_model = m_match.group(1)

        # MAC Address
        mac_match = re.search(r"System MAC Address\s*:\s*([0-9a-fA-F\-]{14,17})", output, re.IGNORECASE)
        if mac_match:
            cleaned = re.sub(r"[\-:]", "", mac_match.group(1)).upper()
            if len(cleaned) == 12:
                mac_address = ":".join(cleaned[i:i+2] for i in range(0, 12, 2))

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model or "VRP Device"
        }
