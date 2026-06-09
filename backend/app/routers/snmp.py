import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import get_db_conn, get_device_credentials
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, get_cmd, next_cmd, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)
from app.services.connector import get_info_raw

def _parse_cli_output(raw: str, device_type: str) -> tuple[str, str, str, str]:
    if not raw or raw.startswith("ERROR:"):
        return "", "", "", ""
    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device_type)
    res = driver.parse_info(raw)
    return (
        res.get("os_version") or "",
        res.get("serial_number") or "",
        res.get("mac_address") or "",
        res.get("hardware_model") or ""
    )


def _parse_sys_descr(sys_descr: str, device_type: str) -> tuple[str, str]:
    if not sys_descr:
        return "", ""
    from app.core.drivers import driver_manager
    driver = driver_manager.match_driver_by_sys_descr(sys_descr, device_type)
    res = driver.parse_snmp_sys_descr(sys_descr)
    return (
        res.get("os_version") or "",
        res.get("hardware_model") or ""
    )


async def walk_first_val(ip: str, community: str, mp_model: int, oid_str: str) -> str:
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
        snmpEngine = SnmpEngine()
        authData = CommunityData(community, mpModel=mp_model)
        contextData = ContextData()
        
        start_oid_clean = oid_str.strip('.')
        prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
        varBinds = [ObjectType(ObjectIdentity(oid_str))]
        
        while True:
            res = await next_cmd(snmpEngine, authData, transport, contextData, *varBinds)
            errorIndication, errorStatus, errorIndex, varBindTable = res
            if errorIndication or errorStatus or not varBindTable:
                break
                
            firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
            if not firstVarBinds:
                break
            
            current_var_bind = firstVarBinds[0]
            current_oid_tuple = current_var_bind[0].asTuple()
            
            if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                break
                
            val = current_var_bind[1]
            if val:
                if oid_str in ('1.3.6.1.2.1.2.2.1.6', '1.3.6.1.4.1.1991.1.1.1.1.2', '1.3.6.1.4.1.1991.1.1.1.1.11'):
                    val_bytes = val.asOctets() if hasattr(val, 'asOctets') else bytes(val)
                    if len(val_bytes) == 6:
                        mac = ":".join(f"{x:02x}" for x in val_bytes).upper()
                        if mac != "00:00:00:00:00:00":
                            return mac
                else:
                    val_str = val.prettyPrint().strip()
                    if val_str and "NoSuch" not in val_str:
                        return val_str
                        
            varBinds = firstVarBinds
    except Exception:
        pass
    return ""

router = APIRouter(prefix="/api/snmp", tags=["snmp"])

class SNMPTestRaw(BaseModel):
    ip: str
    version: str = "v2c"
    community: str
    port: int = 161

@router.post("/test-raw")
async def test_snmp_raw(body: SNMPTestRaw):
    """
    Test SNMP connection to a raw target IP and fetch sysDescr and sysUpTime.
    """
    # Convert version string to pysnmp mpModel
    mp_model = 1 if body.version == "v2c" else 0

    try:
        transport = await UdpTransportTarget.create((body.ip, body.port), timeout=3.0, retries=1)
        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            SnmpEngine(),
            CommunityData(body.community, mpModel=mp_model),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0')), # sysDescr
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.3.0'))  # sysUpTime
        )

        if errorIndication:
            raise HTTPException(status_code=500, detail=f"SNMP Error: {errorIndication}")
        elif errorStatus:
            raise HTTPException(status_code=500, detail=f"SNMP Error: {errorStatus.prettyPrint()} at {errorIndex}")
        else:
            sys_descr = ""
            sys_uptime = ""
            for varBind in varBinds:
                oid = varBind[0].prettyPrint()
                val = varBind[1].prettyPrint()
                if "1.3.6.1.2.1.1.1.0" in oid:
                    sys_descr = val
                elif "1.3.6.1.2.1.1.3.0" in oid:
                    try:
                        ticks = int(val)
                        seconds = ticks / 100.0
                        sys_uptime = f"{seconds} seconds"
                    except:
                        sys_uptime = val

            return {
                "success": True,
                "message": "SNMP Connection Successful",
                "data": {
                    "sysDescr": sys_descr,
                    "sysUpTime": sys_uptime
                }
            }

    except Exception as e:
        err_msg = str(e)
        clean_msg = f"SNMP Error: {err_msg}"
        if "No SNMP response" in err_msg or "timeout" in err_msg.lower():
            clean_msg = "SNMP Timeout: Perangkat tidak dapat dijangkau di port 161 atau Community string salah."
        raise HTTPException(status_code=400, detail=clean_msg)

