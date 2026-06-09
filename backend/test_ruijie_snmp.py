import asyncio
import socket
from app.database import get_db_conn
from pysnmp.hlapi.v3arch.asyncio import SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, next_cmd

def ping_ip(ip):
    try:
        # Simple socket connection check on port 161 (SNMP) or ICMP ping simulation
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1.0)
        s.connect((ip, 161))
        s.close()
        return True
    except Exception as e:
        return False

async def walk_oid(ip, community, mp_model, oid_str):
    results = {}
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.5, retries=1)
        authData = CommunityData(community, mpModel=mp_model)
        contextData = ContextData()
        
        start_oid_clean = oid_str.strip('.')
        prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
        varBinds = [ObjectType(ObjectIdentity(oid_str))]
        
        while True:
            res = await next_cmd(engine, authData, transport, contextData, *varBinds)
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
    except Exception as e:
        print(f"[{ip}] SNMP walk error: {e}")
    finally:
        try: engine.close_dispatcher()
        except: pass
    return results

async def main():
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, ip, snmp_community, snmp_version FROM devices WHERE device_type = 'ruijie_os'")
    ruijies = c.fetchall()
    
    print(f"Found {len(ruijies)} Ruijie devices in DB.")
    for r in ruijies:
        dev_id = r["id"]
        name = r["name"]
        ip = r["ip"]
        community = r["snmp_community"]
        version = r["snmp_version"] or "v2c"
        mp_model = 1 if version == "v2c" else 0
        
        is_up = ping_ip(ip)
        print(f"Ruijie {name} ({ip}): Network reachable on port 161 DGRAM = {is_up}")
        
        if is_up:
            # Let's try SNMP SysDescr walk
            sys_desc = await walk_oid(ip, community, mp_model, '1.3.6.1.2.1.1.1')
            print(f"  SysDescr: {sys_desc}")
            
            descrs = await walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.2')
            print(f"  Walked {len(descrs)} descrs.")
            if descrs:
                print("  Sample interface descrs:")
                for idx in list(descrs.keys())[:5]:
                    print(f"    Index {idx}: {descrs[idx]}")
                    
    conn.close()

if __name__ == "__main__":
    asyncio.run(main())
