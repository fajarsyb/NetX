import re
from typing import List, Dict

# Regular expression to match various MAC formats:
# 1. 00:11:22:33:44:55 / 00-11-22-33-44-55
# 2. 0011.2233.4455
MAC_RE = re.compile(
    r'(?:[0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})|'
    r'(?:[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})'
)

def _normalize_mac(mac_str: str) -> str:
    cleaned = mac_str.replace('.', '').replace(':', '').replace('-', '').upper()
    if len(cleaned) == 12:
        return ":".join(cleaned[i:i+2] for i in range(0, 12, 2))
    return mac_str.upper()

def parse_mac_table(output: str, device_type: str) -> List[Dict]:
    """
    Parses MAC address table CLI output and returns a list of dictionaries:
    [
      { "vlan": "1701", "mac_address": "00:25:AB:90:43:BD", "entry_type": "dynamic", "interface": "TenGigabitEthernet 0/25" }
    ]
    """
    if not output or output.startswith("ERROR:") or "% Invalid" in output:
        return []

    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device_type)
    if driver.name != "generic":
        try:
            res = driver.parse_mac_table(output, device_type)
            if res:
                return res
        except Exception:
            pass

    entries = []
    lines = output.splitlines()

    # Allied Telesis AW+ specific format handling:
    # Vlan    Mac Address       Port       Type      Remaining Life
    # ----    -----------       ----       ----      --------------
    # 1       001a.eb12.3456    port1.0.1  dynamic   300
    if device_type in ("allied_telesis", "allied_telesis_awplus"):
        for line in lines:
            line_strip = line.strip()
            # Skip headers (avoid substring matching of words like 'port' or 'fwd' that appear in valid data rows)
            if not line_strip or "----" in line_strip or line_strip.lower().startswith("vlan port") or line_strip.lower().startswith("vlan   ") or line_strip.lower().startswith("vlan\t"):
                continue
            # Search for a MAC address in the line
            match = MAC_RE.search(line_strip)
            if not match:
                continue
            tokens = line_strip.split()
            if len(tokens) >= 4:
                # Format 1: VLAN MAC PORT TYPE [REMAINING_LIFE]
                if MAC_RE.search(tokens[1]):
                    vlan = tokens[0]
                    mac = _normalize_mac(tokens[1])
                    port = tokens[2]
                    etype = tokens[3].lower()
                    if etype not in ("dynamic", "static"):
                        etype = "dynamic"
                    entries.append({
                        "vlan": vlan,
                        "mac_address": mac,
                        "entry_type": etype,
                        "interface": port
                    })
                # Format 2: VLAN PORT MAC [ACTION] TYPE
                elif len(tokens) >= 4 and MAC_RE.search(tokens[2]):
                    vlan = tokens[0]
                    port = tokens[1]
                    mac = _normalize_mac(tokens[2])
                    if len(tokens) >= 5:
                        etype = tokens[4].lower()
                    else:
                        etype = tokens[3].lower()
                    if etype not in ("dynamic", "static"):
                        etype = "dynamic"
                    entries.append({
                        "vlan": vlan,
                        "mac_address": mac,
                        "entry_type": etype,
                        "interface": port
                    })
        return entries

    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
            
        # Search for a MAC address in the line
        match = MAC_RE.search(line_strip)
        if not match:
            continue

        raw_mac = match.group(0)
        norm_mac = _normalize_mac(raw_mac)

        # Tokenize line
        tokens = line_strip.split()
        if len(tokens) < 2:
            continue

        # Find the MAC token index
        mac_idx = -1
        for i, t in enumerate(tokens):
            if MAC_RE.search(t):
                mac_idx = i
                break

        if mac_idx == -1:
            continue

        # 1. VLAN
        # Usually tokens before MAC are VLAN (or VLAN ID)
        vlan = ""
        if mac_idx > 0:
            vlan = " ".join(tokens[:mac_idx])
            # If VLAN is just some header-like words, clean it
            if vlan.lower() in ("vlan", "name", "vlan/bd"):
                vlan = "1"
        else:
            vlan = "1"

        # 2. Entry Type
        # Check tokens after MAC to find type
        entry_type = "dynamic"
        rem_tokens = tokens[mac_idx+1:]
        type_token = ""
        
        # In some vendors (like Cisco/Ruijie), the token after MAC is the type (DYNAMIC, STATIC)
        # In Juniper, it might be a flag (D, S)
        # In Ruckus, the format might be different
        if rem_tokens:
            for t in rem_tokens:
                t_lower = t.lower()
                if t_lower in ("dynamic", "static", "d", "s", "learned", "l", "p", "permanent"):
                    type_token = t_lower
                    break

        if type_token:
            if type_token in ("dynamic", "d", "learned", "l"):
                entry_type = "dynamic"
            elif type_token in ("static", "s", "permanent", "p"):
                entry_type = "static"

        # 3. Interface
        # Usually the interface name is at the end of the line, or after the type token.
        # Let's locate the interface name.
        # In Juniper, we have: VLAN MAC FLAGS AGE INTERFACE
        # e.g. ['Biro-Umu', '80:db:17:cd:78:81', 'D', '-', 'ae0.0']
        # In Cisco: ['1', '0010.7b1e.e4a7', 'DYNAMIC', 'Fa0/1']
        # In Ruijie: ['1701', '0025.ab90.43bd', 'DYNAMIC', 'TenGigabitEthernet', '0/25']
        
        interface = ""
        # Filter out obvious non-interface tokens from the end
        # Like age or timestamps in Ruijie: '2026-6-3', '8:06:28'
        clean_rem = []
        for t in rem_tokens:
            # Skip age markers, flags like '-', and timestamps
            if t in ("-", "sec") or re.match(r'^\d{4}-\d{1,2}-\d{1,2}$', t) or re.match(r'^\d{1,2}:\d{2}:\d{2}$', t):
                continue
            if t.lower() in ("dynamic", "static", "d", "s", "learned", "l", "p", "permanent"):
                continue
            clean_rem.append(t)

        if clean_rem:
            interface = " ".join(clean_rem)
        else:
            # Fallback to last token if nothing left
            interface = tokens[-1]

        # Clean interface name from any leading/trailing commas or brackets
        interface = interface.strip(" ,()[]{}")
        
        # Discard trailing space-separated integers/flags for Juniper interfaces (e.g. "ge-0/0/5.0 0 0" -> "ge-0/0/5.0")
        if interface and any(interface.lower().startswith(p) for p in ("ge-", "xe-", "et-", "ae", "vtep", "irb", "fxp", "em", "me", "lo", "vlan")):
            interface = interface.split()[0]
            
        vlan = vlan.strip(" ,()[]{}")

        # Ignore entries where the interface is just a dash or empty
        if not interface or interface == "-":
            continue

        entries.append({
            "vlan": vlan,
            "mac_address": norm_mac,
            "entry_type": entry_type,
            "interface": interface
        })

    return entries