@router.post("/test/{device_id}")
async def test_snmp(device_id: int):
    """
    Test SNMP connection to a device and fetch sysDescr and sysUpTime.
    Requires device to have snmp_community set.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT ip, snmp_version, snmp_community FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    ip = row["ip"]
    version = row["snmp_version"] or "v2c"
    community = row["snmp_community"]

    if not community:
        raise HTTPException(status_code=400, detail="SNMP Community belum dikonfigurasi untuk perangkat ini.")

    # Convert version string to pysnmp mpModel
    mp_model = 1 if version == "v2c" else 0

    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=3.0, retries=1)
        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            SnmpEngine(),
            CommunityData(community, mpModel=mp_model),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0')), # sysDescr
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.3.0'))  # sysUpTime
        )

        if errorIndication:
            raise HTTPException(status_code=500, detail=f"SNMP Error: {errorIndication}")
        elif errorStatus:
            raise HTTPException(status_code=500, detail=f"SNMP Error: {errorStatus.prettyPrint()} at {errorIndex}")
        else:
            sys_descr = ""
            sys_uptime = ""
            for varBind in varBinds:
                oid = varBind[0].prettyPrint()
                val = varBind[1].prettyPrint()
                if "1.3.6.1.2.1.1.1.0" in oid:
                    sys_descr = val
                elif "1.3.6.1.2.1.1.3.0" in oid:
                    # sysUpTime is usually in hundredths of a second
                    try:
                        ticks = int(val)
                        seconds = ticks / 100.0
                        sys_uptime = f"{seconds} seconds"
                    except:
                        sys_uptime = val

            return {
                "success": True,
                "message": "SNMP Connection Successful",
                "data": {
                    "sysDescr": sys_descr,
                    "sysUpTime": sys_uptime
                }
            }

    except Exception as e:
        err_msg = str(e)
        clean_msg = f"SNMP Error: {err_msg}"
        if "No SNMP response" in err_msg or "timeout" in err_msg.lower():
            clean_msg = "SNMP Timeout: Perangkat tidak dapat dijangkau di port 161 atau Community string salah."
        raise HTTPException(status_code=400, detail=clean_msg)

@router.post("/detect-info/{device_id}")
async def detect_snmp_info(device_id: int, method: str = "auto"):
    """
    Detect device hardware info using SNMP, CLI, or both.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    device_dict = dict(row)
    ip = device_dict["ip"]
    version = device_dict["snmp_version"] or "v2c"
    community = device_dict["snmp_community"]
    device_type = device_dict.get("device_type", "")
    
    username, password = get_device_credentials(device_dict)
    device_dict["username"] = username

    # 1. Gather SNMP Data if applicable
    snmp_os = ""
    snmp_model = ""
    snmp_serial = ""
    snmp_mac = ""
    snmp_success = False

    if method in ("auto", "snmp", "compare") and community:
        mp_model = 1 if version == "v2c" else 0
        try:
            # sysDescr
            transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                SnmpEngine(),
                CommunityData(community, mpModel=mp_model),
                transport,
                ContextData(),
                ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0'))
            )
            if not errorIndication and not errorStatus and varBinds:
                snmp_success = True
                sys_descr = varBinds[0][1].prettyPrint()
                snmp_os, snmp_model = _parse_sys_descr(sys_descr, device_type)

                # walk for serial
                snmp_serial = await walk_first_val(ip, community, mp_model, '1.3.6.1.2.1.47.1.1.1.1.11')
                # walk for mac
                snmp_mac = await walk_first_val(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.6')
                if "ruckus" in device_type.lower() or "fastiron" in sys_descr.lower():
                    # Try Brocade/Ruckus chassis MAC OIDs
                    ruckus_mac = await walk_first_val(ip, community, mp_model, '1.3.6.1.4.1.1991.1.1.1.1.2')
                    if not ruckus_mac:
                        ruckus_mac = await walk_first_val(ip, community, mp_model, '1.3.6.1.4.1.1991.1.1.1.1.11')
                    if ruckus_mac:
                        snmp_mac = ruckus_mac

                # Walk for model name if empty or generic
                if not snmp_model or snmp_model.lower() in ("wireless", "fastiron"):
                    snmp_model_mib = await walk_first_val(ip, community, mp_model, '1.3.6.1.2.1.47.1.1.1.1.13')
                    if snmp_model_mib:
                        snmp_model = snmp_model_mib
        except Exception:
            pass

    # 2. Gather CLI Data if applicable
    cli_os = ""
    cli_model = ""
    cli_serial = ""
    cli_mac = ""
    cli_raw = ""
    cli_success = False

    if method in ("auto", "cli", "compare"):
        raw_output = await get_info_raw(device_dict, password)
        if not raw_output.startswith("ERROR:"):
            cli_success = True
            cli_raw = raw_output
            cli_os, cli_serial, cli_mac, cli_model = _parse_cli_output(raw_output, device_type)

    # 3. Handle result based on method
    if method == "compare":
        conn.close()
        return {
            "success": True,
            "compare": True,
            "snmp": {
                "os_version": snmp_os,
                "hardware_model": snmp_model,
                "serial_number": snmp_serial,
                "mac_address": snmp_mac
            },
            "cli": {
                "os_version": cli_os,
                "hardware_model": cli_model,
                "serial_number": cli_serial,
                "mac_address": cli_mac,
                "raw_info": cli_raw
            }
        }

    # Otherwise (auto, snmp, cli): Resolve final data and save to DB
    final_os = ""
    final_model = ""
    final_serial = ""
    final_mac = ""
    final_raw = ""

    if method == "snmp":
        if not snmp_success:
            conn.close()
            raise HTTPException(status_code=400, detail="Deteksi via SNMP gagal atau tidak dijangkau.")
        final_os = snmp_os
        final_model = snmp_model
        final_serial = snmp_serial
        final_mac = snmp_mac
        final_raw = f"SNMP System Description: {snmp_os}"
    elif method == "cli":
        if not cli_success:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Deteksi via CLI gagal: {cli_raw}")
        final_os = cli_os
        final_model = cli_model
        final_serial = cli_serial
        final_mac = cli_mac
        final_raw = cli_raw
    else: # auto
        # Merge: CLI takes priority if successful (more specific / detailed), otherwise SNMP
        final_os = cli_os or snmp_os
        final_model = cli_model or snmp_model
        final_serial = cli_serial or snmp_serial
        final_mac = cli_mac or snmp_mac
        final_raw = cli_raw if cli_success else f"SNMP System Description: {snmp_os}"

    # Update database
    c.execute("""
        UPDATE devices 
        SET os_version = ?, serial_number = ?, mac_address = ?, hardware_model = ?, raw_info = ?
        WHERE id = ?
    """, (final_os, final_serial, final_mac, final_model, final_raw, device_id))
    conn.commit()
    conn.close()

    method_used = "SNMP" if (method == "snmp" or (method == "auto" and snmp_success and not cli_success)) else "CLI"
    if method == "auto" and snmp_success and cli_success:
        method_used = "SNMP & CLI (Merged)"

    return {
        "success": True,
        "message": f"Informasi perangkat berhasil disinkronkan via {method_used}.",
        "data": {
            "os_version": final_os,
            "serial_number": final_serial,
            "mac_address": final_mac,
            "hardware_model": final_model,
            "raw_info": final_raw
        }
    }

def get_expected_speed_mbps(if_name: str) -> int:
    """Returns the expected speed in Mbps based on interface name, or 0 if unknown."""
    name_lower = if_name.lower()
    
    # 100G
    if any(name_lower.startswith(x) for x in ('hu', 'hundredgig')) or '100g' in name_lower:
        return 100000
    # 40G
    if any(name_lower.startswith(x) for x in ('fo', 'fortygig')) or '40g' in name_lower:
        return 40000
    # 25G
    if '25g' in name_lower:
        return 25000
        
    # 10G
    if name_lower.startswith('tengig') or '10g' in name_lower or \
       (name_lower.startswith('te') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('xe'):
        return 10000
        
    # 1G
    if name_lower.startswith('gigabit') or '1g' in name_lower or \
       (name_lower.startswith('gi') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('ge') or '1000base' in name_lower:
        return 1000
        
    # 100M
    if name_lower.startswith('fastethernet') or \
       (name_lower.startswith('fa') and any(x.isdigit() for x in name_lower)) or \
       name_lower.startswith('fe'):
        return 100
        
    # 10G/40G/100G Juniper 'et-'
    if name_lower.startswith('et-'):
        return 100000
    
    # 10M
    if name_lower.startswith('ethernet') or \
       (name_lower.startswith('et') and any(x.isdigit() for x in name_lower)):
        return 10
        
    return 0

def is_physical_interface(if_name: str, device_type: str = "") -> bool:
    """Checks if the interface is a physical device port (not virtual/logical/mgmt)."""
    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device_type)
    return driver.is_physical_interface(if_name)


def parse_show_interface_status(cli_output: str, device_type: str = "ruijie") -> list[dict]:
    """
    Parses 'show interface status' output.
    Returns list of dicts with: name, status, admin_status, speed, speed_mbps, vlan, duplex
    """
    from app.core.drivers import driver_manager
    driver = driver_manager.get_driver(device_type)
    return driver.parse_show_interface_status(cli_output)


@router.get("/interfaces/{device_id}")
async def get_snmp_interfaces(device_id: int):
    # Fetch device
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    device_dict = dict(row)
    ip = device_dict["ip"]
    version = device_dict["snmp_version"] or "v2c"
    community = device_dict["snmp_community"]

    if not community:
        # Check if we can do CLI fallback directly if community is not configured
        protocol = device_dict.get("protocol", "ssh").lower()
        if protocol not in ("ssh", "telnet"):
            raise HTTPException(status_code=400, detail="SNMP Community belum dikonfigurasi untuk perangkat ini.")

    mp_model = 1 if version == "v2c" else 0

    from pysnmp.hlapi.v3arch.asyncio import next_cmd, SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
    import time
    import asyncio
    
    # We will walk ifDescr, ifOperStatus, ifSpeed, ifHighSpeed, ifPhysAddress
    async def walk_oid(oid_str):
        results = {}
        try:
            transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
            snmpEngine = SnmpEngine()
            authData = CommunityData(community, mpModel=mp_model)
            contextData = ContextData()
            
            start_oid_clean = oid_str.strip('.')
            prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
            varBinds = [ObjectType(ObjectIdentity(oid_str))]
            
            while True:
                res = await next_cmd(snmpEngine, authData, transport, contextData, *varBinds)
                errorIndication, errorStatus, errorIndex, varBindTable = res
                if errorIndication or errorStatus or not varBindTable:
                    break
                    
                firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
                if not firstVarBinds:
                    break
                
                current_var_bind = firstVarBinds[0]
                current_oid_tuple = current_var_bind[0].asTuple()
                
                if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                    break
                    
                idx = current_oid_tuple[-1]
                val = current_var_bind[1]
                results[idx] = val.prettyPrint()
                
                varBinds = firstVarBinds
        except Exception:
            pass
        return results

    # Step 1: Query first sample (T1) in parallel
    t1 = time.time()
    res = await asyncio.gather(
        walk_oid('1.3.6.1.2.1.2.2.1.2'),     # descrs (ifDescr)
        walk_oid('1.3.6.1.2.1.2.2.1.8'),     # statuses (ifOperStatus)
        walk_oid('1.3.6.1.2.1.2.2.1.5'),     # speeds (ifSpeed)
        walk_oid('1.3.6.1.2.1.31.1.1.1.15'), # high_speeds (ifHighSpeed)
        walk_oid('1.3.6.1.2.1.2.2.1.6'),     # macs (ifPhysAddress)
        walk_oid('1.3.6.1.2.1.31.1.1.1.18'), # aliases (ifAlias)
        walk_oid('1.3.6.1.2.1.2.2.1.4'),     # mtus (ifMtu)
        walk_oid('1.3.6.1.2.1.2.2.1.3'),     # types (ifType)
        walk_oid('1.3.6.1.2.1.2.2.1.10'),    # in_octets_t1 (ifInOctets)
        walk_oid('1.3.6.1.2.1.2.2.1.16'),    # out_octets_t1 (ifOutOctets)
        walk_oid('1.3.6.1.2.1.31.1.1.1.6'),  # hc_in_t1 (ifHCInOctets)
        walk_oid('1.3.6.1.2.1.31.1.1.1.10'), # hc_out_t1 (ifHCOutOctets)
        walk_oid('1.3.6.1.2.1.2.2.1.14'),    # in_errors_t1 (ifInErrors)
        walk_oid('1.3.6.1.2.1.2.2.1.20'),    # out_errors_t1 (ifOutErrors)
        walk_oid('1.3.6.1.2.1.10.7.2.1.3'),  # crc_errors_t1 (dot3StatsFCSErrors)
        walk_oid('1.3.6.1.2.1.10.7.2.1.2'),  # frame_errors_t1 (dot3StatsAlignmentErrors)
        walk_oid('1.3.6.1.2.1.2.2.1.13'),    # in_discards_t1 (ifInDiscards)
        walk_oid('1.3.6.1.2.1.2.2.1.19'),    # out_discards_t1 (ifOutDiscards)
        walk_oid('1.3.6.1.2.1.10.7.2.1.8'),  # late_collisions_t1 (dot3StatsLateCollisions)
        walk_oid('1.3.6.1.2.1.2.2.1.7'),     # admin_statuses (ifAdminStatus)
    )
    
    descrs, statuses, speeds, high_speeds, macs, aliases, mtus, types, in_octets_t1, out_octets_t1, hc_in_t1, hc_out_t1, in_errors_t1, out_errors_t1, crc_errors_t1, frame_errors_t1, in_discards_t1, out_discards_t1, late_collisions_t1, admin_statuses = res

    if not descrs:
        # Check if we can fall back to CLI
        protocol = device_dict.get("protocol", "ssh").lower()
        if protocol in ("ssh", "telnet"):
            try:
                username, password = get_device_credentials(device_dict)
                if username and password:
                    from app.services.connector import connect_and_run
                    # Run show interface status
                    cli_output = await connect_and_run(device_dict, password, "show interface status")
                    if cli_output and not cli_output.startswith("ERROR:"):
                        cli_interfaces = parse_show_interface_status(cli_output, device_dict.get("device_type", ""))
                        if cli_interfaces:
                            # Map to list_ifs format
                            list_ifs = []
                            for idx, item in enumerate(cli_interfaces, 1):
                                list_ifs.append({
                                    "index": idx,
                                    "name": item["name"],
                                    "status": item["status"],
                                    "admin_status": item["admin_status"],
                                    "speed": item["speed"],
                                    "speed_mbps": item["speed_mbps"],
                                    "mac": "",
                                    "alias": "",
                                    "mtu": 1500,
                                    "type": "ethernetCsmacd",
                                    "rx_rate": "0 bps",
                                    "tx_rate": "0 bps",
                                    "rx_util": "0.00%",
                                    "tx_util": "0.00%",
                                    "rx_util_val": 0.0,
                                    "tx_util_val": 0.0,
                                    "rx_err": 0,
                                    "tx_err": 0,
                                    "crc_err": 0,
                                    "frame_err": 0,
                                    "in_discards": 0,
                                    "out_discards": 0,
                                    "late_collisions": 0,
                                    "rx_err_rate": 0.0,
                                    "tx_err_rate": 0.0,
                                    "crc_err_rate": 0.0,
                                    "frame_err_rate": 0.0,
                                    "in_disc_rate": 0.0,
                                    "out_disc_rate": 0.0,
                                    "late_coll_rate": 0.0,
                                    "speed_drop_warning": None,
                                    "health_status": "excellent",
                                    "health_score": 100,
                                    "issues": []
                                })
                            # Sort and return
                            def natural_sort_key(s):
                                return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s["name"])]
                            try:
                                list_ifs.sort(key=natural_sort_key)
                            except:
                                list_ifs.sort(key=lambda x: x["name"])
                            return list_ifs
            except Exception as cli_exc:
                import logging
                logging.getLogger("netx.snmp").error(f"Ruijie/CLI fallback failed for {ip}: {cli_exc}")
        
        raise HTTPException(status_code=400, detail="Gagal mengambil tabel interface via SNMP (Timeout atau port 161 tertutup) dan CLI fallback tidak tersedia.")

    # Step 2: Sleep exactly 1.0 second to measure delta
    await asyncio.sleep(1.0)

    # Step 3: Query second sample (T2) in parallel
    res_t2 = await asyncio.gather(
        walk_oid('1.3.6.1.2.1.2.2.1.10'),    # in_octets_t2
        walk_oid('1.3.6.1.2.1.2.2.1.16'),    # out_octets_t2
        walk_oid('1.3.6.1.2.1.31.1.1.1.6'),  # hc_in_t2
        walk_oid('1.3.6.1.2.1.31.1.1.1.10'), # hc_out_t2
        walk_oid('1.3.6.1.2.1.2.2.1.14'),    # in_errors_t2
        walk_oid('1.3.6.1.2.1.2.2.1.20'),    # out_errors_t2
        walk_oid('1.3.6.1.2.1.10.7.2.1.3'),  # crc_errors_t2
        walk_oid('1.3.6.1.2.1.10.7.2.1.2'),  # frame_errors_t2
        walk_oid('1.3.6.1.2.1.2.2.1.13'),    # in_discards_t2
        walk_oid('1.3.6.1.2.1.2.2.1.19'),    # out_discards_t2
        walk_oid('1.3.6.1.2.1.10.7.2.1.8'),  # late_collisions_t2
    )
    t2 = time.time()
    delta_t = t2 - t1
    if delta_t <= 0:
        delta_t = 1.0

    in_octets_t2, out_octets_t2, hc_in_t2, hc_out_t2, in_errors_t2, out_errors_t2, crc_errors_t2, frame_errors_t2, in_discards_t2, out_discards_t2, late_collisions_t2 = res_t2

    # Status mapping: 1=up, 2=down, etc.
    status_map = {
        '1': 'up',
        '2': 'down',
        '3': 'testing',
        '4': 'unknown',
        '5': 'dormant',
        '6': 'notPresent',
        '7': 'lowerLayerDown'
    }

    # Type mapping dictionary
    type_map = {
        '1': 'other',
        '6': 'ethernetCsmacd',
        '24': 'softwareLoopback',
        '23': 'ppp',
        '135': 'l2vlan',
        '136': 'l3ipvlan',
        '161': 'ieee8023adLag'
    }

    list_ifs = []
    for idx, descr in descrs.items():
        # Clean up descr if it's hex
        if descr.startswith('0x'):
            try:
                descr_str = bytes.fromhex(descr[2:]).decode('utf-8', errors='ignore')
            except:
                descr_str = descr
        else:
            descr_str = descr

        # Skip Null interfaces or empty ones
        if not descr_str or descr_str.lower().startswith('null') or descr_str.lower().startswith('loopback'):
            continue

        raw_status = statuses.get(idx, 'unknown')
        status = status_map.get(raw_status, raw_status)

        raw_admin = admin_statuses.get(idx, 'unknown')
        admin_status = status_map.get(raw_admin, raw_admin)

        # Speed calculation (High speed is in Mbps, standard speed in bps)
        speed_bps = 0
        try:
            high_val = int(high_speeds.get(idx, 0))
            if high_val > 0:
                speed_bps = high_val * 1000000
            else:
                speed_bps = int(speeds.get(idx, 0))
        except:
            pass

        speed_mbps = speed_bps // 1000000

        # Formatting speed string
        if speed_mbps >= 1000:
            speed_str = f"{speed_mbps / 1000:.1f} Gbps".replace('.0 ', ' ')
        elif speed_mbps > 0:
            speed_str = f"{speed_mbps} Mbps"
        else:
            speed_str = "Auto/Unknown"

        # MAC Address formatting
        raw_mac = macs.get(idx, '')
        mac_str = ''
        if raw_mac and raw_mac.startswith('0x'):
            hex_mac = raw_mac[2:]
            if len(hex_mac) == 12:
                mac_str = ":".join(hex_mac[i:i+2] for i in range(0, 12, 2)).upper()
            else:
                mac_str = raw_mac
        else:
            mac_str = raw_mac

        # Alias/description formatting
        alias_raw = aliases.get(idx, '')
        alias_str = ''
        if alias_raw:
            if alias_raw.startswith('0x'):
                try:
                    alias_str = bytes.fromhex(alias_raw[2:]).decode('utf-8', errors='ignore').strip()
                except:
                    alias_str = alias_raw
            else:
                alias_str = alias_raw.strip()

        # MTU & Type
        mtu = 1500
        try:
            mtu = int(mtus.get(idx, 1500))
        except:
            pass

        raw_type = types.get(idx, '1')
        itype = type_map.get(raw_type, f"other ({raw_type})")

        # Bandwidth Calculations
        # Rx Calculations (use 64-bit if available and non-zero, else fall back to 32-bit)
        rx_in_use_64 = idx in hc_in_t1 and idx in hc_in_t2
        if rx_in_use_64:
            rx1 = int(hc_in_t1[idx])
            rx2 = int(hc_in_t2[idx])
            rx_delta = rx2 - rx1
            if rx_delta < 0:
                rx_delta += 2**64
        else:
            rx1 = int(in_octets_t1.get(idx, 0))
            rx2 = int(in_octets_t2.get(idx, 0))
            rx_delta = rx2 - rx1
            if rx_delta < 0:
                rx_delta += 2**32

        # Tx Calculations
        tx_in_use_64 = idx in hc_out_t1 and idx in hc_out_t2
        if tx_in_use_64:
            tx1 = int(hc_out_t1[idx])
            tx2 = int(hc_out_t2[idx])
            tx_delta = tx2 - tx1
            if tx_delta < 0:
                tx_delta += 2**64
        else:
            tx1 = int(out_octets_t1.get(idx, 0))
            tx2 = int(out_octets_t2.get(idx, 0))
            tx_delta = tx2 - tx1
            if tx_delta < 0:
                tx_delta += 2**32

        rx_bps = (rx_delta * 8) / delta_t
        tx_bps = (tx_delta * 8) / delta_t

        # Format Rx Rate
        if rx_bps >= 1000000000:
            rx_rate_str = f"{rx_bps / 1000000000:.2f} Gbps"
        elif rx_bps >= 1000000:
            rx_rate_str = f"{rx_bps / 1000000:.2f} Mbps"
        elif rx_bps >= 1000:
            rx_rate_str = f"{rx_bps / 1000:.2f} Kbps"
        else:
            rx_rate_str = f"{rx_bps:.0f} bps"

        # Format Tx Rate
        if tx_bps >= 1000000000:
            tx_rate_str = f"{tx_bps / 1000000000:.2f} Gbps"
        elif tx_bps >= 1000000:
            tx_rate_str = f"{tx_bps / 1000000:.2f} Mbps"
        elif tx_bps >= 1000:
            tx_rate_str = f"{tx_bps / 1000:.2f} Kbps"
        else:
            tx_rate_str = f"{tx_bps:.0f} bps"

        # Utilization calculation
        rx_util = 0.0
        tx_util = 0.0
        if speed_bps > 0:
            rx_util = (rx_bps / speed_bps) * 100
            tx_util = (tx_bps / speed_bps) * 100
            # Guard against spikes or calculation rounding anomalies
            if rx_util > 100.0: rx_util = 100.0
            if tx_util > 100.0: tx_util = 100.0

        # Port diagnostics and health calculation
        rx_err = 0
        try: rx_err = int(in_errors_t1.get(idx, 0))
        except: pass
        
        tx_err = 0
        try: tx_err = int(out_errors_t1.get(idx, 0))
        except: pass
        
        crc_err = 0
        try: crc_err = int(crc_errors_t1.get(idx, 0))
        except: pass
        
        frame_err = 0
        try: frame_err = int(frame_errors_t1.get(idx, 0))
        except: pass
        
        in_disc = 0
        try: in_disc = int(in_discards_t1.get(idx, 0))
        except: pass
        
        out_disc = 0
        try: out_disc = int(out_discards_t1.get(idx, 0))
        except: pass
        
        late_coll = 0
        try: late_coll = int(late_collisions_t1.get(idx, 0))
        except: pass
        
        # Calculate rates (T2 values)
        rx_err_t2 = 0
        try: rx_err_t2 = int(in_errors_t2.get(idx, 0))
        except: pass
        
        tx_err_t2 = 0
        try: tx_err_t2 = int(out_errors_t2.get(idx, 0))
        except: pass
        
        crc_err_t2 = 0
        try: crc_err_t2 = int(crc_errors_t2.get(idx, 0))
        except: pass
        
        frame_err_t2 = 0
        try: frame_err_t2 = int(frame_errors_t2.get(idx, 0))
        except: pass
        
        in_disc_t2 = 0
        try: in_disc_t2 = int(in_discards_t2.get(idx, 0))
        except: pass
        
        out_disc_t2 = 0
        try: out_disc_t2 = int(out_discards_t2.get(idx, 0))
        except: pass
        
        late_coll_t2 = 0
        try: late_coll_t2 = int(late_collisions_t2.get(idx, 0))
        except: pass
        
        rx_err_rate = max(0.0, (rx_err_t2 - rx_err) / delta_t)
        tx_err_rate = max(0.0, (tx_err_t2 - tx_err) / delta_t)
        crc_err_rate = max(0.0, (crc_err_t2 - crc_err) / delta_t)
        frame_err_rate = max(0.0, (frame_err_t2 - frame_err) / delta_t)
        in_disc_rate = max(0.0, (in_disc_t2 - in_disc) / delta_t)
        out_disc_rate = max(0.0, (out_disc_t2 - out_disc) / delta_t)
        late_coll_rate = max(0.0, (late_coll_t2 - late_coll) / delta_t)
        
        delta_rx_err = max(0, rx_err_t2 - rx_err)
        delta_tx_err = max(0, tx_err_t2 - tx_err)
        delta_crc_err = max(0, crc_err_t2 - crc_err)
        delta_frame_err = max(0, frame_err_t2 - frame_err)
        delta_late_coll = max(0, late_coll_t2 - late_coll)
        
        is_phys = is_physical_interface(descr_str)
        
        speed_drop_warning = None
        if status == 'up' and is_phys:
            expected_speed = get_expected_speed_mbps(descr_str)
            if expected_speed > 0 and speed_mbps > 0 and speed_mbps < expected_speed:
                if expected_speed >= 100000:
                    speed_type = "100G"
                elif expected_speed >= 40000:
                    speed_type = "40G"
                elif expected_speed >= 10000:
                    speed_type = "10G"
                elif expected_speed >= 1000:
                    speed_type = "Gigabit"
                elif expected_speed >= 100:
                    speed_type = "FastEthernet"
                else:
                    speed_type = "Ethernet"
                
                curr_speed_str = f"{speed_mbps / 1000:.1f} Gbps".replace('.0 ', ' ') if speed_mbps >= 1000 else f"{speed_mbps} Mbps"
                speed_drop_warning = f"Port {speed_type} sinkron pada {curr_speed_str} (Kecepatan Turun!)."

        # Health score: 4-tier system (excellent, good, warning, critical)
        # Count active issues for a more granular assessment
        issues = []
        
        # Only check physical errors if it's a physical interface
        if is_phys:
            if crc_err_rate >= 0.05 and delta_crc_err >= 5:
                issues.append({"type": "CRC Errors", "severity": "critical", "detail": f"{crc_err_rate:.2f}/s (Total: {crc_err_t2})", "recommendation": "Ganti kabel LAN atau bersihkan konektor RJ45."})
            elif crc_err_t2 > 100:
                issues.append({"type": "CRC Errors (Historis)", "severity": "warning", "detail": f"Total: {crc_err_t2}", "recommendation": "Monitor kabel, pertimbangkan penggantian."})
            
            if frame_err_rate >= 0.05 and delta_frame_err >= 5:
                issues.append({"type": "Framing Errors", "severity": "critical", "detail": f"{frame_err_rate:.2f}/s (Total: {frame_err_t2})", "recommendation": "Periksa duplex mismatch atau ganti kabel."})
            elif frame_err_t2 > 100:
                issues.append({"type": "Framing Errors (Historis)", "severity": "warning", "detail": f"Total: {frame_err_t2}", "recommendation": "Monitor kondisi kabel secara berkala."})
            
            if rx_err_rate >= 0.1 and delta_rx_err >= 5:
                issues.append({"type": "RX Errors", "severity": "critical", "detail": f"{rx_err_rate:.2f}/s (Total: {rx_err_t2})", "recommendation": "Periksa port fisik dan kabel perangkat asal."})
            elif rx_err_t2 > 50:
                issues.append({"type": "RX Errors (Historis)", "severity": "warning", "detail": f"Total: {rx_err_t2}", "recommendation": "Perhatikan tren error secara berkala."})
            
            if tx_err_rate >= 0.1 and delta_tx_err >= 5:
                issues.append({"type": "TX Errors", "severity": "critical", "detail": f"{tx_err_rate:.2f}/s (Total: {tx_err_t2})", "recommendation": "Periksa sirkuit internal port switch/router."})
            elif tx_err_t2 > 50:
                issues.append({"type": "TX Errors (Historis)", "severity": "warning", "detail": f"Total: {tx_err_t2}", "recommendation": "Monitor sirkuit port ini."})
            
            if late_coll_rate >= 0.05 and delta_late_coll >= 5:
                issues.append({"type": "Late Collisions", "severity": "critical", "detail": f"{late_coll_rate:.2f}/s (Total: {late_coll_t2})", "recommendation": "Periksa duplex mismatch atau kabel terlalu panjang (>100m)."})
            elif late_coll_t2 > 10:
                issues.append({"type": "Late Collisions (Historis)", "severity": "warning", "detail": f"Total: {late_coll_t2}", "recommendation": "Periksa panjang kabel dan konfigurasi duplex."})
            
            if speed_drop_warning:
                issues.append({"type": "Link Speed Drop", "severity": "warning", "detail": speed_drop_warning, "recommendation": "Bersihkan pin port, ganti kabel, atau cek auto-negotiation."})

        # Discards are buffer/QoS issues, checked for all interfaces
        if in_disc_rate > 0.0 or out_disc_rate > 0.0:
            total_disc_rate = in_disc_rate + out_disc_rate
            issues.append({"type": "Packet Discards", "severity": "warning", "detail": f"In: {in_disc_rate:.2f}/s, Out: {out_disc_rate:.2f}/s (Total In: {in_disc_t2}, Out: {out_disc_t2})", "recommendation": "Periksa buffer overrun atau QoS policy."})
        elif (in_disc_t2 + out_disc_t2) > 100:
            issues.append({"type": "Packet Discards (Historis)", "severity": "info", "detail": f"In: {in_disc_t2}, Out: {out_disc_t2}", "recommendation": "Review QoS policy dan kapasitas buffer."})

        # Determine health tier based on issues
        has_critical = any(i["severity"] == "critical" for i in issues)
        has_warning = any(i["severity"] == "warning" for i in issues)
        has_info = any(i["severity"] == "info" for i in issues)
        total_errors = rx_err + tx_err + crc_err + frame_err + in_disc + out_disc + late_coll
        
        if has_critical:
            health_status = 'critical'
            health_score = max(0, 100 - (len([i for i in issues if i['severity'] == 'critical']) * 25) - (len([i for i in issues if i['severity'] == 'warning']) * 10))
        elif has_warning:
            health_status = 'warning'
            health_score = max(30, 100 - (len([i for i in issues if i['severity'] == 'warning']) * 15))
        elif total_errors > 10:
            health_status = 'good'
            health_score = max(60, 90 - min(30, total_errors // 10))
        else:
            health_status = 'excellent'
            health_score = 100

        list_ifs.append({
            "index": idx,
            "name": descr_str,
            "status": status,
            "admin_status": admin_status,
            "speed": speed_str,
            "speed_mbps": speed_mbps,
            "mac": mac_str,
            "alias": alias_str,
            "mtu": mtu,
            "type": itype,
            "rx_rate": rx_rate_str,
            "tx_rate": tx_rate_str,
            "rx_util": f"{rx_util:.2f}%",
            "tx_util": f"{tx_util:.2f}%",
            "rx_util_val": round(rx_util, 2),
            "tx_util_val": round(tx_util, 2),
            "rx_err": rx_err,
            "tx_err": tx_err,
            "crc_err": crc_err,
            "frame_err": frame_err,
            "in_discards": in_disc,
            "out_discards": out_disc,
            "late_collisions": late_coll,
            "rx_err_rate": round(rx_err_rate, 2),
            "tx_err_rate": round(tx_err_rate, 2),
            "crc_err_rate": round(crc_err_rate, 2),
            "frame_err_rate": round(frame_err_rate, 2),
            "in_disc_rate": round(in_disc_rate, 2),
            "out_disc_rate": round(out_disc_rate, 2),
            "late_coll_rate": round(late_coll_rate, 2),
            "speed_drop_warning": speed_drop_warning,
            "health_status": health_status,
            "health_score": health_score,
            "issues": issues
        })

    # Sort interfaces by name using simple natural sort
    def natural_sort_key(s):
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s["name"])]

    try:
        list_ifs.sort(key=natural_sort_key)
    except:
        list_ifs.sort(key=lambda x: x["name"])

    return list_ifs


