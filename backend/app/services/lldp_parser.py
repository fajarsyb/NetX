"""
Multi-vendor LLDP neighbor parser.
Each vendor function returns a list of dicts:
  { local_port, neighbor_name, neighbor_ip, neighbor_mac, neighbor_platform, neighbor_port }
"""

import re
from typing import List, Dict


def _norm_mac(mac: str) -> str:
    clean = re.sub(r"[:\-\.\s]", "", mac).upper()
    if len(clean) != 12:
        return mac.upper()
    return ":".join(clean[i:i+2] for i in range(0, 12, 2))


def _empty_neighbor() -> Dict:
    return {
        "local_port":        "",
        "neighbor_name":     "",
        "neighbor_ip":       "",
        "neighbor_mac":      "",
        "neighbor_platform": "",
        "neighbor_port":     "",
    }


def _strip_quotes(s: str) -> str:
    """Remove surrounding quotes from a string (Cisco/Ruckus sometimes wraps values in double quotes)."""
    return s.strip().strip('"').strip("'")


def _looks_like_physical_port(s: str) -> bool:
    """Return True if s looks like a physical port name (not a MAC address)."""
    if not s:
        return False
    s_lower = s.lower()
    # If it is a MAC address (12 hex chars after stripping separators), it is NOT a port name
    clean_hex = re.sub(r"[:\-.]", "", s_lower)
    if len(clean_hex) == 12 and all(c in "0123456789abcdef" for c in clean_hex):
        return False
    # If it matches typical port structures:
    if re.search(r"\d+/\d+", s):
        return True
    if re.match(r"^(ge|xe|et|ae|fe|gi|te|fa|eth|port|int|ethernet|fast|gig|gigabit)\d+", s_lower):
        return True
    if re.match(r"^[a-z]+\d+$", s_lower):
        return True
    return False


