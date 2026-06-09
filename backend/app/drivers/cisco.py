import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class CiscoDriver(BaseDriver):
    name: str = "cisco"
    enterprise_oid: str = "1.3.6.1.4.1.9"
    netmiko_device_type: str = "cisco_ios"

    # Commands
    arp_command: str = "show ip arp"
    lldp_command: List[str] = ["show lldp neighbors", "show lldp neighbors detail"]
    cdp_command: List[str] = ["show cdp neighbors", "show cdp neighbors detail"]
    routing_command: str = "show ip route"
    info_command: str = "show version"
    mac_table_command: str = "show mac address-table"
    backup_command: str = "show running-config"

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if 'C9200-48' in m or '2960X-48' in m or '2960-48' in m:
            return 52
        if 'C9200-24' in m or '2960X-24' in m or '2960-24' in m:
            return 28
        return super().get_expected_port_count(model_str)

    def parse_arp(self, output: str) -> List[Dict]:
        entries = []
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "Address" in line_strip or "MAC Address" in line_strip:
                continue

            # Cisco IOS: Internet  192.168.1.1             0   0011.2233.4455  ARPA  GigabitEthernet1
            m_ios = re.match(
                r"\s*Internet\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+|-)\s+"
                r"([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+\w+\s+(\S+)",
                line,
            )
            if m_ios:
                age_raw = m_ios.group(2)
                age = 0 if age_raw == "-" else int(age_raw)
                etype = "static" if age_raw == "-" else "dynamic"
                entries.append({"ip": m_ios.group(1), "mac": self._norm_mac(m_ios.group(3)),
                                "interface": m_ios.group(4), "entry_type": etype, "age": age})
                continue

            # Cisco NX-OS: 192.168.1.1     00:10:00  0011.2233.4455   Ethernet1/1
            m_nxos = re.match(
                r"\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{8}|[\d:]+|-)\s+"
                r"([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\S+)",
                line,
            )
            if m_nxos:
                age_raw = m_nxos.group(2)
                etype = "static" if age_raw == "-" else "dynamic"
                age = 0
                if age_raw != "-" and ":" in age_raw:
                    try:
                        parts = age_raw.split(":")
                        if len(parts) == 3:
                            age = int(parts[0]) * 60 + int(parts[1])
                    except:
                        pass
                entries.append({"ip": m_nxos.group(1), "mac": self._norm_mac(m_nxos.group(3)),
                                "interface": m_nxos.group(4), "entry_type": etype, "age": age})
                continue

            # Cisco ASA: outside 192.168.1.1 aabb.cc00.0100 43
            m_asa = re.match(
                r"\s*(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\d+)",
                line,
            )
            if m_asa:
                entries.append({"ip": m_asa.group(2), "mac": self._norm_mac(m_asa.group(3)),
                                "interface": m_asa.group(1), "entry_type": "dynamic", "age": int(m_asa.group(4))})

        return entries

    def parse_lldp(self, output: str) -> List[Dict]:
        from app.services.lldp_parser import _cisco_lldp
        return _cisco_lldp(output)

    def parse_cdp(self, output: str) -> List[Dict]:
        from app.services.cdp_parser import _cisco_cdp
        return _cisco_cdp(output)

    def parse_routing(self, output: str) -> List[Dict]:
        from app.services.routing_parser import parse_routing
        return parse_routing(output, "cisco_ios")

    def parse_mac_table(self, output: str) -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, "cisco_ios")

    def parse_show_interface_status(self, output: str) -> List[Dict]:
        # Reuse existing implementation
        from app.routers.snmp import parse_show_interface_status
        # Note: calling this directly works because we delegate to it.
        # However, to avoid circular import issues if snmp.py calls us, we can duplicate the parser logic here or implement it.
        # Let's implement it directly to avoid any circular imports, keeping the code fully SOLID and isolated.
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
        v_match = re.search(r"Version\s+([0-9a-zA-Z\.\(\)\-\_]+)", sys_descr)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"Software,\s+(\S+)\s+Software", sys_descr)
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

        # OS Version
        v_match = re.search(r"Version\s+([0-9a-zA-Z\.\(\)\-\_]+)", output)
        if v_match:
            os_version = v_match.group(1)

        # Serial Number
        s_match = re.search(r"System Serial Number\s*:\s*(\S+)", output)
        if s_match:
            serial_number = s_match.group(1)
        else:
            s_match = re.search(r"Processor board ID\s+(\S+)", output)
            if s_match:
                serial_number = s_match.group(1)

        # Hardware Model
        h_match = re.search(r"Model [nN]umber\s*:\s*(\S+)", output)
        if h_match:
            hardware_model = h_match.group(1)
        else:
            h_match = re.search(r"cisco\s+(\S+)\s+processor", output, re.IGNORECASE)
            if h_match:
                hardware_model = h_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model
        }