def resolve_oid_string(oid_str: str, conn) -> str:
    oid_str = oid_str.strip().strip('.')
    if not oid_str:
        return ""
        
    if re.match(r"^[0-9\.]+$", oid_str):
        return oid_str
        
    parts = oid_str.split('.')
    first_part = parts[0]
    
    from app.services.mib_parser import ROOT_OIDS
    resolved_prefix = ""
    if first_part in ROOT_OIDS:
        resolved_prefix = ROOT_OIDS[first_part]
    else:
        c = conn.cursor()
        c.execute("SELECT oid FROM snmp_mib_objects WHERE name = ? LIMIT 1", (first_part,))
        row = c.fetchone()
        if row:
            resolved_prefix = row["oid"]
            
    if resolved_prefix:
        new_oid = ".".join([resolved_prefix] + parts[1:])
        return resolve_oid_string(new_oid, conn)
        
    return oid_str


def get_resolved_db_cache(conn) -> dict:
    """
    Returns a dictionary mapping fully numeric OID -> (object_name, mib_name)
    by recursively resolving relative parent strings.
    """
    cache = {}
    if not conn:
        return cache
    try:
        c = conn.cursor()
        c.execute("""
            SELECT o.name, o.oid, m.name as mib_name 
            FROM snmp_mib_objects o 
            JOIN snmp_mibs m ON o.mib_id = m.id
        """)
        rows = c.fetchall()
        
        name_to_oid = {}
        from app.services.mib_parser import ROOT_OIDS
        for name, oid in ROOT_OIDS.items():
            name_to_oid[name] = oid
            
        raw_objects = []
        for r in rows:
            raw_objects.append({
                "name": r["name"],
                "oid": r["oid"],
                "mib_name": r["mib_name"]
            })
            
        def resolve_val(val: str) -> str:
            val = val.strip().strip('.')
            if not val:
                return ""
            if re.match(r"^[0-9\.]+$", val):
                return val
            parts = val.split('.')
            first = parts[0]
            if first in name_to_oid:
                resolved_prefix = name_to_oid[first]
                new_oid = ".".join([resolved_prefix] + parts[1:])
                return resolve_val(new_oid)
            for obj in raw_objects:
                if obj["name"] == first:
                    resolved_prefix = resolve_val(obj["oid"])
                    if resolved_prefix:
                        name_to_oid[first] = resolved_prefix
                        new_oid = ".".join([resolved_prefix] + parts[1:])
                        return resolve_val(new_oid)
            return val

        for obj in raw_objects:
            resolved_numeric = resolve_val(obj["oid"])
            if resolved_numeric and re.match(r"^[0-9\.]+$", resolved_numeric):
                cache[resolved_numeric] = (obj["name"], obj["mib_name"])
    except Exception:
        pass
        
    return cache


