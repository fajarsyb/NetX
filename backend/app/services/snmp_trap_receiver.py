import os
import json
import logging
import asyncio
from datetime import datetime
from pysnmp.entity import engine, config
from pysnmp.carrier.asyncio.dgram import udp
from pysnmp.entity.rfc3413 import ntfrcv
from app.database import get_db_conn
from app.services.alert_service import trigger_anomaly_alert

logger = logging.getLogger("netx.snmp_trap_receiver")

# Global stop flag
stop_receiver = False

def register_device_communities(snmpEngine):
    """Fetches unique SNMP communities from devices and registers them in SnmpEngine."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT DISTINCT snmp_community FROM devices WHERE snmp_community IS NOT NULL")
        rows = c.fetchall()
    except Exception as e:
        logger.error(f"Failed to fetch SNMP communities from DB: {e}")
        rows = []
    finally:
        conn.close()
    
    communities = {'public', 'private'} # standard defaults
    for r in rows:
        c_val = r["snmp_community"].strip() if r["snmp_community"] else ""
        if c_val:
            communities.add(c_val)
            
    for community in communities:
        try:
            config.addV1System(snmpEngine, community, community)
        except Exception:
            pass

def _save_trap_to_db(source_ip, version, community, trap_oid, uptime, varbinds_dict, device_id=None):
    """Saves parsed SNMP Trap metadata and varbind payload to DB."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        now_iso = datetime.now().isoformat()
        
        generic_trap = None
        specific_trap = None
        enterprise_oid = None
        
        generic_map = {
            "1.3.6.1.6.3.1.1.5.1": 0, # coldStart
            "1.3.6.1.6.3.1.1.5.2": 1, # warmStart
            "1.3.6.1.6.3.1.1.5.3": 2, # linkDown
            "1.3.6.1.6.3.1.1.5.4": 3, # linkUp
            "1.3.6.1.6.3.1.1.5.5": 4, # authenticationFailure
            "1.3.6.1.6.3.1.1.5.6": 5, # egpNeighborLoss
        }
        
        if trap_oid in generic_map:
            generic_trap = generic_map[trap_oid]
        else:
            generic_trap = 6 # enterpriseSpecific
            try:
                parts = trap_oid.split('.')
                specific_trap = int(parts[-1])
                enterprise_oid = ".".join(parts[:-2])
            except:
                pass
                
        varbinds_json = json.dumps(varbinds_dict)
        
        c.execute("""
            INSERT INTO snmp_traps (device_id, source_ip, version, community, enterprise_oid, generic_trap, specific_trap, uptime, varbinds, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (device_id, source_ip, version, community, enterprise_oid, generic_trap, specific_trap, uptime, varbinds_json, now_iso))
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to save SNMP Trap to database: {e}")
    finally:
        conn.close()

async def resolve_ifname_via_snmp(ip, community, version, if_idx):
    """Helper to dynamically fetch interface name from device using SNMP GET."""
    try:
        from pysnmp.hlapi.v3arch.asyncio import get_cmd, SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
        mp_model = 1 if version == "v2c" else 0
        transport = await UdpTransportTarget.create((ip, 161), timeout=1.5, retries=1)
        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            SnmpEngine(),
            CommunityData(community, mpModel=mp_model),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(f"1.3.6.1.2.1.31.1.1.1.1.{if_idx}")),
            ObjectType(ObjectIdentity(f"1.3.6.1.2.1.2.2.1.2.{if_idx}"))
        )
        if not errorIndication and not errorStatus and varBinds:
            if varBinds[0][1] and not varBinds[0][1].prettyPrint().startswith("No"):
                return varBinds[0][1].prettyPrint()
            if varBinds[1][1] and not varBinds[1][1].prettyPrint().startswith("No"):
                return varBinds[1][1].prettyPrint()
    except Exception as e:
        logger.warning(f"Failed to query SNMP for ifname on index {if_idx}: {e}")
    return None

async def _process_trap_reactions(source_ip, trap_oid, varbinds_dict, device_id):
    """Triggers L2 interface changes and alerts on active LinkUp / LinkDown SNMP Traps."""
    if not device_id:
        return
        
    generic_map = {
        "1.3.6.1.6.3.1.1.5.3": "linkDown",
        "1.3.6.1.6.3.1.1.5.4": "linkUp",
    }
    
    trap_event = generic_map.get(trap_oid)
    if not trap_event:
        return
        
    logger.info(f"Processing reactive monitoring update for {source_ip}: {trap_event}")
    
    # 1. Resolve ifIndex
    if_idx = None
    for k, v in varbinds_dict.items():
        if k.startswith("1.3.6.1.2.1.2.2.1.1."):
            try:
                if_idx = int(v)
            except:
                pass
            break
            
    if if_idx is None:
        for k in varbinds_dict.keys():
            if k.startswith("1.3.6.1.2.1.2.2.1.8.") or k.startswith("1.3.6.1.2.1.2.2.1.7."):
                try:
                    if_idx = int(k.split('.')[-1])
                except:
                    pass
                break
                
    if if_idx is None:
        logger.warning("Link trap received but ifIndex could not be extracted.")
        return
        
    # 2. Get device parameters
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name, snmp_version, snmp_community FROM devices WHERE id = ?", (device_id,))
    dev_row = c.fetchone()
    conn.close()
    
    if not dev_row:
        return
        
    device_name = dev_row["name"]
    community = dev_row["snmp_community"]
    version = dev_row["snmp_version"] or "v2c"
    
    # 3. Resolve Interface Name
    ifname = None
    for k, v in varbinds_dict.items():
        if k.startswith("1.3.6.1.2.1.31.1.1.1.1.") or k.startswith("1.3.6.1.2.1.2.2.1.2."):
            if v and not v.startswith("No"):
                ifname = v
                break
                
    if not ifname:
        ifname = await resolve_ifname_via_snmp(source_ip, community, version, if_idx)
        
    if not ifname:
        ifname = f"Interface #{if_idx}"
        
    status_val = "up" if trap_event == "linkUp" else "down"
    
    # 4. Save interface changes
    conn = get_db_conn()
    c = conn.cursor()
    try:
        now_iso = datetime.now().isoformat()
        c.execute("""
            SELECT interface_name FROM device_l2_interfaces 
            WHERE device_id = ? AND interface_name = ?
        """, (device_id, ifname))
        row = c.fetchone()
        
        if row:
            c.execute("""
                UPDATE device_l2_interfaces 
                SET oper_status = ?, fetched_at = ?
                WHERE device_id = ? AND interface_name = ?
            """, (status_val, now_iso, device_id, ifname))
        else:
            c.execute("""
                INSERT INTO device_l2_interfaces (device_id, interface_name, oper_status, fetched_at)
                VALUES (?, ?, ?, ?)
            """, (device_id, ifname, status_val, now_iso))
            
        # 5. Handle Network Anomalies
        if trap_event == "linkDown":
            c.execute("""
                SELECT id FROM network_anomalies 
                WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
            """, (device_id, ifname))
            anom_row = c.fetchone()
            
            if not anom_row:
                details = f"Interface {ifname} status berubah menjadi DOWN (Dideteksi melalui SNMP Trap)."
                c.execute("""
                    INSERT INTO network_anomalies (device_id, anomaly_type, severity, interface_name, details, is_active, detected_at)
                    VALUES (?, 'port_flapping', 'warning', ?, ?, 1, ?)
                """, (device_id, ifname, details, now_iso))
                
                trigger_anomaly_alert(device_id, 'port_flapping', 'warning', ifname, details, now_iso)
                logger.warning(f"SNMP Trap Anomaly: Link Down on {device_name}:{ifname}")
        else:
            c.execute("""
                UPDATE network_anomalies 
                SET is_active = 0, resolved_at = ?
                WHERE device_id = ? AND anomaly_type = 'port_flapping' AND interface_name = ? AND is_active = 1
            """, (now_iso, device_id, ifname))
            logger.info(f"SNMP Trap Anomaly Resolved: Link Up on {device_name}:{ifname}")
            
        conn.commit()
    except Exception as ex:
        logger.error(f"Failed to process L2 interface update from Trap: {ex}")
    finally:
        conn.close()

def cbFun(snmpEngine, stateReference, contextEngineId, contextName, varBinds, cbCtx):
    """Callback triggered by PySNMP on receiving SNMP Traps."""
    try:
        transportDomain, transportAddress = snmpEngine.msgAndPduDsp.getTransportInfo(stateReference)
        source_ip = transportAddress[0]
    except Exception as e:
        logger.warning(f"Failed to resolve transport address from stateReference: {e}")
        source_ip = "0.0.0.0"
        
    version = "v2c"
    community = "public"
    
    varbinds_dict = {}
    trap_oid = ""
    uptime = None
    
    for varBind in varBinds:
        oid_str = ".".join(str(x) for x in varBind[0].asTuple())
        val = varBind[1]
        val_str = val.prettyPrint()
        
        varbinds_dict[oid_str] = val_str
        
        if oid_str == "1.3.6.1.2.1.1.3.0":
            try:
                uptime = int(val)
            except:
                pass
        elif oid_str == "1.3.6.1.6.3.1.1.4.1.0":
            trap_oid = val_str
            
    # Resolve device mapping
    device_id = None
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT id FROM devices WHERE ip = ?", (source_ip,))
        row = c.fetchone()
        if row:
            device_id = row["id"]
    except Exception as e:
        logger.error(f"Failed to query device IP for incoming Trap: {e}")
    finally:
        conn.close()
        
    # Persist the trap payload
    _save_trap_to_db(source_ip, version, community, trap_oid, uptime, varbinds_dict, device_id)
    
    # Process updates / alerts in background task
    if trap_oid:
        asyncio.create_task(_process_trap_reactions(source_ip, trap_oid, varbinds_dict, device_id))

async def start_snmp_trap_receiver(port: int = None, fallback_port: int = 1620):
    """Binds to UDP port 162 (standard SNMP trap port) and starts the Trap listener daemon."""
    global stop_receiver
    if port is None:
        port = int(os.environ.get("SNMP_TRAP_PORT", 162))
        
    snmpEngine = engine.SnmpEngine()
    
    bound_port = port
    try:
        logger.info(f"Mencoba mengikat server SNMP Trap ke port UDP {port}...")
        config.addTransport(
            snmpEngine,
            udp.domainName,
            udp.UdpTransport().openServerMode(('0.0.0.0', port))
        )
        logger.info(f"Server SNMP Trap AKTIF dan mendengarkan pada port UDP {port}.")
    except Exception as e:
        logger.warning(f"Gagal mengikat server SNMP Trap ke port UDP {port}: {e}")
        logger.warning(f"Mencoba mengikat ke port alternatif {fallback_port}...")
        try:
            config.addTransport(
                snmpEngine,
                udp.domainName,
                udp.UdpTransport().openServerMode(('0.0.0.0', fallback_port))
            )
            bound_port = fallback_port
            logger.info(f"Server SNMP Trap AKTIF dan mendengarkan pada port UDP {fallback_port}.")
        except Exception as ex:
            logger.error(f"Gagal total mengikat server SNMP Trap ke port UDP {fallback_port}: {ex}")
            return None
            
    # Load communities dynamically
    register_device_communities(snmpEngine)
    
    # Register notification receiver callback
    ntfrcv.NotificationReceiver(snmpEngine, cbFun)
    
    # Prevent dispatcher from exiting immediately
    dispatcher = snmpEngine.transportDispatcher
    dispatcher.jobStarted(1)
    
    try:
        while not stop_receiver:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        logger.info("SNMP Trap Receiver dispatcher task cancelled.")
    finally:
        dispatcher.jobFinished(1)
        try:
            dispatcher.closeTransport(udp.domainName)
        except:
            pass
        logger.info("SNMP Trap Receiver shut down.")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] snmp_trap_daemon: %(message)s")
    
    async def run_daemon():
        await start_snmp_trap_receiver()
        
    try:
        asyncio.run(run_daemon())
    except KeyboardInterrupt:
        logger.info("Daemon stopped.")
