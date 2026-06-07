"""
Multi-vendor CDP neighbor parser.
Each function returns a list of dicts:
  { local_port, neighbor_name, neighbor_ip, neighbor_platform, neighbor_port }
"""

import re
from typing import List, Dict

def _empty_neighbor() -> Dict:
    return {
        "local_port":        "",
        "neighbor_name":     "",
        "neighbor_ip":       "",
        "neighbor_platform": "",
        "neighbor_port":     "",
    }

def _cisco_cdp(output: str) -> List[Dict]:
    """show cdp neighbors detail — block-based parsing."""
    neighbors = []
    # Devices usually split neighbors by '-------------------------'
    blocks = re.split(r"-{10,}", output)
    
    # If no dashes, try splitting by 'Device ID:'
    if len(blocks) < 2:
        blocks = ["Device ID:" + b for b in output.split("Device ID:") if b.strip()]

    for block in blocks:
        if not block.strip():
            continue

        n = _empty_neighbor()

        # Device ID: SW-01.domain.com
        m = re.search(r"(?:Device ID|System Name):\s*([^\n]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_name"] = m.group(1).strip()

        # Entry address(es): \n  IP address: 192.168.1.1 / IPv4 Address: 192.168.1.1
        m = re.search(r"IP(?:v4)?\s+address:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
        if m:
            n["neighbor_ip"] = m.group(1)

        # Platform: cisco WS-C2960X-48TS-L,  Capabilities: Switch IGMP
        m = re.search(r"Platform:\s*([^\n,]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_platform"] = m.group(1).strip()

        # Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/24
        m = re.search(r"Interface:\s*([^\n,]+)", block, re.IGNORECASE)
        if m:
            n["local_port"] = m.group(1).strip()

        # Port ID (outgoing port): GigabitEthernet1/0/24 / Port ID: GigabitEthernet1/0/24
        m = re.search(r"Port ID(?:\s*\(outgoing port\))?:\s*([^\n,]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_port"] = m.group(1).strip()

        if n["local_port"] or n["neighbor_name"]:
            neighbors.append(n)

    return neighbors

def _clean_port(port_str: str) -> str:
    if not port_str:
        return ""
    port_str = port_str.strip().rstrip(",")
    # Strip logical subinterface/unit suffix (e.g., ge-0/0/0.0 -> ge-0/0/0, GigabitEthernet1/0/1.100 -> GigabitEthernet1/0/1, ae0.0 -> ae0)
    # Regex matches a dot followed by digits at the end of the string
    port_str = re.sub(r"\.\d+$", "", port_str)
    return port_str


def parse_cdp(output: str, device_type: str) -> List[Dict]:
    """Parse CDP neighbor output."""
    if not output or output.startswith("ERROR:"):
        return []
    
    # Basically all CDP is Cisco format since it's a Cisco proprietary protocol 
    # (even if emulated by Ruijie or HP)
    result = _cisco_cdp(output)

    # Post-process to ensure physical ports across all vendors
    for n in result:
        if "local_port" in n:
            n["local_port"] = _clean_port(n["local_port"])
        if "neighbor_port" in n:
            n["neighbor_port"] = _clean_port(n["neighbor_port"])
    return result