def resolve_numeric_oid_to_name(numeric_oid: str, resolved_cache: dict) -> str:
    numeric_oid = numeric_oid.strip().strip('.')
    if not numeric_oid:
        return ""
        
    parts = numeric_oid.split('.')
    
    # Check prefixes of the numeric OID from longest to shortest
    for i in range(len(parts), 0, -1):
        prefix = ".".join(parts[:i])
        
        # 1. Check database cache
        if prefix in resolved_cache:
            name, mib_name = resolved_cache[prefix]
            suffix = ".".join(parts[i:])
            suffix_str = f".{suffix}" if suffix else ""
            return f"{mib_name}::{name}{suffix_str}"
            
        # 2. Check standard ROOT_OIDS
        from app.services.mib_parser import ROOT_OIDS
        for name, oid in ROOT_OIDS.items():
            if oid == prefix:
                suffix = ".".join(parts[i:])
                suffix_str = f".{suffix}" if suffix else ""
                
                # Determine standard MIB Module
                if name in ("iso", "org", "dod", "internet", "directory", "mgmt", "mib-2", "transmission", "experimental", "private", "enterprises", "security", "snmpV2"):
                    mib_module = "SNMPv2-SMI"
                elif name in ("cisco",):
                    mib_module = "CISCO-SMI"
                elif name in ("fortinet", "fnFortiGateMib"):
                    mib_module = "FORTINET-CORE-MIB"
                else:
                    mib_module = "MIB"
                return f"{mib_module}::{name}{suffix_str}"
                
    return numeric_oid



