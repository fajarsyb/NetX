import re
import asyncio
import logging
from app.database import get_db_conn, get_device_credentials
from app.services.connector import connect_and_run

# Standard PySNMP async imports
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, get_cmd, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)

logger = logging.getLogger("netx.performance")

# SNMP OIDs Map for CPU and Memory
SNMP_OIDS = {
    "cisco": {
        "cpu": "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",  # 1-min CPU average
        "mem_used": "1.3.6.1.4.1.9.9.48.1.1.1.5.1",
        "mem_free": "1.3.6.1.4.1.9.9.48.1.1.1.6.1",
    },
    "juniper": {
        "cpu": "1.3.6.1.4.1.2636.3.1.13.1.21.9.1.0.0",  # jnxOperatingCPU for routing engine
        "mem_util": "1.3.6.1.4.1.2636.3.1.13.1.12.9.1.0.0",  # jnxOperatingBuffer
    },
    "huawei": {
        "cpu": "1.3.6.1.4.1.2011.6.1.1.1.3.0",  # hwCpuDevDuty
        "mem_util": "1.3.6.1.4.1.2011.6.1.1.1.4.0",  # hwMemoryDevDuty
    },
    "ruckus": {
        "cpu": "1.3.6.1.4.1.1991.1.1.2.1.50.0",  # snAgCpuUtil
        "mem_util": "1.3.6.1.4.1.1991.1.1.2.1.53.0",  # snAgDynMemUtil
    },
    "ruijie": {
        "cpu": "1.3.6.1.4.1.4881.1.1.10.2.36.1.1.1.0",  # ruijieCpuRateRev
        "mem_util": "1.3.6.1.4.1.4881.1.1.10.2.36.1.1.3.0",  # ruijieMemoryRateRev
    },
    "hp": {
        "cpu": "1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0",  # hpSwitchCpuStat
        "mem_util": "1.3.6.1.4.1.11.2.14.11.5.1.9.6.2.0",  # hpSwitchMemStat
    },
    "aruba": {
        "cpu": "1.3.6.1.4.1.14823.2.2.1.1.1.9.1.3.0",
        "mem_util": "1.3.6.1.4.1.14823.2.2.1.1.1.9.1.4.0",
    },
    "mikrotik": {
        "cpu": "1.3.6.1.4.1.14988.1.1.3.10.0",
        "mem_free": "1.3.6.1.2.1.25.2.3.1.6.65536",
        "mem_total": "1.3.6.1.2.1.25.2.3.1.5.65536",
    }
}


