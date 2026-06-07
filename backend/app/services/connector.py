import asyncio
import logging
from typing import Optional

logger = logging.getLogger("netx.connector")

# ─── ARP COMMANDS PER DEVICE TYPE ───────────────────────────────────────────
ARP_COMMANDS = {
    "cisco_ios":        "show ip arp",
    "cisco_xe":         "show ip arp",
    "cisco_nxos":       "show ip arp",
    "cisco_asa":        "show arp",
    "mikrotik_routeros":"ip arp print",
    "juniper_junos":    "show arp no-resolve",
    "hp_procurve":      "show arp",
    "hp_comware":       "display arp",
    "ruckus_fastiron":  "show arp",
    "huawei":           "display arp",
    "fortinet":         "get system arp",
    "aruba_os":         "show arp",
    "extreme_exos":     "show iparp",
    "dell_os10":        "show ip arp",
    "paloalto_panos":   "show arp all",
    "cisco_s300":       "show ip arp",
    "allied_telesis":   "show arp",
    "vyos":             "show ip arp",
    "ruijie_os":        "show arp",
}

# ─── LLDP COMMANDS PER DEVICE TYPE ──────────────────────────────────────────
LLDP_COMMANDS = {
    "cisco_ios":        ["show lldp neighbors", "show lldp neighbors detail"],
    "cisco_xe":         ["show lldp neighbors", "show lldp neighbors detail"],
    "cisco_nxos":       ["show lldp neighbors", "show lldp neighbors detail"],
    "mikrotik_routeros":"ip neighbor print detail",
    "juniper_junos":    ["show lldp neighbors", "show lldp neighbors detail"],
    "hp_procurve":      "show lldp info remote-device",
    "hp_comware":       "display lldp neighbor-information verbose",
    "ruckus_fastiron":  ["show lldp neighbors", "show lldp neighbors detail"],
    "huawei":           "display lldp neighbor brief",
    "fortinet":         "get system lldp neighbors",
    "aruba_os":         "show lldp neighbor-info remote",
    "extreme_exos":     ["show lldp neighbors", "show lldp neighbors detail"],
    "dell_os10":        ["show lldp neighbors", "show lldp neighbors detail"],
    "allied_telesis":   ["show lldp neighbors", "show lldp neighbors detail"],
    "vyos":             "",  # VyOS does not support LLDP CLI easily
    "ruijie_os":        ["show lldp neighbor", "show lldp neighbor detail"],
}

# ─── CDP COMMANDS PER DEVICE TYPE ───────────────────────────────────────────
CDP_COMMANDS = {
    "cisco_ios":        ["show cdp neighbors", "show cdp neighbors detail"],
    "cisco_xe":         ["show cdp neighbors", "show cdp neighbors detail"],
    "cisco_nxos":       ["show cdp neighbors", "show cdp neighbors detail"],
    "cisco_s300":       ["show cdp neighbors", "show cdp neighbors detail"],
    "ruijie_os":        ["show cdp neighbors", "show cdp neighbors detail"],  # Some Ruijie devices emulate CDP
}

# ─── ROUTING COMMANDS PER DEVICE TYPE ───────────────────────────────────────
ROUTING_COMMANDS = {
    "cisco_ios":        "show ip route",
    "cisco_xe":         "show ip route",
    "cisco_nxos":       "show ip route",
    "cisco_asa":        "show route",
    "mikrotik_routeros":"ip route print detail",
    "juniper_junos":    "show route protocol direct,static,ospf,bgp",
    "hp_procurve":      "show ip route",
    "hp_comware":       "display ip routing-table",
    "ruckus_fastiron":  "show ip route",
    "huawei":           "display ip routing-table",
    "fortinet":         "get router info routing-table all",
    "aruba_os":         "show ip route",
    "extreme_exos":     "show iproute",
    "dell_os10":        "show ip route",
    "paloalto_panos":   "show routing route",
    "cisco_s300":       "show ip route",
    "allied_telesis":   "show ip route",
    "vyos":             "show ip route",
    "ruijie_os":        "show ip route",
}

# ─── HARDWARE INFO COMMANDS PER DEVICE TYPE ───────────────────────────────
INFO_COMMANDS = {
    "cisco_ios":        "show version",
    "cisco_xe":         "show version",
    "cisco_nxos":       "show version",
    "cisco_asa":        "show version",
    "mikrotik_routeros":"system resource print",
    "juniper_junos":    ["show version", "show chassis hardware", "show chassis mac-addresses"],
    "hp_procurve":      "show version",
    "huawei":           "display version",
    "fortinet":         "get system status",
    "aruba_os":         "show version",
    "paloalto_panos":   "show system info",
    "ruckus_fastiron":  "show version",
    "allied_telesis":   ["show version", "show system"],
    "allied_telesis_awplus": ["show version", "show system"],
}