class SNMPQueryCustom(BaseModel):
    device_id: int
    oid: str
    method: str = "get" # "get" or "walk"

@router.post("/query-custom")
async def query_snmp_custom(body: SNMPQueryCustom):
    """
    Execute a custom SNMP GET or WALK query on a device.
    """
    conn = get_db_conn()
    try:
        resolved_oid = resolve_oid_string(body.oid, conn)
        
        c = conn.cursor()
        c.execute("SELECT ip, snmp_version, snmp_community FROM devices WHERE id = ?", (body.device_id,))
        row = c.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
            
        ip = row["ip"]
        version = row["snmp_version"] or "v2c"
        community = row["snmp_community"]
        
        if not community:
            raise HTTPException(status_code=400, detail="SNMP Community belum dikonfigurasi untuk perangkat ini.")
            
        mp_model = 1 if version == "v2c" else 0
        
        if not resolved_oid or not re.match(r"^[0-9\.]+$", resolved_oid):
            raise HTTPException(
                status_code=400, 
                detail="Format OID tidak valid. Harus berupa deretan angka yang dipisahkan titik atau nama objek MIB terdaftar."
            )

        oid_str = resolved_oid

        # Build database OID resolution cache
        resolved_cache = get_resolved_db_cache(conn)

        transport = await UdpTransportTarget.create((ip, 161), timeout=3.0, retries=1)
        snmpEngine = SnmpEngine()
        authData = CommunityData(community, mpModel=mp_model)
        contextData = ContextData()
        
        if body.method.lower() == "get":
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                snmpEngine,
                authData,
                transport,
                contextData,
                ObjectType(ObjectIdentity(oid_str))
            )
            
            if errorIndication:
                raise HTTPException(status_code=500, detail=f"SNMP GET Error: {errorIndication}")
            elif errorStatus:
                raise HTTPException(status_code=500, detail=f"SNMP GET Error: {errorStatus.prettyPrint()} at {errorIndex}")
            else:
                results = []
                for varBind in varBinds:
                    numeric_oid = ".".join(str(x) for x in varBind[0].asTuple())
                    val = varBind[1]
                    val_str = val.prettyPrint()
                    syntax = val.__class__.__name__
                    resolved_name = resolve_numeric_oid_to_name(numeric_oid, resolved_cache)
                    results.append({
                        "oid": numeric_oid,
                        "name": resolved_name,
                        "value": val_str,
                        "syntax": syntax
                    })
                return {"success": True, "results": results}
                
        else: # walk
            start_oid_clean = oid_str.strip('.')
            prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
            
            varBinds = [ObjectType(ObjectIdentity(oid_str))]
            results = []
            max_iterations = 200
            count = 0
            
            while count < max_iterations:
                res = await next_cmd(snmpEngine, authData, transport, contextData, *varBinds)
                errorIndication, errorStatus, errorIndex, varBindTable = res
                
                if errorIndication or errorStatus or not varBindTable:
                    break
                    
                firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
                if not firstVarBinds:
                    break
                    
                current_var_bind = firstVarBinds[0]
                current_oid_tuple = current_var_bind[0].asTuple()
                
                if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                    break
                    
                numeric_oid = ".".join(str(x) for x in current_var_bind[0].asTuple())
                val = current_var_bind[1]
                val_str = val.prettyPrint()
                syntax = val.__class__.__name__
                resolved_name = resolve_numeric_oid_to_name(numeric_oid, resolved_cache)
                
                results.append({
                    "oid": numeric_oid,
                    "name": resolved_name,
                    "value": val_str,
                    "syntax": syntax
                })
                
                varBinds = firstVarBinds
                count += 1
                
            return {"success": True, "results": results}
            
    except Exception as e:
        err_msg = str(e)
        clean_msg = f"SNMP Query Error: {err_msg}"
        if "No SNMP response" in err_msg or "timeout" in err_msg.lower():
            clean_msg = "SNMP Timeout: Perangkat tidak merespons di port 161."
        raise HTTPException(status_code=400, detail=clean_msg)
    finally:
        conn.close()


