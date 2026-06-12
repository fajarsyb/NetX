import asyncio
import logging
from typing import Optional

logger = logging.getLogger("netx.connector")

def _build_netmiko_device(device: dict, password: str) -> dict:
    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device["device_type"])
    protocol = device.get("protocol", "ssh").lower()
    device_type = driver.get_netmiko_device_type(protocol)

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
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_arp_cmd") or driver.arp_command
    return await connect_and_run(device_dict, password, command)


async def get_info_raw(device_dict: dict, password: str) -> str:
    """Fetch raw hardware info output from the device."""
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_info_cmd") or driver.info_command
    if not command:
        return "ERROR: No hardware info command defined for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_lldp_raw(device_dict: dict, password: str) -> str:
    """Fetch raw LLDP neighbor output from the device."""
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_lldp_cmd") or driver.lldp_command
    if not command:
        return "ERROR: LLDP not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_cdp_raw(device_dict: dict, password: str) -> str:
    """Fetch raw CDP neighbor output from the device."""
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_cdp_cmd") or driver.cdp_command
    if not command:
        return "ERROR: CDP not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_routing_raw(device_dict: dict, password: str) -> str:
    """Fetch raw routing table output from the device."""
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_routing_cmd") or driver.routing_command
    if not command:
        return "ERROR: Routing table fetch not supported for this device type."
    return await connect_and_run(device_dict, password, command)


async def get_mac_table_raw(device_dict: dict, password: str) -> str:
    """Fetch raw MAC address table output from the device."""
    from app.core.drivers import driver_manager
    dt = device_dict.get("device_type", "cisco_ios")
    driver = driver_manager.get_driver(dt)
    command = device_dict.get("custom_mac_cmd") or driver.mac_table_command
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
    if device_dict.get("protocol") == "serial":
        port_name = device_dict["ip"]
        baud_rate = device_dict.get("port", 9600) or 9600
        try:
            import serial
            ser = serial.Serial(port=port_name, baudrate=baud_rate, timeout=1)
            ser.close()
            return {"success": True, "message": f"Serial port {port_name} opened successfully."}
        except Exception as e:
            return {"success": False, "message": f"Gagal membuka serial port {port_name}: {e}"}

    return await asyncio.to_thread(_test_sync, device_dict, password)

