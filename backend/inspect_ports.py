from app.database import get_db_conn

def inspect():
    conn = get_db_conn()
    c = conn.cursor()
    for dev_id in [13, 11, 80]:
        c.execute("SELECT interface_name, oper_status, link_speed FROM interface_stats_latest WHERE device_id = ?", (dev_id,))
        rows = c.fetchall()
        print(f"=== DEVICE {dev_id}: {len(rows)} interfaces ===")
        for r in rows[:25]:
            print(dict(r))
        print("-" * 50)
    conn.close()

if __name__ == "__main__":
    inspect()
