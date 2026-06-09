import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class RuijieDriver(BaseDriver):
    name: str = "ruijie"
    enterprise_oid: str = "1.3.6.1.4.1.4881"
    netmiko_device_type: str = "ruijie_os"

    # Commands
    arp_command: str = "show arp"
    lldp_command: List[str] = ["show lldp neighbor", "show lldp neighbor detail"]
    cdp_command: List[str] = ["show cdp neighbors", "show cdp neighbors detail"]
    routing_command: str = "show ip route"
    info_command: str = "show version"
    mac_table_command: str = "show mac-address-table"
    backup_command: str = "show running-config"

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if 'S2910-24' in m:
            return 28
        return super().get_expected_port_count(model_str)

    def parse_arp(self, output: str) -> List[Dict]:
        entries = []
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "IP Address" in line_strip or "MAC Address" in line_strip:
                continue
            # Ruijie format:
            # 192.168.1.1      0025.ab90.43bd  Vlan 1701  GigabitEthernet 0/25  Dynamic   20
            # 10.7.17.66       0023.5ad6.179f  Vlan 1701  GigabitEthernet 0/1   Static    -
            tokens = line_strip.split()
            if len(tokens) >= 5:
                ip = tokens[0]
                if not re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", ip):
                    continue
                mac_raw = tokens[1]
                mac_clean = re.sub(r"[.\-:]", "", mac_raw)
                if len(mac_clean) != 12:
                    continue
                mac = self._norm_mac(mac_raw)
                
                # Check for Vlan token
                if tokens[2].lower() == "vlan":
                    # next tokens contain vlan number, then interface (which might be split like GigabitEthernet 0/1)
                    vlan_val = tokens[3]
                    rem = tokens[4:]
                else:
                    vlan_val = ""
                    rem = tokens[2:]
                
                if not rem:
                    continue
                
                etype = rem[-2].lower() if len(rem) >= 2 else "dynamic"
                age_val = rem[-1]
                age = 0
                if age_val != "-" and age_val.isdigit():
                    age = int(age_val)
                
                # Interface is whatever is left before etype
                interface = " ".join(rem[:-2]) if len(rem) >= 3 else rem[0]
                interface = interface.strip()
                
                if etype not in ("dynamic", "static"):
                    etype = "dynamic"
                    
                entries.append({
                    "ip": ip,
                    "mac": mac,
                    "interface": interface,
                    "entry_type": etype,
                    "age": age
                })
        if not entries:
            # Fallback to generic regex matcher
            from app.services.arp_parser import _generic
            return _generic(output)
        return entries

    def parse_lldp(self, output: str) -> List[Dict]:
        from app.services.lldp_parser import _ruijie_lldp
        return _ruijie_lldp(output)

    def parse_cdp(self, output: str) -> List[Dict]:
        from app.services.cdp_parser import _cisco_cdp
        return _cisco_cdp(output)

    def parse_routing(self, output: str) -> List[Dict]:
        from app.services.routing_parser import parse_routing
        return parse_routing(output, "ruijie_os")

    def parse_mac_table(self, output: str) -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, "ruijie_os")

    def parse_show_interface_status(self, output: str) -> List[Dict]:
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
            first = tokens[0].lower()
            if_name = tokens[0]
            rem = tokens[1:]
            is_if_prefix = any(first.startswith(p) for p in (
                'gigabitethernet', 'fastethernet', 'tengigabitethernet', 'ethernet', 
                'twentyfivegige', 'fortygigabitethernet', 'hundredgigabitethernet', 'sfp', 'qsfp'
            ))
            if is_if_prefix and len(tokens) >= 3:
                second = tokens[1]
                if re.match(r"^\d+([\/\:\.\-]\d+)*$", second):
                    if_name = tokens[0] + tokens[1]
                    rem = tokens[2:]
            if not self.is_physical_interface(if_name):
                continue
            if len(rem) < 2:
                continue
            status_raw = rem[0].lower()
            if 'connected' in status_raw or 'up' in status_raw or 'active' in status_raw:
                status = 'up'
                admin_status = 'up'
            elif 'disabled' in status_raw or 'disable' in status_raw:
                status = 'down'
                admin_status = 'down'
            else:
                status = 'down'
                admin_status = 'up'
            vlan = rem[1]
            duplex = 'Auto'
            speed_str = 'Auto/Unknown'
            speed_mbps = 0
            if len(rem) >= 4:
                duplex = rem[2]
                speed_raw = rem[3].lower()
                speed_match = re.search(r'(?:a-)?(\d+)(g|m)?', speed_raw)
                if speed_match:
                    val = int(speed_match.group(1))
                    unit = speed_match.group(2)
                    if unit == 'g' or (val in (10, 25, 40, 100) and val < 1000):
                        speed_mbps = val * 1000
                    else:
                        speed_mbps = val
                elif '10g' in speed_raw:
                    speed_mbps = 10000
                elif '40g' in speed_raw:
                    speed_mbps = 40000
                elif '100g' in speed_raw:
                    speed_mbps = 100000
                elif '1000' in speed_raw:
                    speed_mbps = 1000
                elif '100' in speed_raw:
                    speed_mbps = 100
                elif '10' in speed_raw:
                    speed_mbps = 10
                if speed_mbps >= 1000:
                    speed_str = f"{speed_mbps / 1000:.1f} Gbps".replace('.0 ', ' ')
                elif speed_mbps > 0:
                    speed_str = f"{speed_mbps} Mbps"
            interfaces.append({
                "name": if_name,
                "status": status,
                "admin_status": admin_status,
                "speed": speed_str,
                "speed_mbps": speed_mbps,
                "vlan": vlan,
                "duplex": duplex
            })
        return interfaces

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = ""
        m_match = re.search(r"\(([^)]+)\)", sys_descr)
        if m_match:
            hardware_model = m_match.group(1)
        v_match = re.search(r"Version\s*[:\s]\s*(\S+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
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

        # Serial Number
        s_match = re.search(r"System serial number\s*:\s*(\S+)", output)
        if s_match:
            serial_number = s_match.group(1)
        else:
            s_match = re.search(r"Serial number\s*:\s*(\S+)", output)
            if s_match:
                serial_number = s_match.group(1)

        # OS Version
        v_match = re.search(r"System software version\s*:\s*([^\n]+)", output)
        if v_match:
            os_version = v_match.group(1).strip()
            os_version = os_version.replace("S29_RGOS", "").strip()

        # Model
        m_match = re.search(r"Slot 0\s*:\s*(\S+)", output)
        if m_match:
            hardware_model = m_match.group(1)
        else:
            m_match = re.search(r"System description\s*:\s*Ruijie.*?Switch.*?\(([^)]+)\)", output, re.IGNORECASE)
            if m_match:
                hardware_model = m_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model
        }