# ─── CISCO IOS/XE/NXOS ───────────────────────────────────────────────────────
def _cisco_lldp(output: str) -> List[Dict]:
    """show lldp neighbors detail — block-based parsing.

    Handles two Cisco block formats:
    1. Separated by dash lines: ------------------------------------------------
    2. Each block starts with 'Local Intf:' or 'Local port:' (fallback)
    """
    neighbors = []
    blocks = re.split(r"-{4,}", output)
    if len(blocks) < 2:
        # Fallback: split on Local Intf / Local port markers
        blocks = []
        for part in re.split(r"(?=(?:Local Intf|Local port)\s*:)", output, flags=re.IGNORECASE):
            if part.strip():
                blocks.append(part)

    for block in blocks:
        if not block.strip() or "LLDP neighbor info" in block:
            continue

        n = _empty_neighbor()

        # Match both 'Local Intf:' (Cisco IOS/XE) and 'Local port:' (some IOS versions)
        m = re.search(r"(?:Local Intf|Local port)\s*:\s*(\S+)", block, re.IGNORECASE)
        if m:
            n["local_port"] = m.group(1)

        m = re.search(r"System Name:\s*([^\n]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_name"] = _strip_quotes(m.group(1))

        m = re.search(r"Port id:\s*(\S+)", block, re.IGNORECASE)
        if m:
            n["neighbor_port"] = _strip_quotes(m.group(1))

        m = re.search(r"(?:IP|IPv4|Address):\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
        if m:
            n["neighbor_ip"] = m.group(1)

        m = re.search(r"Chassis id:\s*(\S+)", block, re.IGNORECASE)
        if m:
            n["neighbor_mac"] = _norm_mac(m.group(1))

        # System Description: skip 'Technical Support' lines
        m = re.search(r"System Description:\s*\n?\s*(.+)", block, re.IGNORECASE)
        if m:
            desc = m.group(1).strip()
            if not desc.lower().startswith("technical support"):
                n["neighbor_platform"] = _strip_quotes(desc)[:120]

        if n["local_port"] or n["neighbor_name"]:
            neighbors.append(n)

    # ── Backfill local_port from brief table (Cisco 2960 style) ──────────────
    # Old Cisco IOS detail blocks lack 'Local Intf:'. Read the brief summary
    # table to map Device-ID prefix → Local Intf using FIXED COLUMN OFFSETS.
    # Cisco 2960 truncates Device ID so DeviceID+LocalIntf merge without space:
    #   "Device ID           Local Intf     Hold-time  ..."
    #   "BAS-PUSDATIN-00-BaseGi0/48         120        ..."
    if neighbors and any(not n["local_port"] for n in neighbors):
        brief_map: Dict[str, str] = {}  # lowercase dev_id prefix -> local_intf
        header_line = None
        in_brief = False
        for line in output.splitlines():
            ls = line.strip()
            if re.search(r"device.?id", ls, re.IGNORECASE) and re.search(r"local.?intf", ls, re.IGNORECASE):
                header_line = line  # keep original (unstripped) for offset
                in_brief = True
                continue
            if in_brief and (not ls or re.match(r"total entries", ls, re.IGNORECASE)):
                in_brief = False
                continue
            if in_brief and header_line and ls and "---" not in ls:
                # Determine column offsets from the header
                h_lower = header_line.lower()
                idx_dev   = h_lower.find("device")
                idx_intf  = h_lower.find("local")
                idx_hold  = h_lower.find("hold")
                if idx_dev == -1 or idx_intf == -1:
                    continue
                padded = line.ljust(max(idx_hold + 10 if idx_hold != -1 else 60, len(line)))
                dev_id_raw  = padded[idx_dev:idx_intf].strip().lower()
                local_intf  = padded[idx_intf:idx_hold].strip() if idx_hold != -1 else padded[idx_intf:idx_intf+16].strip()
                if dev_id_raw and local_intf:
                    brief_map[dev_id_raw] = local_intf

        for n in neighbors:
            if not n["local_port"]:
                n_name_lower = n["neighbor_name"].lower()
                for key, intf in brief_map.items():
                    if key and n_name_lower and (
                        n_name_lower.startswith(key[:15]) or
                        key.startswith(n_name_lower[:15])
                    ):
                        n["local_port"] = intf
                        break

    return neighbors


# ─── RUCKUS FASTIRON ─────────────────────────────────────────────────────────
def _ruckus_lldp(output: str) -> List[Dict]:
    """show lldp neighbors detail — Ruckus/Brocade FastIron format.

    Format:
        Local port: 1/1/5
          Neighbor: 0023.5ad6.179f, TTL 3135 seconds
            + Chassis ID (MAC address): 0023.5ad6.179f
            + Port ID (locally assigned): 808399104
            + Port description    : "0/1"
            + System name         : "UBNT"
            + System description  : "USW-8P-150, ..."
            + Management address (IPv4): 10.7.17.66
    """
    neighbors = []
    # Split on 'Local port:' lines
    blocks = re.split(r"(?=^\s*Local port\s*:)", output, flags=re.IGNORECASE | re.MULTILINE)
    for block in blocks:
        if not block.strip():
            continue

        m = re.search(r"Local port\s*:\s*(\S+)", block, re.IGNORECASE)
        if not m:
            continue

        n = _empty_neighbor()
        n["local_port"] = m.group(1).strip()

        m = re.search(r"Chassis ID.*?:\s*(\S+)", block, re.IGNORECASE)
        if m:
            n["neighbor_mac"] = _norm_mac(m.group(1))

        m = re.search(r"System name\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_name"] = _strip_quotes(m.group(1))

        m = re.search(r"System description\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if m:
            raw_desc = _strip_quotes(m.group(1))
            # Ruckus wraps long descriptions with backslash continuation — collapse them
            raw_desc = re.sub(r"\\+\s*", " ", raw_desc).strip()
            n["neighbor_platform"] = raw_desc[:120]

        m = re.search(r"Management address.*?IPv4.*?:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
        if m:
            n["neighbor_ip"] = m.group(1)

        # Port: prefer Port description if it looks physical, else Port ID
        port_id_val = ""
        m_port = re.search(r"Port ID.*?:\s*([^\n]+)", block, re.IGNORECASE)
        if m_port:
            port_id_val = _strip_quotes(m_port.group(1)).strip()

        port_desc_val = ""
        m_desc = re.search(r"Port description\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if m_desc:
            port_desc_val = _strip_quotes(m_desc.group(1)).strip()

        if _looks_like_physical_port(port_id_val):
            n["neighbor_port"] = port_id_val
        elif _looks_like_physical_port(port_desc_val):
            n["neighbor_port"] = port_desc_val
        else:
            n["neighbor_port"] = port_desc_val if port_desc_val else port_id_val

        neighbors.append(n)

    return neighbors


# ─── MIKROTIK ────────────────────────────────────────────────────────────────
def _mikrotik_lldp(output: str) -> List[Dict]:
    """/ip neighbor print detail"""
    neighbors = []
    blocks = re.split(r"\n\s*\n", output.strip())

    for block in blocks:
        if not block.strip():
            continue
        n = _empty_neighbor()

        m = re.search(r"interface=(\S+)", block)
        if m:
            n["local_port"] = m.group(1)

        m = re.search(r"address=(\d+\.\d+\.\d+\.\d+)", block)
        if m:
            n["neighbor_ip"] = m.group(1)

        m = re.search(r"mac-address=([0-9A-Fa-f:]+)", block)
        if m:
            n["neighbor_mac"] = _norm_mac(m.group(1))

        m = re.search(r'identity="?([^"\n]+)"?', block)
        if m:
            n["neighbor_name"] = m.group(1).strip()

        m = re.search(r'platform="?([^"\n]+)"?', block)
        if m:
            n["neighbor_platform"] = m.group(1).strip()

        m = re.search(r'interface-name=(\S+)', block)
        if m:
            n["neighbor_port"] = m.group(1)

        if n["local_port"] or n["neighbor_ip"]:
            neighbors.append(n)

    return neighbors


# ─── JUNIPER ─────────────────────────────────────────────────────────────────
def _juniper_lldp(output: str) -> List[Dict]:
    """show lldp neighbors detail"""
    neighbors = []
    blocks = re.split(r"LLDP Neighbor Information", output)

    for block in blocks[1:]:
        n = _empty_neighbor()

        # Local interface: try Parent Interface first for physical port (e.g. ge-0/0/0),
        # fallback to Local Interface and strip trailing subinterface units
        local_port = ""
        m_parent = re.search(r"Parent interface\s*:\s*(\S+)", block, re.IGNORECASE)
        if m_parent and m_parent.group(1) != "-":
            local_port = m_parent.group(1)
        else:
            m_local = re.search(r"(?:Local Interface|Interface)\s*:\s*(\S+)", block, re.IGNORECASE)
            if m_local:
                local_port = m_local.group(1)

        if local_port:
            local_port = local_port.rstrip(",")
            local_port = re.sub(r"\.\d+$", "", local_port)
            n["local_port"] = local_port

        m = re.search(r"System name\s*:\s*(.+)", block, re.IGNORECASE)
        if m:
            n["neighbor_name"] = m.group(1).strip()

        m = re.search(r"Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
        if m:
            n["neighbor_ip"] = m.group(1)

        m = re.search(r"Chassis ID\s*:\s*([0-9a-fA-F:]+)", block, re.IGNORECASE)
        if m:
            n["neighbor_mac"] = _norm_mac(m.group(1))

        m = re.search(r"System description\s*:\s*(.+)", block, re.IGNORECASE)
        if m:
            n["neighbor_platform"] = m.group(1).strip()[:120]

        # Neighbor port: try Port description first, fallback to Port ID
        neighbor_port = ""
        m_desc = re.search(r"Port description\s*:\s*([^\n]+)", block, re.IGNORECASE)
        if m_desc:
            neighbor_port = m_desc.group(1).strip()
        else:
            m_port = re.search(r"Port ID\s*:\s*(\S+)", block, re.IGNORECASE)
            if m_port:
                neighbor_port = m_port.group(1).strip()

        if neighbor_port:
            neighbor_port = neighbor_port.rstrip(",")
            neighbor_port = re.sub(r"\.\d+$", "", neighbor_port)
            n["neighbor_port"] = neighbor_port

        if n["local_port"] or n["neighbor_name"]:
            neighbors.append(n)

    return neighbors


# ─── HP PROCURVE ─────────────────────────────────────────────────────────────
def _hp_procurve_lldp(output: str) -> List[Dict]:
    """show lldp info remote-device — tabular format."""
    neighbors = []
    for line in output.splitlines():
        line_strip = line.strip()
        if not line_strip or "LocalPort" in line_strip or "ChassisId" in line_strip or "---" in line_strip:
            continue

        parts = [p.strip() for p in line_strip.split("|")]
        if len(parts) >= 2:
            local_port = parts[0]
            rest = parts[1]

            sub_parts = [p.strip() for p in rest.split("|")]
            if len(sub_parts) >= 3:
                neighbors.append({
                    "local_port":        local_port,
                    "neighbor_name":     sub_parts[2],
                    "neighbor_ip":       "",
                    "neighbor_mac":      _norm_mac(sub_parts[0]),
                    "neighbor_platform": "",
                    "neighbor_port":     sub_parts[1],
                })
            else:
                tokens = rest.split()
                if len(tokens) >= 4:
                    is_space_mac = all(len(t) == 2 and all(c in "0123456789ABCDEFabcdef" for c in t) for t in tokens[:6])
                    if is_space_mac:
                        chassis_id = " ".join(tokens[:6])
                        port_id = tokens[6]
                        sys_name = tokens[-1]
                        neighbors.append({
                            "local_port":        local_port,
                            "neighbor_name":     sys_name,
                            "neighbor_ip":       "",
                            "neighbor_mac":      _norm_mac(chassis_id),
                            "neighbor_platform": "",
                            "neighbor_port":     port_id,
                        })
                    else:
                        neighbors.append({
                            "local_port":        local_port,
                            "neighbor_name":     tokens[-1],
                            "neighbor_ip":       "",
                            "neighbor_mac":      _norm_mac(tokens[0]),
                            "neighbor_platform": "",
                            "neighbor_port":     tokens[1],
                        })
    return neighbors


# ─── HUAWEI ──────────────────────────────────────────────────────────────────
def _huawei_lldp(output: str) -> List[Dict]:
    """display lldp neighbor brief
       GE0/0/1   aabb-cc00-0200   GE0/0/1   SW-Access-02  ...
    """
    neighbors = []
    for line in output.splitlines():
        m = re.match(
            r"\s*(\S+)\s+([0-9a-fA-F\-\.\:]{12,17})\s+(\S+)\s+(\S+)",
            line,
        )
        if m:
            neighbors.append({
                "local_port":        m.group(1),
                "neighbor_name":     m.group(4),
                "neighbor_ip":       "",
                "neighbor_mac":      _norm_mac(m.group(2)),
                "neighbor_platform": "",
                "neighbor_port":     m.group(3),
            })
    return neighbors


# ─── RUIJIE ──────────────────────────────────────────────────────────────────
def _ruijie_lldp(output: str) -> List[Dict]:
    """Parse Ruijie LLDP neighbor output.

    Strategy: split on "LLDP neighbor-information of port" to get one block
    per neighbor. Each block header contains the local port in brackets like:
        LLDP neighbor-information of port [GigabitEthernet 0/1]

    Fallback (brief-only): parse the Ruijie fixed-width summary table using
    character offsets derived from the header line.
    """
    neighbors = []
    blocks = output.split("LLDP neighbor-information of port")

    if len(blocks) > 1:
        # Detail output available — use it as the authoritative source
        for block in blocks[1:]:
            if not block.strip():
                continue

            n = _empty_neighbor()

            # Local port is in the first [...] of this block
            m_local = re.match(r"\s*\[(.*?)\]", block)
            if m_local:
                n["local_port"] = m_local.group(1).strip()

            m = re.search(r"chassis id\s*:\s*(\S+)", block, re.IGNORECASE)
            if m:
                n["neighbor_mac"] = _norm_mac(m.group(1))

            # System name — capture full name including spaces
            m = re.search(r"system name\s*:\s*([^\n]+)", block, re.IGNORECASE)
            if m:
                n["neighbor_name"] = m.group(1).strip()

            m = re.search(r"system description\s*:\s*([^\n]+)", block, re.IGNORECASE)
            if m:
                n["neighbor_platform"] = m.group(1).strip()[:120]

            m = re.search(r"management address\s*:\s*(\d+\.\d+\.\d+\.\d+)", block, re.IGNORECASE)
            if m:
                n["neighbor_ip"] = m.group(1)

            # Choose between Port ID and Port description —
            # prefer whichever looks like a real physical port name
            port_id_val = ""
            m_port = re.search(r"port id\s*:\s*(\S+)", block, re.IGNORECASE)
            if m_port:
                port_id_val = m_port.group(1).strip()

            port_desc_val = ""
            m_desc = re.search(r"port description\s*:\s*([^\n]+)", block, re.IGNORECASE)
            if m_desc:
                port_desc_val = m_desc.group(1).strip()

            if _looks_like_physical_port(port_id_val):
                n["neighbor_port"] = port_id_val
            elif _looks_like_physical_port(port_desc_val):
                n["neighbor_port"] = port_desc_val
            else:
                n["neighbor_port"] = port_desc_val if port_desc_val else port_id_val

            if n["local_port"] or n["neighbor_name"]:
                neighbors.append(n)

        return neighbors

    # ── Fallback: no detail blocks — parse summary table with fixed-column offsets ──
    # Ruijie brief table uses fixed-width columns. We detect the header to find
    # the exact character offsets for each column, then slice each data row accordingly.
    #
    # Header example:
    # System Name                 Local Intf          Port ID         Capability   Aging-time
    header_line = None
    data_lines = []

    for line in output.splitlines():
        line_strip = line.strip()
        if not line_strip:
            continue
        if re.search(r"system name", line_strip, re.IGNORECASE) and re.search(r"local.?intf", line_strip, re.IGNORECASE):
            header_line = line  # keep original (non-stripped) for offset calculation
            continue
        if header_line and ("---" in line_strip or re.match(r"Total entries", line_strip, re.IGNORECASE)):
            break
        if header_line:
            data_lines.append(line)

    if header_line and data_lines:
        header_lower = header_line.lower()
        idx_name = header_lower.find("system name")
        idx_intf = header_lower.find("local")
        idx_port = header_lower.find("port id")
        idx_cap  = header_lower.find("capability")

        for line in data_lines:
            padded = line.ljust(max(idx_cap + 20 if idx_cap != -1 else 100, len(line) + 1))
            sys_name   = padded[idx_name:idx_intf].strip()       if idx_name != -1 else ""
            local_intf = padded[idx_intf:idx_port].strip()       if idx_intf != -1 else ""
            port_id    = padded[idx_port:idx_cap].strip()        if idx_port != -1 else ""

            if not local_intf:
                continue

            # port_id may be a MAC (for APs) — if so, store as neighbor_mac
            # Only store as MAC if it's a valid hex MAC pattern (not a plain number like '557')
            is_valid_mac = bool(re.match(r"^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$", port_id) or
                                re.match(r"^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$", port_id))
            if _looks_like_physical_port(port_id):
                n_port = port_id
                n_mac  = ""
            elif is_valid_mac:
                n_port = ""
                n_mac  = _norm_mac(port_id)
            else:
                # Plain number or unrecognized — skip it
                n_port = ""
                n_mac  = ""

            neighbors.append({
                "local_port":        local_intf,
                "neighbor_name":     sys_name,
                "neighbor_ip":       "",
                "neighbor_mac":      n_mac,
                "neighbor_platform": "",
                "neighbor_port":     n_port,
            })

    return neighbors


# ─── GENERIC FALLBACK ─────────────────────────────────────────────────────────
def _generic_lldp(output: str) -> List[Dict]:
    """Best-effort generic parser using keyword heuristics."""
    neighbors = []
    current = None

    for line in output.splitlines():
        if re.search(r"(local.?int|local.?port|local.?intf)", line, re.IGNORECASE):
            if current:
                neighbors.append(current)
            current = _empty_neighbor()
            m = re.search(r":\s*(\S+)", line)
            if m and current is not None:
                current["local_port"] = m.group(1)
            continue

        if current is None:
            continue

        if re.search(r"(system.?name|neighbor.?id|chassis.?name)", line, re.IGNORECASE):
            m = re.search(r":\s*(.+)", line)
            if m:
                current["neighbor_name"] = _strip_quotes(m.group(1).strip())

        elif re.search(r"(mgmt.?ip|management.?addr|ip.?addr)", line, re.IGNORECASE):
            m = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
            if m:
                current["neighbor_ip"] = m.group(1)

        elif re.search(r"(chassis.?id|mac.?addr)", line, re.IGNORECASE):
            m = re.search(
                r"([0-9a-fA-F]{2}[:\-\.][0-9a-fA-F]{2}[:\-\.][0-9a-fA-F]{2}"
                r"[:\-\.][0-9a-fA-F]{2}[:\-\.][0-9a-fA-F]{2}[:\-\.][0-9a-fA-F]{2})",
                line,
            )
            if m:
                current["neighbor_mac"] = _norm_mac(m.group(1))

        elif re.search(r"(system.?desc|platform|version)", line, re.IGNORECASE):
            m = re.search(r":\s*(.+)", line)
            if m and not current["neighbor_platform"]:
                current["neighbor_platform"] = _strip_quotes(m.group(1).strip())[:120]

        elif re.search(r"port.?id", line, re.IGNORECASE):
            m = re.search(r":\s*(\S+)", line)
            if m:
                current["neighbor_port"] = m.group(1)

    if current:
        neighbors.append(current)

    return [n for n in neighbors if n["local_port"] or n["neighbor_name"]]


def _allied_telesis_lldp(output: str) -> List[Dict]:
    """Parse Allied Telesis show lldp neighbors detail.
    Example output formats:
    LLDP detail information for port port1.0.1
    --------------------------------------------------------------------------------
      Chassis ID: 001a.eb12.3456 (MAC address)
      Port ID: port1.0.1 (Interface name)
      Port Description: port1.0.1
      System Name: Switch-AT
      System Description: Allied Telesis Switch AW+ ...
      Management Address: 192.168.1.10
      
    Or:
    Local port1.0.49:
      Chassis ID ....................... e030.f94d.9e78
      Port ID .......................... 629
      System Name ...................... Kementrian_LT1
    """
    neighbors = []
    # Split on block headers (either "LLDP detail information for port [port]" or "Local [port]:")
    blocks = re.split(r"(?:LLDP detail information for port\s+|Local\s+)(port\d+\.\d+\.\d+|[a-zA-Z\d\/\.\-]+):?\s*\n", output, flags=re.IGNORECASE)
    for i in range(1, len(blocks), 2):
        local_port = blocks[i].strip()
        block_text = blocks[i+1]
        
        if not block_text.strip():
            continue

        n = _empty_neighbor()
        n["local_port"] = local_port

        # Match Chassis ID with either dots or colons
        m = re.search(r"Chassis ID\s*(?:\.+|:)\s*([^\n]+)", block_text, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            val = re.sub(r"\s*\([^\)]+\)", "", val).strip()
            n["neighbor_mac"] = _norm_mac(val)

        # Match Port ID
        m = re.search(r"Port ID\s*(?:\.+|:)\s*([^\n\(\)]+)", block_text, re.IGNORECASE)
        if m:
            n["neighbor_port"] = m.group(1).strip()

        # Match Port Description
        m = re.search(r"Port Description\s*(?:\.+|:)\s*([^\n]+)", block_text, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            val = re.sub(r"\s*\([^\)]+\)", "", val).strip()
            if not n["neighbor_port"] or not _looks_like_physical_port(n["neighbor_port"]):
                if _looks_like_physical_port(val):
                    n["neighbor_port"] = val

        # Match System Name
        m = re.search(r"System Name\s*(?:\.+|:)\s*([^\n]+)", block_text, re.IGNORECASE)
        if m:
            n["neighbor_name"] = m.group(1).strip()

        # Match System Description (with support for multiline values)
        m = re.search(r"System Description\s*(?:\.+|:)\s*(.+)", block_text, re.IGNORECASE)
        if m:
            desc_lines = []
            first_line = m.group(1).strip()
            desc_lines.append(first_line)
            remaining_lines = block_text[m.end():].splitlines()
            for line in remaining_lines:
                # If a line starts with lots of spaces and no new OID/Field name
                if line.startswith(" " * 10) and "..." not in line and ":" not in line:
                    desc_lines.append(line.strip())
                else:
                    break
            n["neighbor_platform"] = " ".join(desc_lines)[:120]

        # Match Management Address
        m = re.search(r"Management Address(?:es)?\s*(?:\.+|:)\s*([^\n]+)", block_text, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            ip_m = re.search(r"(\d+\.\d+\.\d+\.\d+)", val)
            if ip_m:
                n["neighbor_ip"] = ip_m.group(1)

        if n["local_port"] or n["neighbor_name"]:
            neighbors.append(n)

    return neighbors


# ─── DISPATCH TABLE ──────────────────────────────────────────────────────────
_PARSERS = {
    "cisco_ios":         _cisco_lldp,
    "cisco_xe":          _cisco_lldp,
    "cisco_nxos":        _cisco_lldp,
    "mikrotik_routeros": _mikrotik_lldp,
    "juniper_junos":     _juniper_lldp,
    "hp_procurve":       _hp_procurve_lldp,
    "hp_comware":        _generic_lldp,
    "ruckus_fastiron":   _ruckus_lldp,   # Ruckus FastIron has its own 'Local port:' format
    "huawei":            _huawei_lldp,
    "fortinet":          _generic_lldp,
    "aruba_os":          _generic_lldp,
    "extreme_exos":      _generic_lldp,
    "dell_os10":         _cisco_lldp,
    "ruijie_os":         _ruijie_lldp,
    "allied_telesis":    _allied_telesis_lldp,
    "allied_telesis_awplus": _allied_telesis_lldp,
}


def _clean_port(port_str: str) -> str:
    if not port_str:
        return ""
    port_str = port_str.strip().rstrip(",")
    # Strip logical subinterface/unit suffix (e.g., ge-0/0/0.0 -> ge-0/0/0)
    port_str = re.sub(r"\.\d+$", "", port_str)
    return port_str


def parse_lldp(output: str, device_type: str) -> List[Dict]:
    """Parse LLDP neighbor output for a given device_type."""
    if not output or output.startswith("ERROR:"):
        return []
    parser = _PARSERS.get(device_type, _generic_lldp)
    try:
        result = parser(output)
        if not result:
            result = _generic_lldp(output)
    except Exception:
        result = _generic_lldp(output)

    # Post-process to ensure physical ports across all vendors
    is_allied = "allied" in device_type.lower()
    for n in result:
        if "local_port" in n:
            if not (is_allied and re.match(r"^port\d+\.\d+\.\d+$", n["local_port"], re.IGNORECASE)):
                n["local_port"] = _clean_port(n["local_port"])
        if "neighbor_port" in n:
            if not re.match(r"^port\d+\.\d+\.\d+$", n["neighbor_port"], re.IGNORECASE):
                n["neighbor_port"] = _clean_port(n["neighbor_port"])
    return result
