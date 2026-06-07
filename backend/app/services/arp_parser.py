"""
Multi-vendor ARP table parser.
Each vendor function receives raw CLI output and returns a list of dicts:
  { ip, mac, interface, entry_type, age }
"""

import re
from typing import List, Dict


# ─── MAC NORMALIZATION ───────────────────────────────────────────────────────
def _norm_mac(mac: str) -> str:
    """Normalize any MAC format to xx:xx:xx:xx:xx:xx uppercase."""
    if not mac:
        return ""
    clean = re.sub(r"[:\-\.\s]", "", mac).upper()
    if len(clean) != 12:
        return mac.upper()
    return ":".join(clean[i:i+2] for i in range(0, 12, 2))


# ─── VENDOR PARSERS ──────────────────────────────────────────────────────────
def _cisco(output: str) -> List[Dict]:
    """Cisco IOS / XE / NX-OS: show ip arp"""
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
            entries.append({"ip": m_ios.group(1), "mac": _norm_mac(m_ios.group(3)),
                            "interface": m_ios.group(4), "entry_type": etype, "age": age})
            continue

        # Cisco NX-OS: 192.168.1.1     00:10:00  0011.2233.4455   Ethernet1/1
        m_nxos = re.match(
            r"\s*(\d+\.\d+\.\d+\.\d+)\s+([\d:]+|-)\s+"
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
            entries.append({"ip": m_nxos.group(1), "mac": _norm_mac(m_nxos.group(3)),
                            "interface": m_nxos.group(4), "entry_type": etype, "age": age})

    return entries


def _cisco_asa(output: str) -> List[Dict]:
    """Cisco ASA: show arp
       outside 192.168.1.1 aabb.cc00.0100 43
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\d+)",
            line,
        )
        if m:
            entries.append({"ip": m.group(2), "mac": _norm_mac(m.group(3)),
                            "interface": m.group(1), "entry_type": "dynamic", "age": int(m.group(4))})
    return entries


def _mikrotik(output: str) -> List[Dict]:
    """MikroTik RouterOS: /ip arp print
       Flags: X-disabled, I-invalid, H-DHCP, D-dynamic, P-published, C-complete
        0 DC 192.168.1.1    aa:bb:cc:00:01:00 bridge1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*\d+\s+([A-Z\s]*?)\s+(\d+\.\d+\.\d+\.\d+)\s+"
            r"([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})\s+(\S+)",
            line,
        )
        if m:
            flags = m.group(1)
            etype = "dynamic" if "D" in flags else ("static" if "S" in flags else "dynamic")
            entries.append({"ip": m.group(2), "mac": _norm_mac(m.group(3)),
                            "interface": m.group(4), "entry_type": etype, "age": 0})
    return entries


def _juniper(output: str) -> List[Dict]:
    """Juniper JunOS: show arp no-resolve
       MAC Address       Address         Name       Interface   Flags
       00:50:56:a1:b2:c3 192.168.1.1     192.168.1.1 ge-0/0/0.0 none
       (incomplete)      192.168.1.5     192.168.1.5 ge-0/0/0.0 none
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*([0-9a-fA-F:]{17}|\(incomplete\))\s+(\d+\.\d+\.\d+\.\d+)\s+\S+\s+(\S+)\s+(\S+)",
            line,
        )
        if m:
            mac_raw = m.group(1)
            is_incomplete = mac_raw.lower() == "(incomplete)"
            mac = "" if is_incomplete else _norm_mac(mac_raw)
            etype = "incomplete" if is_incomplete else ("static" if "permanent" in m.group(4).lower() else "dynamic")
            entries.append({"ip": m.group(2), "mac": mac,
                            "interface": m.group(3), "entry_type": etype, "age": 0})
    return entries


def _hp_procurve(output: str) -> List[Dict]:
    """HP ProCurve: show arp
       192.168.1.1   aabbcc-001000   dynamic  1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:\-]{14,17})\s+(\w+)\s+(\S+)",
            line,
        )
        if m:
            entries.append({"ip": m.group(1), "mac": _norm_mac(m.group(2)),
                            "interface": m.group(4), "entry_type": m.group(3).lower(), "age": 0})
    return entries


def _huawei(output: str) -> List[Dict]:
    """Huawei VRP: display arp
       D  17  192.168.1.1  aabb-cc00-0100  10  GE0/0/1  -
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*([DSI])\s+\d*\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F\-]{14})",
            line,
        )
        if m:
            type_map = {"D": "dynamic", "S": "static", "I": "interface"}
            # Extract interface from later columns if possible
            parts = line.strip().split()
            iface = parts[5] if len(parts) > 5 else ""
            entries.append({"ip": m.group(2), "mac": _norm_mac(m.group(3)),
                            "interface": iface, "entry_type": type_map.get(m.group(1), "dynamic"), "age": 0})
    return entries


def _hp_comware(output: str) -> List[Dict]:
    """HP Comware (H3C): display arp
       192.168.1.1  aabb-cc00-0100  GigabitEthernet0/0  Dynamic  Vlan1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F\-]{14})\s+(\S+)\s+(Dynamic|Static)",
            line,
        )
        if m:
            entries.append({"ip": m.group(1), "mac": _norm_mac(m.group(2)),
                            "interface": m.group(3), "entry_type": m.group(4).lower(), "age": 0})
    return entries


