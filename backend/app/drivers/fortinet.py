import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class FortinetDriver(BaseDriver):
    name: str = "fortinet"
    enterprise_oid: str = "1.3.6.1.4.1.12356"
    netmiko_device_type: str = "fortinet"

    supports_cdp: bool = False
    supports_lldp: bool = True
    supports_arp: bool = True
    supports_routing: bool = True
    supports_mac_table: bool = False # FortiOS has get system arp / system physical interface tables instead of switch FDB
    supports_backup: bool = True

    arp_command: str = "get system arp"
    lldp_command: str = "get system lldp neighbors"
    cdp_command: str = ""
    routing_command: str = "get router info routing-table all"
    info_command: str = "get system status"
    mac_table_command: str = ""
    backup_command: str = "show"

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = "FortiGate"
        v_match = re.search(r"FortiOS\s+(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"FortiGate-(\S+)", sys_descr, re.IGNORECASE)
        if m_match:
            hardware_model = "FortiGate-" + m_match.group(1)
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str) -> Dict:
        os_version = ""
        serial_number = ""
        mac_address = ""
        hardware_model = ""

        # Version
        v_match = re.search(r"Version:\s*FortiGate-(\S+)\s+v([0-9a-zA-Z\.]+)", output, re.IGNORECASE)
        if v_match:
            hardware_model = "FortiGate-" + v_match.group(1)
            os_version = v_match.group(2)
        else:
            v_match = re.search(r"Version:\s*FortiGate\s+v?([0-9a-zA-Z\.]+)", output, re.IGNORECASE)
            if v_match:
                os_version = v_match.group(1)

        # Serial Number
        s_match = re.search(r"Serial-Number:\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        # MAC Address - Fortinet info output typically doesn't print system MAC on status, 
        # or prints branch MACs. We will fallback to a default empty or general parse.
        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model or "FortiGate"
        }
