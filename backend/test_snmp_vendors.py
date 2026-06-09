import asyncio
from app.database import get_db_conn
from pysnmp.hlapi.v3arch.asyncio import SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, next_cmd

async def walk_oid(ip, community, mp_model, oid_str):
    results = {}
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=2.0, retries=1)
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
        print(f"Error walking {ip} OID {oid_str}: {e}")
    finally:
        try: engine.close_dispatcher()
        except: pass
    return results

async def test_devices():
    conn = get_db_conn()
    c = conn.cursor()
    
    # Let's test Ruijie (11), Ruckus (13), Allied (80)
    for dev_id in [11, 13, 80]:
        c.execute("SELECT name, ip, snmp_version, snmp_community, device_type FROM devices WHERE id = ?", (dev_id,))
        row = c.fetchone()
        if not row:
            print(f"Device {dev_id} not found in DB")
            continue
            
        print(f"=== Testing Device {row['name']} ({row['ip']}, {row['device_type']}) ===")
        ip = row["ip"]
        community = row["snmp_community"]
        version = row["snmp_version"] or "v2c"
        mp_model = 1 if version == "v2c" else 0
        
        if not community:
            print("No SNMP community configured.")
            continue
            
        # Walk ifDescr (1.3.6.1.2.1.2.2.1.2) and ifType (1.3.6.1.2.1.2.2.1.3)
        descrs = await walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.2')
        types = await walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.3')
        statuses = await walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.8')
        
        print(f"Successfully walked {len(descrs)} interfaces.")
        for idx in sorted(descrs.keys()):
            descr = descrs[idx]
            if descr.startswith('0x'):
                try: descr = bytes.fromhex(descr[2:]).decode('utf-8', errors='ignore')
                except: pass
            itype = types.get(idx, 'unknown')
            status = statuses.get(idx, 'unknown')
            print(f"Index {idx}: Name='{descr}', ifType={itype}, status={status}")
        print("=" * 60)
        
    conn.close()

if __name__ == "__main__":
    asyncio.run(test_devices())
