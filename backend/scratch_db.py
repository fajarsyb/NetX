import sqlite3
import os
conn = sqlite3.connect(os.path.join("data", "netx.db"))
conn.row_factory = sqlite3.Row
c = conn.cursor()
c.execute("SELECT id, name, ip, device_type, hardware_model, os_version, serial_number FROM devices WHERE device_type LIKE '%allied%'")
rows = c.fetchall()
print(f"Found {len(rows)} Allied devices:")
for r in rows:
    print(dict(r))
conn.close()