def _ruckus(output: str) -> List[Dict]:
    """Ruckus ICX FastIron: show arp
       No.  IP Address     MAC Address     Type     Age  Port
       1    192.168.1.1    aabb.cc00.0100  Dynamic  0    1/1/1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*\d+\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F\.]{14})\s+(\w+)\s+(\d+)\s+(\S+)",
            line,
        )
        if m:
            entries.append({"ip": m.group(1), "mac": _norm_mac(m.group(2)),
                            "interface": m.group(5), "entry_type": m.group(3).lower(), "age": int(m.group(4))})
    return entries


def _fortinet(output: str) -> List[Dict]:
    """FortiGate: get system arp
       Address           Age(min)   Hardware Addr      Interface
       192.168.1.1       0          aa:bb:cc:00:01:00  port1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+([0-9a-fA-F:]{17})\s+(\S+)",
            line,
        )
        if m:
            entries.append({"ip": m.group(1), "mac": _norm_mac(m.group(3)),
                            "interface": m.group(4), "entry_type": "dynamic", "age": int(m.group(2))})
    return entries


def _paloalto(output: str) -> List[Dict]:
    """Palo Alto: show arp all
       default 192.168.1.1 aa:bb:cc:00:01:00 e 0 ethernet1/1
    """
    entries = []
    for line in output.splitlines():
        m = re.match(
            r"\S+\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})\s+\w+\s+\d+\s+(\S+)",
            line,
        )
        if m:
            entries.append({"ip": m.group(1), "mac": _norm_mac(m.group(2)),
                            "interface": m.group(3), "entry_type": "dynamic", "age": 0})
    return entries


def _generic(output: str) -> List[Dict]:
    """Last-resort generic parser — finds any IP+MAC pair on a line."""
    IP_RE  = r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"
    MAC_RE = (
        r"([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}"
        r"[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}"
        r"|[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}"
        r"|[0-9a-fA-F]{6}-[0-9a-fA-F]{6})"
    )
    seen, entries = set(), []
    for line in output.splitlines():
        im = re.search(IP_RE, line)
        mm = re.search(MAC_RE, line)
        if im and mm:
            ip, mac = im.group(1), _norm_mac(mm.group(1))
            if (ip, mac) not in seen and not ip.startswith("127."):
                seen.add((ip, mac))
                entries.append({"ip": ip, "mac": mac, "interface": "",
                                "entry_type": "dynamic", "age": 0})
    return entries


def _allied_telesis(output: str) -> List[Dict]:
    """Allied Telesis AW+: show arp
       IP Address      MAC Address       Port         Type      Age
       192.168.1.1     001a.eb12.3456    port1.0.1    dynamic   12
       
       Also supports:
       IP Address      LL Address       Interface            Port        Type
       10.101.50.1     80db.17cd.b100   vlan1150             port1.0.49  dynamic
    """
    entries = []
    for line in output.splitlines():
        line_strip = line.strip()
        if not line_strip or any(h in line_strip for h in ("IP Address", "MAC Address", "LL Address", "Interface", "---")):
            continue
        tokens = line_strip.split()
        if len(tokens) >= 4:
            ip = tokens[0]
            if not re.match(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$", ip):
                continue
            mac_candidate = tokens[1]
            mac_clean = re.sub(r"[:\-\.\s]", "", mac_candidate)
            if len(mac_clean) != 12:
                continue
            mac = _norm_mac(mac_candidate)
            if len(tokens) == 5:
                token_3 = tokens[2]
                token_4 = tokens[3]
                token_5 = tokens[4]
                if token_5 == "-" or token_5.isdigit():
                    age = 0 if token_5 == "-" else int(token_5)
                    etype = "static" if token_5 == "-" else token_4.lower()
                    interface = token_3
                else:
                    # Format: IP MAC Interface Port Type (Port is physical interface, e.g. port1.0.49)
                    interface = tokens[3]
                    etype = token_5.lower()
                    age = 0
                if etype not in ("dynamic", "static"):
                    etype = "dynamic"
                entries.append({
                    "ip": ip,
                    "mac": mac,
                    "interface": interface,
                    "entry_type": etype,
                    "age": age
                })
            elif len(tokens) == 4:
                interface = tokens[2]
                etype = tokens[3].lower()
                if etype not in ("dynamic", "static"):
                    etype = "dynamic"
                entries.append({
                    "ip": ip,
                    "mac": mac,
                    "interface": interface,
                    "entry_type": etype,
                    "age": 0
                })
    return entries


# ─── PARSER DISPATCH TABLE ───────────────────────────────────────────────────
_PARSERS = {
    "cisco_ios":         _cisco,
    "cisco_xe":          _cisco,
    "cisco_nxos":        _cisco,
    "cisco_asa":         _cisco_asa,
    "mikrotik_routeros": _mikrotik,
    "juniper_junos":     _juniper,
    "hp_procurve":       _hp_procurve,
    "hp_comware":        _hp_comware,
    "ruckus_fastiron":   _ruckus,
    "huawei":            _huawei,
    "fortinet":          _fortinet,
    "paloalto_panos":    _paloalto,
    "allied_telesis":    _allied_telesis,
    "allied_telesis_awplus": _allied_telesis,
}


def parse_arp(output: str, device_type: str) -> List[Dict]:
    """Parse ARP table output for a given device_type."""
    if not output or output.startswith("ERROR:"):
        return []
    parser = _PARSERS.get(device_type, _generic)
    try:
        result = parser(output)
        if not result:
            result = _generic(output)
        return result
    except Exception:
        return _generic(output)