@router.get("/l2-status/{device_id}")
async def get_snmp_l2_status(device_id: int):
    """
    Retrieve Layer 2 monitoring status (STP global, STP ports, and VLAN list) via SNMP.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT ip, snmp_version, snmp_community FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
        
    ip = row["ip"]
    version = row["snmp_version"] or "v2c"
    community = row["snmp_community"]
    
    if not community:
        raise HTTPException(status_code=400, detail="SNMP Community belum dikonfigurasi untuk perangkat ini.")
        
    mp_model = 1 if version == "v2c" else 0
    
    # 1. Fetch STP Global stats in parallel
    async def get_global_stp():
        try:
            transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
            errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
                SnmpEngine(),
                CommunityData(community, mpModel=mp_model),
                transport,
                ContextData(),
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.1.0')), # spec
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.2.0')), # priority
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.5.0')), # root bridge
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.6.0')), # root cost
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.7.0')), # root port
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.3.0')), # time since change
                ObjectType(ObjectIdentity('1.3.6.1.2.1.17.2.4.0'))  # top changes
            )
            if not errorIndication and not errorStatus and varBinds:
                vals = [v[1].prettyPrint() for v in varBinds]
                
                # Format Root Bridge ID nicely if binary hex
                raw_root = varBinds[2][1]
                root_bridge_str = vals[2]
                if raw_root and hasattr(raw_root, 'asOctets'):
                    octs = raw_root.asOctets()
                    if len(octs) == 8:
                        priority = int.from_bytes(octs[0:2], byteorder='big')
                        mac = ":".join(f"{x:02x}" for x in octs[2:]).upper()
                        root_bridge_str = f"{priority} / {mac}"
                
                return {
                    "protocol": vals[0],
                    "priority": vals[1],
                    "root_bridge": root_bridge_str,
                    "root_cost": vals[3],
                    "root_port": vals[4],
                    "time_since_change": vals[5],
                    "top_changes": vals[6]
                }
        except Exception:
            pass
        return None

    # Helper walk function
    async def walk_oid(oid_str):
        results = {}
        try:
            transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
            snmpEngine = SnmpEngine()
            authData = CommunityData(community, mpModel=mp_model)
            contextData = ContextData()
            
            start_oid_clean = oid_str.strip('.')
            prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
            varBinds = [ObjectType(ObjectIdentity(oid_str))]
            
            while True:
                res = await next_cmd(snmpEngine, authData, transport, contextData, *varBinds)
                errorIndication, errorStatus, errorIndex, varBindTable = res
                if errorIndication or errorStatus or not varBindTable:
                    break
                    
                firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
                if not firstVarBinds:
                    break
                
                current_var_bind = firstVarBinds[0]
                current_oid_tuple = current_var_bind[0].asTuple()
                
                if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                    break
                    
                idx = current_oid_tuple[-1]
                val = current_var_bind[1]
                results[idx] = val.prettyPrint()
                
                varBinds = firstVarBinds
        except Exception:
            pass
        return results

    # Run everything concurrently
    import asyncio
    res = await asyncio.gather(
        get_global_stp(),
        walk_oid('1.3.6.1.2.1.17.1.4.1.2'),    # bridgePortToIfIndex
        walk_oid('1.3.6.1.2.1.31.1.1.1.1'),   # ifName
        walk_oid('1.3.6.1.2.1.2.2.1.2'),      # ifDescr (fallback)
        walk_oid('1.3.6.1.2.1.17.2.15.1.3'),  # dot1dStpPortState
        walk_oid('1.3.6.1.2.1.17.2.15.1.5'),  # dot1dStpPortPathCost
        walk_oid('1.3.6.1.2.1.17.7.1.4.3.1.2') # dot1qVlanStaticName
    )
    
    stp_global, base_port_to_if, if_names, if_descrs, port_states, port_costs, vlan_names = res
    
    # Map STP Port state to string labels
    stp_states_map = {
        '1': 'disabled',
        '2': 'blocking',
        '3': 'listening',
        '4': 'learning',
        '5': 'forwarding',
        '6': 'broken'
    }
    
    stp_ports = []
    
    # Loop over all detected STP ports
    for bridge_port, state_code in port_states.items():
        # Get standard ifIndex
        if_idx_str = base_port_to_if.get(bridge_port)
        if_name = f"Port {bridge_port}"
        
        if if_idx_str:
            try:
                if_idx = int(if_idx_str)
                # Map to physical name
                raw_name = if_names.get(if_idx) or if_descrs.get(if_idx)
                if raw_name:
                    if raw_name.startswith('0x'):
                        try:
                            if_name = bytes.fromhex(raw_name[2:]).decode('utf-8', errors='ignore')
                        except Exception:
                            if_name = raw_name
                    else:
                        if_name = raw_name
            except ValueError:
                pass
                
        state_str = stp_states_map.get(state_code, f"unknown ({state_code})")
        cost = port_costs.get(bridge_port, "—")
        
        stp_ports.append({
            "bridge_port": bridge_port,
            "if_index": if_idx_str or "—",
            "interface_name": if_name,
            "state": state_str,
            "path_cost": cost
        })
        
    # Sort ports naturally
    stp_ports.sort(key=lambda x: x["interface_name"])
    
    # Map VLANs list
    vlans = []
    for vlan_id, name in vlan_names.items():
        # Hex decode if necessary
        vname = name
        if name.startswith('0x'):
            try:
                vname = bytes.fromhex(name[2:]).decode('utf-8', errors='ignore')
            except Exception:
                pass
        vlans.append({
            "vlan_id": vlan_id,
            "name": vname
        })
        
    vlans.sort(key=lambda x: x["vlan_id"])
    
    return {
        "stp_enabled": stp_global is not None or len(stp_ports) > 0,
        "stp_global": stp_global or {},
        "stp_ports": stp_ports,
        "vlans": vlans
    }

