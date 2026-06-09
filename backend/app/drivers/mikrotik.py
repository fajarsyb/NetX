import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class MikroTikDriver(BaseDriver):
    name: str = "mikrotik"
    enterprise_oid: str = "1.3.6.1.4.1.14988"
    netmiko_device_type: str = "mikrotik_routeros"

    supports_cdp: bool = False
    supports_lldp: bool = True
    supports_arp: bool = True
    supports_routing: bool = True
    supports_mac_table: bool = True
    supports_backup: bool = True

    arp_command: str = "/ip arp print without-paging"
    lldp_command: str = "/ip neighbor print without-paging"
    cdp_command: str = ""
    routing_command: str = "/ip route print without-paging"
    info_command: str = "/system resource print; /system routerboard print; /interface ethernet print without-paging"
    mac_table_command: str = "/interface ethernet switch unicast-fdb print without-paging"
    backup_command: str = "/export"

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = "RouterOS"
        v_match = re.search(r"RouterOS\s+(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        return {"os_version": os_version, "hardware_model": hardware_model}

    def parse_info(self, output: str) -> Dict:
        os_version = ""
        serial_number = ""
        mac_address = ""
        hardware_model = ""

        # RouterOS version
        v_match = re.search(r"version:\s*(\S+)", output, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)

        # Serial Number
        s_match = re.search(r"serial-number:\s*(\S+)", output, re.IGNORECASE)
        if s_match:
            serial_number = s_match.group(1)

        # Hardware Model
        m_match = re.search(r"board-name:\s*([^\r\n]+)", output, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1).strip()
        else:
            m_match = re.search(r"model:\s*([^\r\n]+)", output, re.IGNORECASE)
            if m_match:
                hardware_model = m_match.group(1).strip()

        # MAC Address
        mac_match = re.search(r"mac-address=([0-9a-fA-F:]{17})", output, re.IGNORECASE)
        if mac_match:
            mac_address = mac_match.group(1).upper()

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model or "RouterBoard"
        }
