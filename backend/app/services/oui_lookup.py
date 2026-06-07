"""
OUI (Organizationally Unique Identifier) vendor lookup.

Strategy:
1. Check in-memory cache (fastest)
2. Check bundled COMMON_OUI dict of ~200 major vendors (offline, fast)
3. Fallback to macvendors.com HTTP API (online, 5s timeout, rate-limited)

Results are cached in _cache dict so each prefix is only looked up once.
"""

import asyncio
import logging
import re
from typing import Dict

logger = logging.getLogger("netx.oui")

# In-memory prefix → result cache
_cache: Dict[str, dict] = {}

# ─── BUNDLED OUI TABLE ───────────────────────────────────────────────────────
# Format: "XX:XX:XX" (uppercase) → "Vendor Name"
COMMON_OUI: Dict[str, str] = {
    # ── Cisco Systems ──
    "00:00:0C": "Cisco Systems", "00:01:42": "Cisco Systems", "00:01:63": "Cisco Systems",
    "00:01:97": "Cisco Systems", "00:03:6B": "Cisco Systems", "00:04:27": "Cisco Systems",
    "00:0A:41": "Cisco Systems", "00:0B:BE": "Cisco Systems", "00:0D:EC": "Cisco Systems",
    "00:1A:A1": "Cisco Systems", "00:1C:57": "Cisco Systems", "00:1E:49": "Cisco Systems",
    "00:21:1B": "Cisco Systems", "00:22:55": "Cisco Systems", "00:23:04": "Cisco Systems",
    "00:23:AC": "Cisco Systems", "00:24:13": "Cisco Systems", "00:25:45": "Cisco Systems",
    "00:26:0A": "Cisco Systems", "00:26:CB": "Cisco Systems",
    "58:AC:78": "Cisco Systems", "64:A0:E7": "Cisco Systems", "68:86:A7": "Cisco Systems",
    "70:CA:9B": "Cisco Systems", "78:BA:F9": "Cisco Systems", "84:B8:02": "Cisco Systems",
    "B0:AA:77": "Cisco Systems", "C4:7D:4F": "Cisco Systems", "CC:46:D6": "Cisco Systems",
    "D0:C7:89": "Cisco Systems", "D8:B1:22": "Cisco Systems", "E8:B7:48": "Cisco Systems",
    "F0:7F:06": "Cisco Systems", "F4:CF:E2": "Cisco Systems", "F8:72:EA": "Cisco Systems",
    # ── Cisco Meraki ──
    "00:18:0A": "Cisco Meraki", "0C:8D:DB": "Cisco Meraki", "34:56:FE": "Cisco Meraki",
    "78:BC:1A": "Cisco Meraki", "88:15:44": "Cisco Meraki", "AC:17:C8": "Cisco Meraki",
    "E0:CB:4E": "Cisco Meraki", "F8:B7:E2": "Cisco Meraki",
    # ── Juniper Networks ──
    "00:05:85": "Juniper Networks", "00:12:1E": "Juniper Networks",
    "00:19:E2": "Juniper Networks", "00:1F:12": "Juniper Networks",
    "2C:6B:F5": "Juniper Networks", "40:B4:F0": "Juniper Networks",
    "44:F4:77": "Juniper Networks", "54:E0:32": "Juniper Networks",
    "84:C1:C1": "Juniper Networks", "A0:1A:30": "Juniper Networks",
    "BC:16:95": "Juniper Networks", "D8:EB:97": "Juniper Networks",
    "F4:A7:39": "Juniper Networks",
    # ── Huawei ──
    "00:18:82": "Huawei",    "00:1E:67": "Huawei",    "00:25:9E": "Huawei",
    "00:46:4B": "Huawei",    "04:C0:6F": "Huawei",    "08:19:A6": "Huawei",
    "1C:1D:67": "Huawei",    "28:6E:D4": "Huawei",    "2C:AB:00": "Huawei",
    "34:6A:C2": "Huawei",    "48:46:FB": "Huawei",    "4C:1F:CC": "Huawei",
    "54:51:1B": "Huawei",    "5C:C3:07": "Huawei",    "60:DE:44": "Huawei",
    "68:A0:86": "Huawei",    "70:72:CF": "Huawei",    "78:1D:BA": "Huawei",
    "88:A2:5E": "Huawei",    "94:77:2B": "Huawei",    "98:F1:82": "Huawei",
    "A0:08:6F": "Huawei",    "AC:4E:91": "Huawei",    "B8:08:CF": "Huawei",
    "BC:76:70": "Huawei",    "C4:F0:81": "Huawei",    "CC:CC:81": "Huawei",
    "D4:6A:A8": "Huawei",    "DC:D2:FC": "Huawei",    "E0:19:54": "Huawei",
    "E8:CD:2D": "Huawei",    "F4:9F:54": "Huawei",
    # ── MikroTik ──
    "00:0C:42": "MikroTik",  "18:FD:74": "MikroTik",  "2C:C8:1B": "MikroTik",
    "48:A9:8A": "MikroTik",  "4C:5E:0C": "MikroTik",  "64:D1:54": "MikroTik",
    "6C:3B:6B": "MikroTik",  "74:4D:28": "MikroTik",  "78:9A:18": "MikroTik",
    "8C:16:45": "MikroTik",  "B8:69:F4": "MikroTik",  "CC:2D:E0": "MikroTik",
    "D4:CA:6D": "MikroTik",  "DC:2C:6E": "MikroTik",  "E4:8D:8C": "MikroTik",
    # ── HP / HPE / Aruba ──
    "00:01:E6": "Hewlett Packard", "00:0F:20": "Hewlett Packard",
    "00:17:A4": "Hewlett Packard", "00:1C:C4": "Hewlett Packard",
    "00:21:5A": "Hewlett Packard", "00:25:B3": "Hewlett Packard",
    "18:A9:05": "Hewlett Packard", "28:92:4A": "Hewlett Packard",
    "30:8D:99": "Hewlett Packard", "40:B0:34": "Hewlett Packard",
    "70:10:6F": "Hewlett Packard", "A0:D3:C1": "Aruba Networks",
    "AC:A3:1E": "Aruba Networks",  "20:4C:03": "Aruba Networks",
    "24:DE:C6": "Aruba Networks",  "94:B4:0F": "Aruba Networks",
    "00:0B:86": "Aruba Networks",  "00:24:6C": "Aruba Networks",
    "24:F2:7F": "Aruba Networks",  "84:D4:7E": "Aruba Networks",
    "D8:C7:C8": "Aruba Networks",
    # ── Ruckus / Brocade ──
    "00:26:B9": "Ruckus Wireless", "04:4F:AA": "Ruckus Wireless",
    "18:19:2F": "Brocade Communications", "28:92:4A": "Ruckus Wireless",
    "5C:0A:5B": "Ruckus Wireless",  "58:93:96": "Ruckus Wireless",
    "94:B4:0F": "Ruckus Wireless",  "EC:58:EA": "Ruckus Wireless",
    # ── Fortinet ──
    "00:09:0F": "Fortinet",  "08:5B:0E": "Fortinet",  "70:4C:A5": "Fortinet",
    "90:6C:AC": "Fortinet",  "A4:17:31": "Fortinet",  "E8:1C:BA": "Fortinet",
    "30:0D:9E": "Fortinet",
    # ── Ubiquiti Networks ──
    "00:27:22": "Ubiquiti Networks", "04:18:D6": "Ubiquiti Networks",
    "0C:80:63": "Ubiquiti Networks", "18:E8:29": "Ubiquiti Networks",
    "24:A4:3C": "Ubiquiti Networks", "44:D9:E7": "Ubiquiti Networks",
    "68:72:51": "Ubiquiti Networks", "74:83:C2": "Ubiquiti Networks",
    "78:8A:20": "Ubiquiti Networks", "80:2A:A8": "Ubiquiti Networks",
    "B4:FB:E4": "Ubiquiti Networks", "DC:9F:DB": "Ubiquiti Networks",
    "E0:63:DA": "Ubiquiti Networks", "F0:9F:C2": "Ubiquiti Networks",
    "FC:EC:DA": "Ubiquiti Networks",
    # ── Extreme Networks ──
    "00:04:96": "Extreme Networks", "00:11:88": "Extreme Networks",
    "00:E0:2B": "Extreme Networks",
    # ── Palo Alto Networks ──
    "00:1B:17": "Palo Alto Networks", "7C:89:C1": "Palo Alto Networks",
    "D4:F2:1A": "Palo Alto Networks",
    # ── Dell ──
    "00:06:5B": "Dell", "00:08:74": "Dell", "00:0B:DB": "Dell",
    "00:14:22": "Dell", "00:21:70": "Dell", "14:18:77": "Dell",
    "18:66:DA": "Dell", "34:17:EB": "Dell", "44:A8:42": "Dell",
    "50:9A:4C": "Dell", "84:8F:69": "Dell", "B0:83:FE": "Dell",
    "B0:2A:43": "Dell", "F0:4D:A2": "Dell", "F8:CA:B8": "Dell",
    # ── Lenovo ──
    "08:BE:AC": "Lenovo", "54:EE:75": "Lenovo", "84:2B:2B": "Lenovo",
    "98:FA:9B": "Lenovo", "C8:D3:FF": "Lenovo",
    # ── Apple ──
    "00:03:93": "Apple", "00:0A:27": "Apple", "00:0A:95": "Apple",
    "00:11:24": "Apple", "00:16:CB": "Apple", "00:17:F2": "Apple",
    "00:1D:4F": "Apple", "00:1E:52": "Apple", "00:1F:5B": "Apple",
    "00:1F:F3": "Apple", "00:21:E9": "Apple", "00:22:41": "Apple",
    "00:25:4B": "Apple", "00:25:BC": "Apple", "00:26:08": "Apple",
    "00:26:B0": "Apple", "00:26:BB": "Apple", "04:26:65": "Apple",
    "04:52:F3": "Apple", "04:D3:CF": "Apple", "08:66:98": "Apple",
    "0C:4D:E9": "Apple", "0C:74:C2": "Apple", "10:40:F3": "Apple",
    "14:5A:05": "Apple", "18:20:32": "Apple", "1C:1A:C0": "Apple",
    "1C:E6:2B": "Apple", "20:78:F0": "Apple", "24:A0:74": "Apple",
    "28:0B:5C": "Apple", "28:CF:DA": "Apple", "28:F0:76": "Apple",
    "2C:61:F6": "Apple", "30:10:E4": "Apple", "34:36:3B": "Apple",
    "38:C9:86": "Apple", "3C:07:54": "Apple", "40:6C:8F": "Apple",
    "44:00:10": "Apple", "48:43:7C": "Apple", "4C:57:CA": "Apple",
    "50:7A:55": "Apple", "58:B0:35": "Apple", "5C:59:48": "Apple",
    "60:69:44": "Apple", "60:C5:47": "Apple", "64:76:BA": "Apple",
    "68:09:27": "Apple", "6C:72:E7": "Apple", "70:CD:60": "Apple",
    "74:81:14": "Apple", "78:7B:8A": "Apple", "7C:C5:37": "Apple",
    "80:E6:50": "Apple", "84:78:8B": "Apple", "88:66:A5": "Apple",
    "8C:29:37": "Apple", "8C:85:90": "Apple", "90:72:40": "Apple",
    "90:FD:61": "Apple", "98:01:A7": "Apple", "9C:20:7B": "Apple",
    "A0:99:9B": "Apple", "A4:5E:60": "Apple", "A8:20:66": "Apple",
    "AC:3C:0B": "Apple", "AC:61:EA": "Apple", "AC:BC:32": "Apple",
    "B0:65:BD": "Apple", "B4:F0:AB": "Apple", "B8:E8:56": "Apple",
    "BC:3B:AF": "Apple", "C0:84:7A": "Apple", "C4:B3:01": "Apple",
    "C8:69:CD": "Apple", "CC:08:8D": "Apple", "D0:03:4B": "Apple",
    "D0:25:98": "Apple", "DC:37:14": "Apple", "E0:B5:2D": "Apple",
    "E0:F8:47": "Apple", "E4:9A:DC": "Apple", "E4:CE:8F": "Apple",
    "EC:35:86": "Apple", "F0:99:BF": "Apple", "F4:1B:A1": "Apple",
    "F4:5C:89": "Apple",
    # ── Samsung ──
    "00:00:F0": "Samsung", "00:07:AB": "Samsung", "00:12:47": "Samsung",
    "00:13:77": "Samsung", "00:15:99": "Samsung", "00:16:6B": "Samsung",
    "00:17:C9": "Samsung", "00:1D:25": "Samsung", "00:21:D1": "Samsung",
    "00:23:39": "Samsung", "00:26:37": "Samsung", "28:27:BF": "Samsung",
    "2C:AE:2B": "Samsung", "3C:8B:FE": "Samsung", "40:0E:85": "Samsung",
    "50:85:69": "Samsung", "50:A4:C8": "Samsung", "5C:F6:DC": "Samsung",
    "78:F7:BE": "Samsung", "84:A4:66": "Samsung", "94:35:0A": "Samsung",
    "A8:06:00": "Samsung", "BC:20:A4": "Samsung", "C8:19:F7": "Samsung",
    "D4:88:90": "Samsung", "F0:25:B7": "Samsung", "F4:7B:5E": "Samsung",
    # ── Canon Printer ──
    "00:1E:8F": "Canon", "00:80:92": "Canon", "08:00:74": "Canon",
    "48:54:DE": "Canon", "94:0C:98": "Canon", "AC:39:91": "Canon",
    "18:EE:69": "Canon",
    # ── Ricoh Printer ──
    "00:00:74": "Ricoh", "00:26:73": "Ricoh", "08:00:1F": "Ricoh",
    "00:17:62": "Ricoh", "EC:08:6B": "Ricoh",
    # ── Brother Printer ──
    "00:1B:A9": "Brother Industries", "00:80:77": "Brother Industries",
    "30:05:5C": "Brother Industries", "00:0E:3A": "Brother Industries",
    # ── Epson Printer ──
    "00:26:AB": "Seiko Epson", "AC:18:26": "Seiko Epson",
    "64:EB:8C": "Seiko Epson",
    # ── HP Printers (HP Inc, not HPE) ──
    "00:01:E7": "HP Inc", "00:60:B0": "HP Inc", "1C:C1:DE": "HP Inc",
    "24:BE:05": "HP Inc", "2C:27:D7": "HP Inc", "3C:D9:2B": "HP Inc",
    "48:0F:CF": "HP Inc", "50:65:F3": "HP Inc", "64:51:06": "HP Inc",
    "78:48:59": "HP Inc", "9C:57:AD": "HP Inc", "A0:B3:CC": "HP Inc",
    "E8:39:DF": "HP Inc",
    # ── Polycom / Poly (VoIP/Video) ──
    "00:04:F2": "Polycom", "64:16:7F": "Polycom", "00:E0:75": "Polycom",
    "00:90:94": "Polycom",
    # ── Yealink (VoIP) ──
    "00:15:65": "Yealink", "80:5E:C0": "Yealink", "7C:2F:80": "Yealink",
    "EC:3B:0D": "Yealink",
    # ── Grandstream (VoIP) ──
    "00:0B:82": "Grandstream Networks", "C0:74:AD": "Grandstream Networks",
    # ── Cisco IP Phones ──
    "00:15:C7": "Cisco-Phone", "00:1A:2F": "Cisco-Phone",
    "00:1B:54": "Cisco-Phone", "00:23:5E": "Cisco-Phone",
    # ── VMware ──
    "00:0C:29": "VMware",    "00:50:56": "VMware",    "00:05:69": "VMware",
    # ── Microsoft ──
    "00:03:FF": "Microsoft", "00:12:5A": "Microsoft", "28:18:78": "Microsoft",
    "00:15:5D": "Microsoft", "7C:1E:52": "Microsoft",
    # ── Intel (mostly endpoint NICs) ──
    "00:02:B3": "Intel",     "00:03:47": "Intel",     "00:0C:F1": "Intel",
    "00:13:20": "Intel",     "8C:EC:4B": "Intel",     "10:02:B5": "Intel",
    "A0:88:69": "Intel",
}