# ─── MAC TABLE COMMANDS PER DEVICE TYPE ─────────────────────────────────────
MAC_TABLE_COMMANDS = {
    "cisco_ios":        "show mac address-table",
    "cisco_xe":         "show mac address-table",
    "cisco_nxos":       "show mac address-table",
    "juniper_junos":    "show ethernet-switching table",
    "ruijie_os":        "show mac-address-table",
    "ruckus_fastiron":  "show mac-address-table",
    "hp_procurve":      "show mac-address",
    "allied_telesis":   "show mac address-table",
    "allied_telesis_awplus": "show mac address-table",
}

# Telnet-capable device types in netmiko
TELNET_CAPABLE = {
    "cisco_ios", "cisco_xe", "cisco_s300",
    "hp_procurve", "extreme_exos",
    "allied_telesis", "allied_telesis_awplus", "huawei",
}


def _build_netmiko_device(device: dict, password: str) -> dict:
    device_type = device["device_type"]
    if device_type == "allied_telesis":
        device_type = "allied_telesis_awplus"

    protocol = device.get("protocol", "ssh").lower()

    if protocol == "telnet":
        if device_type in TELNET_CAPABLE:
            device_type = device_type + "_telnet"
        # else fall back to SSH type, let netmiko negotiate

    default_port = 23 if protocol == "telnet" else 22
    return {
        "device_type":   device_type,
        "host":          device["ip"],
        "username":      device.get("username", ""),
        "password":      password,
        "port":          device.get("port", default_port),
        "timeout":       30,
        "auth_timeout":  20,
        "banner_timeout":20,
        "conn_timeout":  20,
        "fast_cli":      False,
    }


def _run_sync(device_dict: dict, password: str, command) -> str:
    """Synchronous netmiko connect + command (runs in thread pool)."""
    try:
        from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException
    except ImportError:
        return "ERROR: netmiko not installed. Run: pip install netmiko"

    nm_device = _build_netmiko_device(device_dict, password)
    try:
        with ConnectHandler(**nm_device) as conn:
            if isinstance(command, list):
                outputs = []
                for cmd in command:
                    output = conn.send_command(cmd, read_timeout=60)
                    outputs.append(f"=== OUTPUT FOR COMMAND: {cmd} ===\n{output}")
                return "\n\n".join(outputs)
            else:
                return conn.send_command(command, read_timeout=60)
    except Exception as e:
        return f"ERROR: {str(e)}"


async def connect_and_run(device_dict: dict, password: str, command: str) -> str:
    """Async wrapper — runs netmiko in thread pool so FastAPI stays responsive."""
    return await asyncio.to_thread(_run_sync, device_dict, password, command)


async def get_arp_raw(device_dict: dict, password: str) -> str:
    """Fetch raw ARP output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_arp_cmd") or ARP_COMMANDS.get(dt, "show ip arp")
    return await connect_and_run(device_dict, password, command)


async def get_info_raw(device_dict: dict, password: str) -> str:
    """Fetch raw hardware info output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_info_cmd") or INFO_COMMANDS.get(dt, "show version")
    if not command:
        return "ERROR: No hardware info command defined for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_lldp_raw(device_dict: dict, password: str) -> str:
    """Fetch raw LLDP neighbor output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_lldp_cmd") or LLDP_COMMANDS.get(dt, "show lldp neighbors detail")
    if not command:
        return "ERROR: LLDP not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_cdp_raw(device_dict: dict, password: str) -> str:
    """Fetch raw CDP neighbor output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_cdp_cmd") or CDP_COMMANDS.get(dt)
    if not command:
        return "ERROR: CDP not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_routing_raw(device_dict: dict, password: str) -> str:
    """Fetch raw routing table output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_routing_cmd") or ROUTING_COMMANDS.get(dt)
    if not command:
        return "ERROR: Routing table fetch not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_mac_table_raw(device_dict: dict, password: str) -> str:
    """Fetch raw MAC address table output from the device."""
    dt = device_dict.get("device_type", "cisco_ios")
    command = device_dict.get("custom_mac_cmd") or MAC_TABLE_COMMANDS.get(dt, "show mac address-table")
    return await connect_and_run(device_dict, password, command)


def _test_sync(device_dict: dict, password: str) -> dict:
    try:
        from netmiko import ConnectHandler
    except ImportError:
        return {"success": False, "message": "netmiko not installed."}

    nm_device = _build_netmiko_device(device_dict, password)
    try:
        with ConnectHandler(**nm_device) as conn:
            prompt = conn.find_prompt()
            return {"success": True, "message": f"Koneksi berhasil! Prompt: {prompt}"}
    except Exception as e:
        return {"success": False, "message": str(e)}


async def test_connection(device_dict: dict, password: str) -> dict:
    """Test SSH/Telnet connectivity to a device."""
    return await asyncio.to_thread(_test_sync, device_dict, password)
