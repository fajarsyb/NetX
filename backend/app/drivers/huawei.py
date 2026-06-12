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
    port_status_command: str = "display interface brief"
    vlan_command: str = "display vlan"
    trunk_command: str = "display port vlan"

    def parse_arp(self, output: str) -> List[Dict]:
        from app.services.arp_parser import _huawei
        return _huawei(output)

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

    def parse_show_interface_status(self, output: str) -> List[Dict]:
        """
        Parses 'display interface brief' output for Huawei VRP.
        """
        interfaces = []
        if not output or output.startswith("ERROR:"):
            return interfaces
            
        for line in output.splitlines():
            line = line.strip()
            if not line or "Interface" in line or "PHY" in line or line.startswith("---"):
                continue
                
            tokens = line.split()
            if len(tokens) < 3:
                continue
                
            ifname = tokens[0]
            if not self.is_physical_interface(ifname):
                continue
                
            phy_status = tokens[1].lower()
            
            admin_status = 'down' if '*down' in phy_status else 'up'
            status = 'up' if phy_status == 'up' else 'down'
            
            speed_str = "Auto/Unknown"
            speed_mbps = 0
            duplex = "Auto"
            
            if len(tokens) >= 7:
                speed_raw = tokens[5].lower()
                duplex_raw = tokens[6].lower()
                
                if '10g' in speed_raw:
                    speed_mbps = 10000
                elif '1g' in speed_raw or '1000m' in speed_raw:
                    speed_mbps = 1000
                elif '100m' in speed_raw:
                    speed_mbps = 10
                elif '10m' in speed_raw:
                    speed_mbps = 10
                
                if speed_mbps > 0:
                    if speed_mbps >= 1000:
                        speed_str = f"{speed_mbps / 1000:.0f} Gbps"
                    else:
                        speed_str = f"{speed_mbps} Mbps"
                        
                duplex = 'Full' if 'full' in duplex_raw else ('Half' if 'half' in duplex_raw else 'Auto')
                
            interfaces.append({
                "name": ifname,
                "status": status,
                "admin_status": admin_status,
                "speed": speed_str,
                "speed_mbps": speed_mbps,
                "vlan": "—",
                "duplex": duplex
            })
            
        return interfaces

    def parse_vlans(self, output: str, device_type: str = "") -> List[Dict]:
        vlans = []
        if not output or output.startswith("ERROR:"):
            return vlans
            
        current_vlan = None
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or line_strip.startswith("---") or "VLAN" in line_strip or "U:" in line_strip or "The total" in line_strip:
                continue
                
            tokens = line_strip.split()
            if tokens[0].isdigit():
                vlan_id = int(tokens[0])
                name = tokens[1]
                status = tokens[2]
                ports_part = tokens[3:]
                
                ports = []
                for p in ports_part:
                    p_clean = re.sub(r"^(?:TG:|UT:)", "", p)
                    p_clean = p_clean.split("(")[0].strip()
                    if p_clean:
                        ports.append(p_clean)
                        
                current_vlan = {
                    "vlan_id": vlan_id,
                    "name": name,
                    "status": "active" if "enable" in status.lower() else "inactive",
                    "ports": ports
                }
                vlans.append(current_vlan)
            else:
                if current_vlan:
                    for p in tokens:
                        p_clean = re.sub(r"^(?:TG:|UT:)", "", p)
                        p_clean = p_clean.split("(")[0].strip()
                        if p_clean:
                            current_vlan["ports"].append(p_clean)
                            
        for v in vlans:
            v["ports"] = ",".join(p for p in v["ports"] if self.is_physical_interface(p))
            
        return vlans

    def parse_trunks(self, output: str, device_type: str = "") -> List[Dict]:
        trunks = []
        if not output or output.startswith("ERROR:"):
            return trunks
            
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "Port" in line_strip or line_strip.startswith("---"):
                continue
                
            tokens = line_strip.split()
            if len(tokens) < 3:
                continue
                
            ifname = tokens[0]
            if not self.is_physical_interface(ifname):
                continue
                
            link_type = tokens[1].lower()
            pvid = tokens[2]
            
            allowed_list = ""
            if len(tokens) >= 4 and link_type == "trunk":
                allowed_part = tokens[3:]
                allowed_str = ",".join(allowed_part)
                allowed_list = allowed_str.replace(" ", ",").replace("-", "-")
                
            if link_type == "trunk":
                trunks.append({
                    "interface_name": ifname,
                    "port_type": "Trunk",
                    "native_vlan": pvid,
                    "allowed_vlans": allowed_list
                })
            
        return trunks
