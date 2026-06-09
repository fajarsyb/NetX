from app.database import get_db_conn

def main():
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT d.id, d.name, d.ip, d.device_type, d.snmp_community, d.snmp_version, d.status,
               (SELECT COUNT(*) FROM interface_stats_latest WHERE device_id = d.id) as stats_count
        FROM devices d
    """)
    rows = c.fetchall()
    
    print(f"{'ID':<4} | {'Name':<35} | {'IP':<15} | {'Type':<18} | {'Community':<12} | {'Ver':<4} | {'Status':<7} | {'Ports':<5}")
    print("-" * 115)
    for r in rows:
        print(f"{r['id']:<4} | {r['name'][:35]:<35} | {r['ip']:<15} | {r['device_type']:<18} | {r['snmp_community']:<12} | {r['snmp_version'] or 'N/A':<4} | {r['status']:<7} | {r['stats_count']:<5}")
    conn.close()

if __name__ == "__main__":
    main()