# ─── VENDOR → CATEGORY CLASSIFICATION ───────────────────────────────────────
_RULES = [
    # (list of lowercase keywords in vendor name, category, device_hint)
    (["cisco meraki", "meraki"],                     "networking", "Cisco Meraki"),
    (["cisco"],                                       "networking", "Cisco"),
    (["juniper"],                                     "networking", "Juniper"),
    (["huawei"],                                      "networking", "Huawei"),
    (["mikrotik"],                                    "networking", "MikroTik"),
    (["aruba"],                                       "networking", "Aruba/HP"),
    (["ruckus"],                                      "networking", "Ruckus"),
    (["brocade"],                                     "networking", "Brocade"),
    (["fortinet"],                                    "networking", "FortiGate"),
    (["ubiquiti"],                                    "networking", "Ubiquiti"),
    (["palo alto"],                                   "networking", "Palo Alto"),
    (["extreme networks"],                            "networking", "Extreme Networks"),
    (["hewlett packard enterprise", "hpe"],           "networking", "HPE"),
    (["hewlett packard", "hp inc"],                   "printer",    "HP Printer"),
    (["dell"],                                        "endpoint",   "Dell"),
    (["lenovo"],                                      "endpoint",   "Lenovo"),
    (["apple"],                                       "endpoint",   "Apple"),
    (["samsung"],                                     "endpoint",   "Samsung"),
    (["microsoft"],                                   "endpoint",   "Microsoft"),
    (["intel"],                                       "endpoint",   "Intel NIC"),
    (["vmware"],                                      "endpoint",   "VMware VM"),
    (["canon"],                                       "printer",    "Canon Printer"),
    (["ricoh"],                                       "printer",    "Ricoh Printer"),
    (["brother"],                                     "printer",    "Brother Printer"),
    (["seiko epson", "epson"],                        "printer",    "Epson Printer"),
    (["polycom", "poly"],                             "phone",      "Polycom"),
    (["yealink"],                                     "phone",      "Yealink"),
    (["grandstream"],                                 "phone",      "Grandstream"),
    (["cisco-phone"],                                 "phone",      "Cisco IP Phone"),
    (["honeywell", "siemens", "schneider", "omron"], "iot",        "Industrial/IoT"),
]


