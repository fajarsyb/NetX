import re
from typing import List, Dict
from app.drivers.base import BaseDriver

class JuniperDriver(BaseDriver):
    name: str = "juniper"
    enterprise_oid: str = "1.3.6.1.4.1.2636"
    netmiko_device_type: str = "juniper_junos"
    supports_cdp: bool = False

    # Commands
    arp_command: str = "show arp no-resolve"
    lldp_command: List[str] = ["show lldp neighbors", "show lldp neighbors detail"]
    cdp_command: str = ""
    routing_command: str = "show route protocol direct,static,ospf,bgp"
    info_command: List[str] = ["show version", "show chassis hardware", "show chassis mac-addresses"]
    mac_table_command: str = "show ethernet-switching table"
    backup_command: str = "show configuration | display set"
    port_status_command: str = "show interfaces terse"
    vlan_command: str = "show vlans"
    trunk_command: str = "show ethernet-switching interface"

    def get_expected_port_count(self, model_str: str) -> int:
        if not model_str:
            return 0
        m = model_str.upper()
        if 'EX3400-48' in m:
            return 54
        if 'EX3400-24' in m:
            return 30
        if 'EX4650-48Y-8C' in m:
            return 56
        return super().get_expected_port_count(model_str)

    def parse_arp(self, output: str) -> List[Dict]:
        from app.services.arp_parser import _juniper
        return _juniper(output)

    def parse_lldp(self, output: str) -> List[Dict]:
        from app.services.lldp_parser import _juniper_lldp
        return _juniper_lldp(output)

    def parse_routing(self, output: str) -> List[Dict]:
        routes = []
        if not output or output.startswith("ERROR:"):
            return routes
        # Parse Juniper routing table
        # Example format:
        # 10.0.0.0/24         *[Direct/0] 01:23:45
        #                    > via ge-0/0/0.0
        # 0.0.0.0/0           *[Static/5] 02:30:10
        #                    > to 192.168.1.254 via ge-0/0/1.0
        current_dest = ""
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "routing table" in line_strip:
                continue
            
            # Destination line
            m_dest = re.match(r"^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:/\d{1,2})?)\s+([\*\[].*)$", line)
            if m_dest:
                current_dest = m_dest.group(1)
                proto_match = re.search(r"\[([^\]]+)\]", m_dest.group(2))
                protocol = proto_match.group(1) if proto_match else "STATIC/DIRECT"
                metric = ""
                # metric inside proto like [Static/5] -> metric is 5
                if '/' in protocol:
                    parts = protocol.split('/')
                    protocol = parts[0]
                    metric = parts[1]
                routes.append({
                    "destination": current_dest,
                    "gateway": "",
                    "interface": "",
                    "protocol": protocol,
                    "metric": metric
                })
                continue
                
            # Next hop line
            if current_dest and line.startswith(">") or "via" in line:
                # e.g., > to 192.168.1.254 via ge-0/0/1.0 or > via ge-0/0/0.0
                m_via = re.search(r"via\s+(\S+)", line)
                interface = m_via.group(1) if m_via else ""
                
                m_to = re.search(r"to\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
                gateway = m_to.group(1) if m_to else ""
                
                # Update last route added if it matches current_dest and lacks fields
                if routes:
                    last_r = routes[-1]
                    if last_r["destination"] == current_dest:
                        last_r["gateway"] = gateway
                        last_r["interface"] = interface
        return routes

    def parse_mac_table(self, output: str) -> List[Dict]:
        from app.services.mac_parser import parse_mac_table
        return parse_mac_table(output, "juniper_junos")

    def parse_snmp_sys_descr(self, sys_descr: str) -> Dict:
        os_version = ""
        hardware_model = ""
        v_match = re.search(r"JUNOS\s+([0-9a-zA-Z\.\-\_]+)", sys_descr, re.IGNORECASE)
        if v_match:
            os_version = v_match.group(1)
        m_match = re.search(r"Inc\.\s+(\S+)", sys_descr, re.IGNORECASE)
        if m_match:
            hardware_model = m_match.group(1).upper()
        else:
            m_match = re.search(r"Networks,\s+Inc\.\s+([a-zA-Z0-9\-]+)", sys_descr)
            if m_match:
                hardware_model = m_match.group(1).upper()
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
                mac_match = re.search(r"Base address\s+([0-9a-fA-F:]{17})", output)
                if mac_match:
                    mac_address = mac_match.group(1).upper()

        # Junos Version
        v_match = re.search(r"Junos:\s*(\S+)", output)
        if v_match:
            os_version = v_match.group(1)
        else:
            v_match = re.search(r"kernel JUNOS\s*(\S+)", output)
            if v_match:
                os_version = v_match.group(1)

        # Model
        m_match = re.search(r"Model:\s*(\S+)", output)
        if m_match:
            hardware_model = m_match.group(1).upper()
        else:
            for line in output.splitlines():
                if "chassis" in line.lower() and not "description" in line.lower():
                    parts = line.split()
                    if len(parts) >= 2:
                        hardware_model = parts[-1].upper()
                        break

        # Serial Number
        for line in output.splitlines():
            if line.strip().startswith("Chassis"):
                parts = line.split()
                if len(parts) >= 2:
                    for p in parts[1:]:
                        if re.match(r"^[A-Z0-9]{8,20}$", p):
                            serial_number = p
                            break
                break
        if not serial_number:
            s_match = re.search(r"Chassis\s+\S+\s+(\S+)", output)
            if s_match:
                serial_number = s_match.group(1)

        return {
            "os_version": os_version,
            "serial_number": serial_number,
            "mac_address": mac_address,
            "hardware_model": hardware_model
        }

    def parse_show_interface_status(self, output: str) -> List[Dict]:
        """
        Parses 'show interfaces terse' output for Juniper.
        """
        interfaces = []
        if not output or output.startswith("ERROR:"):
            return interfaces
        
        for line in output.splitlines():
            line = line.strip()
            if not line or line.startswith("Interface") or line.startswith("---"):
                continue
            
            tokens = line.split()
            if len(tokens) < 3:
                continue
            
            ifname = tokens[0]
            # Only process physical interfaces
            if not self.is_physical_interface(ifname):
                continue
            
            admin_status_raw = tokens[1].lower()
            oper_status_raw = tokens[2].lower()
            
            admin_status = 'up' if admin_status_raw == 'up' else 'down'
            status = 'up' if oper_status_raw == 'up' else 'down'
            
            interfaces.append({
                "name": ifname,
                "status": status,
                "admin_status": admin_status,
                "speed": "Auto/Unknown",
                "speed_mbps": 0,
                "vlan": "—",
                "duplex": "Auto"
            })
            
        return interfaces

    def parse_vlans(self, output: str, device_type: str = "") -> List[Dict]:
        vlans = []
        if not output or output.startswith("ERROR:"):
            return vlans
            
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "Routing instance" in line_strip or "Name" in line_strip or line_strip.startswith("---"):
                continue
                
            tokens = line_strip.split()
            if len(tokens) < 2:
                continue
                
            name = tokens[0]
            tag_str = tokens[1]
            if not tag_str.isdigit():
                continue
                
            vlan_id = int(tag_str)
            ports_part = "".join(tokens[2:]) if len(tokens) >= 3 else ""
            
            ports = []
            for p in ports_part.replace(",", " ").split():
                p_clean = p.replace("*", "").split(".")[0].strip()
                if p_clean:
                    ports.append(p_clean)
                    
            vlans.append({
                "vlan_id": vlan_id,
                "name": name,
                "status": "active",
                "ports": ",".join(ports)
            })
        return vlans

    def parse_trunks(self, output: str, device_type: str = "") -> List[Dict]:
        trunks = {}
        if not output or output.startswith("ERROR:"):
            return []
            
        current_interface = None
        for line in output.splitlines():
            line_strip = line.strip()
            if not line_strip or "Routing Instance" in line_strip or line_strip.startswith("---"):
                continue
                
            tokens = line_strip.split()
            if not line.startswith(" ") and len(tokens) >= 2:
                ifname_raw = tokens[0]
                if "." in ifname_raw:
                    ifname = ifname_raw.split(".")[0]
                else:
                    ifname = ifname_raw
                    
                if ifname.lower() in ('logical', 'interface', 'tagging', 'routing', 'vlan', 'total', 'members', 'routing-instance', 'default-switch'):
                    continue
                    
                if not self.is_physical_interface(ifname):
                    current_interface = None
                    continue
                    
                current_interface = ifname
                is_tagged = any(t.lower() == "tagged" for t in tokens[1:])
                
                if ifname not in trunks:
                    trunks[ifname] = {
                        "interface_name": ifname,
                        "port_type": "Trunk" if is_tagged else "Access",
                        "native_vlan": "1",
                        "allowed_vlans": [],
                        "tagged_vlans": []
                    }
                elif is_tagged:
                    trunks[ifname]["port_type"] = "Trunk"
                    
            elif line.startswith(" ") and len(tokens) >= 2:
                if current_interface and current_interface in trunks:
                    vlan_name = tokens[0]
                    vlan_tag = tokens[1]
                    if vlan_tag.isdigit():
                        tag = vlan_tag
                        is_tagged_member = any(t.lower() == "tagged" for t in tokens[2:])
                        if is_tagged_member:
                            trunks[current_interface]["port_type"] = "Trunk"
                            trunks[current_interface]["tagged_vlans"].append(tag)
                        else:
                            trunks[current_interface]["native_vlan"] = tag
                            
        res = []
        for ifname, info in trunks.items():
            if info["port_type"] == "Trunk":
                allowed = sorted(list(set(info["tagged_vlans"])), key=int)
                info["allowed_vlans"] = ",".join(allowed)
                del info["tagged_vlans"]
                res.append(info)
            
        return res
