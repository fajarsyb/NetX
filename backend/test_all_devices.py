import asyncio
import logging
from app.database import get_db_conn
from app.routers.snmp import detect_snmp_info

logging.basicConfig(level=logging.INFO)

async def main():
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, ip, device_type FROM devices")
    devices = c.fetchall()
    conn.close()

    print(f"Ditemukan {len(devices)} perangkat untuk dites.")
    
    results = []
    
    for dev in devices:
        dev_id = dev["id"]
        name = dev["name"]
        ip = dev["ip"]
        dtype = dev["device_type"]
        
        print(f"\n--- Menguji {name} ({ip} - {dtype}) ---")
        try:
            res = await detect_snmp_info(dev_id)
            print(f"SUCCESS: {res['message']}")
            print(f"Data: {res['data']}")
            results.append({"id": dev_id, "name": name, "status": "Success", "data": res['data']})
        except Exception as e:
            print(f"FAILED: {str(e)}")
            results.append({"id": dev_id, "name": name, "status": "Failed", "error": str(e)})

    print("\n\n=== REKAP HASIL ===")
    for r in results:
      status = r['status']
      if status == 'Success':
        d = r['data']
        print(f"[OK] {r['name']} - {d['hardware_model']} (OS: {d['os_version']}) - SN: {d['serial_number']}")
      else:
        print(f"[FAIL] {r['name']} - {r['error']}")

if __name__ == "__main__":
    asyncio.run(main())