def format_uptime(ticks_str: str) -> str:
    """Format sysUpTime ticks to standard readable Indonesian uptime string."""
    try:
        ticks = int(ticks_str)
        total_seconds = ticks / 100.0
        days = int(total_seconds // 86400)
        hours = int((total_seconds % 86400) // 3600)
        minutes = int((total_seconds % 3600) // 60)
        
        parts = []
        if days > 0:
            parts.append(f"{days} hari")
        if hours > 0 or days > 0:
            parts.append(f"{hours} jam")
        if minutes > 0 or (days == 0 and hours == 0):
            parts.append(f"{minutes} menit")
            
        return ", ".join(parts)
    except Exception:
        return ticks_str


def get_vendor_key(device_type: str) -> str:
    """Resolve device driver type to mapped OID vendor key."""
    dt = device_type.lower()
    if "cisco" in dt:
        return "cisco"
    if "juniper" in dt:
        return "juniper"
    if "huawei" in dt:
        return "huawei"
    if "ruckus" in dt:
        return "ruckus"
    if "ruijie" in dt:
        return "ruijie"
    if "hp" in dt:
        return "hp"
    if "aruba" in dt:
        return "aruba"
    if "mikrotik" in dt:
        return "mikrotik"
    return "generic"


async def fetch_snmp_performance(ip: str, community: str, snmp_version: str, vendor: str) -> dict:
    """Perform real-time SNMP query to get CPU, Memory, and Uptime details."""
    mp_model = 1 if snmp_version == "v2c" else 0
    
    # Base OIDs
    uptime_oid = "1.3.6.1.2.1.1.3.0"  # sysUpTime
    
    oids_to_fetch = {"uptime": uptime_oid}
    
    vendor_oids = SNMP_OIDS.get(vendor)
    if vendor_oids:
        for k, v in vendor_oids.items():
            oids_to_fetch[k] = v
    else:
        # Fallbacks for generic switches using Host Resources MIB
        oids_to_fetch["cpu"] = "1.3.6.1.2.1.25.3.3.1.2.196608"  # hrProcessorLoad
        oids_to_fetch["mem_free"] = "1.3.6.1.2.1.25.2.3.1.6.65536"
        oids_to_fetch["mem_total"] = "1.3.6.1.2.1.25.2.3.1.5.65536"

    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
        
        # Build query bindings
        bindings = []
        key_mapping = {}
        for key, oid in oids_to_fetch.items():
            bindings.append(ObjectType(ObjectIdentity(oid)))
            key_mapping[oid] = key

        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            SnmpEngine(),
            CommunityData(community, mpModel=mp_model),
            transport,
            ContextData(),
            *bindings
        )

        if errorIndication or errorStatus:
            raise Exception(f"SNMP error: {errorIndication or errorStatus}")

        res_data = {}
        for varBind in varBinds:
            oid_str = varBind[0].prettyPrint().strip(".")
            val_str = varBind[1].prettyPrint()
            
            # Match back using contains since pysnmp format might vary slightly
            matched_key = None
            for key, o_val in oids_to_fetch.items():
                if o_val.strip(".") in oid_str:
                    matched_key = key
                    break
            
            if matched_key:
                res_data[matched_key] = val_str

        # Parse metrics
        cpu_val = None
        if "cpu" in res_data:
            try:
                cpu_val = int(res_data["cpu"])
            except:
                pass
                
        ram_val = None
        if "mem_util" in res_data:
            try:
                ram_val = int(res_data["mem_util"])
            except:
                pass
        elif "mem_used" in res_data and "mem_free" in res_data:
            try:
                used = int(res_data["mem_used"])
                free = int(res_data["mem_free"])
                if used + free > 0:
                    ram_val = int((used / (used + free)) * 100)
            except:
                pass
        elif "mem_free" in res_data and "mem_total" in res_data:
            try:
                free = int(res_data["mem_free"])
                total = int(res_data["mem_total"])
                if total > 0:
                    ram_val = int(((total - free) / total) * 100)
            except:
                pass

        uptime_val = None
        if "uptime" in res_data:
            uptime_val = format_uptime(res_data["uptime"])

        # Validate we got something useful
        if cpu_val is not None or ram_val is not None:
            return {
                "cpu": cpu_val or 0,
                "ram": ram_val or 0,
                "uptime": uptime_val or "—",
                "source": "snmp"
            }
            
    except Exception as e:
        logger.debug(f"SNMP performance query failed for {ip}: {e}")
        
    return None


async def fetch_cli_performance(device_dict: dict, password: str, vendor: str) -> dict:
    """Connect via SSH/Telnet and run commands to parse CPU/RAM/Uptime."""
    if vendor == "cisco":
        # Cisco IOS CPU and Memory parsing
        cpu_out = await connect_and_run(device_dict, password, "show processes cpu | include one minute")
        mem_out = await connect_and_run(device_dict, password, "show memory statistics | include Processor")
        ver_out = await connect_and_run(device_dict, password, "show version | include uptime")
        
        cpu_match = re.search(r"one minute:\s*(\d+)%", cpu_out)
        cpu = int(cpu_match.group(1)) if cpu_match else 0
        
        ram = 0
        # Processor   308EAA0   123456789    45678901    77777888
        mem_match = re.search(r"Processor\s+\S+\s+(\d+)\s+(\d+)", mem_out)
        if mem_match:
            try:
                total = int(mem_match.group(1))
                used = int(mem_match.group(2))
                if total > 0:
                    ram = int((used / total) * 100)
            except:
                pass
                
        up_match = re.search(r"uptime is\s+(.*)", ver_out, re.IGNORECASE)
        uptime = up_match.group(1).strip() if up_match else "—"
        
        return {"cpu": cpu, "ram": ram, "uptime": uptime, "source": "cli"}

    elif vendor == "juniper":
        out = await connect_and_run(device_dict, password, "show chassis routing-engine")
        cpu_match = re.search(r"CPU utilization\s*:\s*(\d+)\s*percent", out, re.IGNORECASE)
        mem_match = re.search(r"Memory utilization\s*:\s*(\d+)\s*percent", out, re.IGNORECASE)
        up_match = re.search(r"Up time\s+(.*)", out, re.IGNORECASE)
        
        cpu = int(cpu_match.group(1)) if cpu_match else 0
        ram = int(mem_match.group(1)) if mem_match else 0
        uptime = up_match.group(1).strip() if up_match else "—"
        
        return {"cpu": cpu, "ram": ram, "uptime": uptime, "source": "cli"}

    elif vendor == "huawei":
        cpu_out = await connect_and_run(device_dict, password, "display cpu-usage")
        mem_out = await connect_and_run(device_dict, password, "display memory-usage")
        ver_out = await connect_and_run(device_dict, password, "display version")
        
        cpu_match = re.search(r"CPU\s+Usage\s*:\s*(\d+)%", cpu_out, re.IGNORECASE)
        mem_match = re.search(r"Memory\s+Usage\s*:\s*(\d+)%", mem_out, re.IGNORECASE)
        up_match = re.search(r"uptime is\s+(.*)", ver_out, re.IGNORECASE)
        
        cpu = int(cpu_match.group(1)) if cpu_match else 0
        ram = int(mem_match.group(1)) if mem_match else 0
        uptime = up_match.group(1).strip() if up_match else "—"
        
        return {"cpu": cpu, "ram": ram, "uptime": uptime, "source": "cli"}

    elif vendor == "ruckus":
        cpu_out = await connect_and_run(device_dict, password, "show cpu")
        mem_out = await connect_and_run(device_dict, password, "show memory")
        ver_out = await connect_and_run(device_dict, password, "show version")
        
        cpu_match = re.search(r"(\d+)%\s*busy", cpu_out)
        cpu = int(cpu_match.group(1)) if cpu_match else 0
        
        ram = 0
        tot_match = re.search(r"(\d+)\s*bytes\s*total", mem_out, re.IGNORECASE)
        fre_match = re.search(r"(\d+)\s*bytes\s*free", mem_out, re.IGNORECASE)
        if tot_match and fre_match:
            try:
                total = int(tot_match.group(1))
                free = int(fre_match.group(1))
                if total > 0:
                    ram = int(((total - free) / total) * 100)
            except:
                pass
                
        up_match = re.search(r"uptime is\s+(.*)", ver_out, re.IGNORECASE)
        uptime = up_match.group(1).strip() if up_match else "—"
        
        return {"cpu": cpu, "ram": ram, "uptime": uptime, "source": "cli"}

    elif vendor == "ruijie":
        cpu_out = await connect_and_run(device_dict, password, "show cpu")
        mem_out = await connect_and_run(device_dict, password, "show memory")
        ver_out = await connect_and_run(device_dict, password, "show version")
        
        # 5 seconds: 12%, 1 minute: 10%
        cpu_match = re.search(r"1\s+minute:\s*(\d+)%", cpu_out, re.IGNORECASE)
        cpu = int(cpu_match.group(1)) if cpu_match else 0
        
        ram = 0
        mem_match = re.search(r"Memory\s+usage\s*:\s*(\d+)%", mem_out, re.IGNORECASE)
        if mem_match:
            ram = int(mem_match.group(1))
            
        up_match = re.search(r"uptime is\s+(.*)", ver_out, re.IGNORECASE)
        uptime = up_match.group(1).strip() if up_match else "—"
        
        return {"cpu": cpu, "ram": ram, "uptime": uptime, "source": "cli"}

    return None


def get_simulated_performance(device_id: int, status: str) -> dict:
    """Consistent simulated statistics fallback when query is not available or device is offline."""
    if status != 'online':
        return {
            "cpu": 0,
            "ram": 0,
            "uptime": "Offline",
            "source": "simulated"
        }
    
    cpu = ((device_id * 17) % 25) + 8
    ram = ((device_id * 23) % 35) + 30
    uptime_days = ((device_id * 5) % 12) + 2
    uptime_hours = ((device_id * 3) % 23)
    
    return {
        "cpu": cpu,
        "ram": ram,
        "uptime": f"{uptime_days} hari, {uptime_hours} jam",
        "source": "simulated"
    }


async def get_device_performance_stats(device_id: int) -> dict:
    """Gather device CPU, Memory, and Uptime using SNMP, CLI fallback, or simulated fallback."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        return {"cpu": 0, "ram": 0, "uptime": "—", "source": "simulated"}

    device_dict = dict(row)
    status = device_dict.get("status", "unknown")
    
    if status != "online":
        return get_simulated_performance(device_id, status)
        
    # Determine vendor key
    vendor = get_vendor_key(device_dict.get("device_type", ""))
    
    # 1. Try SNMP
    community = device_dict.get("snmp_community")
    if community:
        ip = device_dict.get("ip")
        snmp_ver = device_dict.get("snmp_version", "v2c")
        snmp_res = await fetch_snmp_performance(ip, community, snmp_ver, vendor)
        if snmp_res:
            return snmp_res

    # 2. Try CLI Fallback
    protocol = device_dict.get("protocol", "ssh").lower()
    if protocol in ("ssh", "telnet"):
        try:
            username, password = get_device_credentials(device_dict)
            device_dict["username"] = username
            if username and password:
                cli_res = await fetch_cli_performance(device_dict, password, vendor)
                if cli_res:
                    return cli_res
        except Exception as e:
            logger.debug(f"CLI performance query failed for {device_dict.get('ip')}: {e}")

    # 3. Fallback to simulation
    return get_simulated_performance(device_id, status)
