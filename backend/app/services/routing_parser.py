"""
Multi-vendor Routing Table parser.
Returns a list of dicts:
  { destination, gateway, interface, protocol, metric }
"""

import re
from typing import List, Dict

def parse_routing(output: str, device_type: str) -> List[Dict]:
    """Parse Routing table output."""
    routes = []
    if not output or output.startswith("ERROR:"):
        return routes

    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device_type)
    if driver.name != "generic":
        try:
            res = driver.parse_routing(output, device_type)
            if res:
                return res
        except Exception:
            pass

    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith("Codes:") or line.startswith("Gateway"):
            continue

        # Cisco IOS style:
        # O   192.168.10.0/24 [110/2] via 10.0.0.1, 00:01:23, GigabitEthernet0/1
        # C   10.0.0.0/24 is directly connected, GigabitEthernet0/1
        # S*  0.0.0.0/0 [1/0] via 192.168.1.254
        
        # Match Destination Prefix: 192.168.10.0/24 or 192.168.10.0
        # This is a generic heuristic parser
        
        # First, try to find an IP prefix (destination)
        dest_match = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:/\d{1,2})?)", line)
        if not dest_match:
            continue
            
        destination = dest_match.group(1)
        
        # If it's just the subnet mask on the next line (some Cisco outputs wrap), we skip for simplicity
        # Protocol is usually the first letter(s)
        protocol = line.split()[0].upper()
        if protocol == destination: # if no protocol code at start
            protocol = "STATIC/DIRECT"
            
        gateway = ""
        interface = ""
        metric = ""

        # Find Gateway (via X.X.X.X)
        gw_match = re.search(r"via\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
        if gw_match:
            gateway = gw_match.group(1)
            
        # Find Metric ([110/2])
        metric_match = re.search(r"\[(\d+(?:/\d+)?)\]", line)
        if metric_match:
            metric = metric_match.group(1)
            
        # Find Interface (usually at the end of the line)
        # Match common interface names: GigabitEthernet, FastEthernet, eth0, vlan1, bridge, etc.
        intf_match = re.search(r"(?:,\s*|is directly connected,\s*)([A-Za-z]+[-]?\d+(?:/\d+)*(?:\.\d+)?)", line)
        if intf_match:
            interface = intf_match.group(1)
        elif "directly connected" in line:
            # Sometime it's just "is directly connected, Vlan10"
            parts = line.split(",")
            if len(parts) > 1:
                interface = parts[-1].strip()

        # If we found at least a destination, add it
        if destination:
            routes.append({
                "destination": destination,
                "gateway": gateway,
                "interface": interface,
                "protocol": protocol,
                "metric": metric
            })

    # Dedup by destination and gateway
    unique_routes = []
    seen = set()
    for r in routes:
        key = f"{r['destination']}-{r['gateway']}-{r['interface']}"
        if key not in seen:
            seen.add(key)
            unique_routes.append(r)

    return unique_routes
