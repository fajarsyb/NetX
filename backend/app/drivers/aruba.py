import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class ArubaDriver(BaseDriver):
    name: str = "aruba"
    enterprise_oid: str = "1.3.6.1.4.1.14823"
    netmiko_device_type: str = "aruba_os"

    supports_cdp: bool = True
    supports_lldp: bool = True
    supports_arp: bool = True
    supports_routing: bool = True
    supports_mac_table: bool = True
    supports_backup: bool = True

    arp_command: str = "show arp"
    lldp_command: str = "show lldp info remote-device"
    cdp_command: str = "show cdp neighbor"
    routing_command: str = "show ip route"
    info_command: str = "show version"
    mac_table_command: str = "show mac-address"
    backup_command: str = "show running-config"

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = "ArubaOS"
        v_match = re.search(r"Version\s+(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"Aruba\s+(\S+)", sys_descr, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1)
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str) -> Dict:
        os_version = ""
        serial_number = ""
        mac_address = ""
        hardware_model = ""

        # ArubaOS version
        v_match = re.search(r"ArubaOS\s+Version\s+(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        else:
            v_match = re.search(r"Version\s+(\S+)", output, re.IGNORECASE)
            if v_match:
                os_version = v_match.group(1)

        # Serial Number
        s_match = re.search(r"Serial Number\s*:\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        # Hardware Model
        m_match = re.search(r"Model\s*:\s*([^\r\n]+)", output, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1).strip()

        # MAC Address
        mac_match = re.search(r"System MAC\s*:\s*([0-9a-fA-F:]{17})", output, re.IGNORECASE)
        if mac_match:
            mac_address = mac_match.group(1).upper()

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model or "Aruba Device"
        }
