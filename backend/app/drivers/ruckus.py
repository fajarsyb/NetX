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
    vlan_command: str = "show vlan"
    trunk_command: str = "show vlan"
    port_status_command: str = "show interfaces brief"

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if 'ICX7150-24' in m or 'ICX7550-24' in m:
            return 28
        return super().get_expected_port_count(model_str)

    def parse_show_interface_status(self, output: str, device_type: str = "") -> List[Dict]:
        interfaces = []
        if not output or output.startswith("ERROR:"):
            return interfaces
            
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "Port" in line_strip or line_strip.startswith("---"):
                continue
                
            tokens = line_strip.split()
            if len(tokens) < 8:
                continue
                
            port_raw = tokens[0]
            if not re.match(r"^\d+/\d+/\d+$", port_raw):
                continue
                
            ifname = f"GigabitEthernet{port_raw}"
            
            link_status = tokens[1].lower()
            status = 'up' if link_status == 'up' else 'down'
            admin_status = 'up'
            
            duplex_raw = tokens[3].lower()
            duplex = 'Full' if 'full' in duplex_raw else ('Half' if 'half' in duplex_raw else 'Auto')
            
            speed_raw = tokens[4].lower()
            speed_mbps = 0
            speed_str = "Auto/Unknown"
            if '10g' in speed_raw:
                speed_mbps = 10000
            elif '1g' in speed_raw:
                speed_mbps = 1000
            elif '100m' in speed_raw:
                speed_mbps = 100
            elif '10m' in speed_raw:
                speed_mbps = 10
                
            if speed_mbps > 0:
                if speed_mbps >= 1000:
                    speed_str = f"{speed_mbps / 1000:.0f} Gbps"
                else:
                    speed_str = f"{speed_mbps} Mbps"
                    
            pvid = tokens[7]
            
            interfaces.append({
                "name": ifname,
                "status": status,
                "admin_status": admin_status,
                "speed": speed_str,
                "speed_mbps": speed_mbps,
                "vlan": pvid,
                "duplex": duplex
            })
            
        return interfaces

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

    def parse_vlans(self, output: str, device_type: str = "") -> List[Dict]:
        vlans = []
        if not output or output.startswith("ERROR:"):
            return vlans
            
        current_vlan = None
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip:
                continue
                
            m = re.match(r"^PORT-VLAN\s+(\d+),\s+Name\s+([^,]+)", line_strip, re.IGNORECASE)
            if m:
                vlan_id = int(m.group(1))
                name = m.group(2).strip()
                if name == "[None]":
                    name = f"VLAN{vlan_id:04d}"
                    
                current_vlan = {
                    "vlan_id": vlan_id,
                    "name": name,
                    "status": "active",
                    "ports": []
                }
                vlans.append(current_vlan)
            else:
                if current_vlan:
                    m_ports = re.search(r"(?:Untagged|Tagged)\s+Ports:\s*(.*)", line_strip, re.IGNORECASE)
                    if m_ports:
                        ports_str = m_ports.group(1).strip()
                        if ports_str.lower() != "none":
                            matches = re.finditer(r"\(U(\d+)/M(\d+)\)\s+([\d\s]+)", ports_str)
                            for match in matches:
                                unit = match.group(1)
                                module = match.group(2)
                                ports_list = match.group(3).split()
                                for p in ports_list:
                                    current_vlan["ports"].append(f"GigabitEthernet{unit}/{module}/{p}")
                                    
        for v in vlans:
            v["ports"] = ",".join(v["ports"])
            
        return vlans

    def parse_trunks(self, output: str, device_type: str = "") -> List[Dict]:
        trunks = {}
        if not output or output.startswith("ERROR:"):
            return []
            
        current_vlan = None
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip:
                continue
                
            m = re.match(r"^PORT-VLAN\s+(\d+)", line_strip, re.IGNORECASE)
            if m:
                current_vlan = int(m.group(1))
            else:
                if current_vlan is not None:
                    # Untagged Ports (used to find native VLAN)
                    m_untagged = re.match(r"Untagged\s+Ports:\s*(.*)", line_strip, re.IGNORECASE)
                    if m_untagged:
                        ports_str = m_untagged.group(1).strip()
                        if ports_str.lower() != "none":
                            matches = re.finditer(r"\(U(\d+)/M(\d+)\)\s+([\d\s]+)", ports_str)
                            for match in matches:
                                unit = match.group(1)
                                module = match.group(2)
                                ports_list = match.group(3).split()
                                for p in ports_list:
                                    ifname = f"GigabitEthernet{unit}/{module}/{p}"
                                    if ifname not in trunks:
                                        trunks[ifname] = {
                                            "interface_name": ifname,
                                            "port_type": "Access",
                                            "native_vlan": str(current_vlan),
                                            "allowed_vlans": []
                                        }
                                    else:
                                        trunks[ifname]["native_vlan"] = str(current_vlan)
                                        
                    # Tagged Ports (indicate Trunk interface)
                    m_tagged = re.match(r"Tagged\s+Ports:\s*(.*)", line_strip, re.IGNORECASE)
                    if m_tagged:
                        ports_str = m_tagged.group(1).strip()
                        if ports_str.lower() != "none":
                            matches = re.finditer(r"\(U(\d+)/M(\d+)\)\s+([\d\s]+)", ports_str)
                            for match in matches:
                                unit = match.group(1)
                                module = match.group(2)
                                ports_list = match.group(3).split()
                                for p in ports_list:
                                    ifname = f"GigabitEthernet{unit}/{module}/{p}"
                                    if ifname not in trunks:
                                        trunks[ifname] = {
                                            "interface_name": ifname,
                                            "port_type": "Trunk",
                                            "native_vlan": "1",
                                            "allowed_vlans": [str(current_vlan)]
                                        }
                                    else:
                                        trunks[ifname]["port_type"] = "Trunk"
                                        trunks[ifname]["allowed_vlans"].append(str(current_vlan))
                                        
        res = []
        for ifname, t in trunks.items():
            if t["port_type"] == "Trunk":
                allowed = sorted(list(set(t["allowed_vlans"])), key=int)
                t["allowed_vlans"] = ",".join(allowed)
                res.append(t)
        return res