def classify_vendor(vendor_name: str) -> dict:
    vl = vendor_name.lower()
    for keywords, category, hint in _RULES:
        for kw in keywords:
            if kw in vl:
                return {"vendor": vendor_name, "category": category, "device_hint": hint}
    return {"vendor": vendor_name, "category": "unknown", "device_hint": vendor_name}


def _norm_prefix(mac: str) -> str:
    """Extract and normalize the OUI prefix as XX:XX:XX."""
    clean = re.sub(r"[:\-\.\s]", "", mac).upper()
    if len(clean) < 6:
        return ""
    return f"{clean[0:2]}:{clean[2:4]}:{clean[4:6]}"


async def lookup_vendor(mac: str) -> dict:
    """
    Resolve MAC address OUI → vendor info dict.
    Returns: { vendor, category, device_hint }
    """
    _unknown = {"vendor": "Unknown", "category": "unknown", "device_hint": "Unknown"}

    if not mac or mac in {"", "N/A", "Incomplete"}:
        return _unknown
    if re.match(r"^(ff:ff:ff|00:00:00)", mac, re.IGNORECASE):
        return _unknown

    prefix = _norm_prefix(mac)
    if not prefix:
        return _unknown

    # 1. In-memory cache
    if prefix in _cache:
        return _cache[prefix]

    # 2. Bundled OUI table
    if prefix in COMMON_OUI:
        result = classify_vendor(COMMON_OUI[prefix])
        _cache[prefix] = result
        return result

    # 3. Use mac-vendor-lookup for offline complete OUI database
    try:
        from mac_vendor_lookup import AsyncMacLookup
        mac_lookup = AsyncMacLookup()
        try:
            vendor_name = await mac_lookup.lookup(mac)
            result = classify_vendor(vendor_name)
            _cache[prefix] = result
            return result
        except KeyError:
            pass # Mac vendor not found in IEEE list
        except Exception as e:
            # Maybe the file hasn't been downloaded yet. Let's update it once.
            logger.debug("Downloading mac vendor list... %s", e)
            await mac_lookup.update_vendors()
            vendor_name = await mac_lookup.lookup(mac)
            result = classify_vendor(vendor_name)
            _cache[prefix] = result
            return result
    except Exception as e:
        logger.debug("OUI MAC Lookup error for %s: %s", prefix, e)

    # Not found
    _cache[prefix] = _unknown
    return _unknown
