import asyncio
import sys
import os
from app.database import get_db_conn, get_device_credentials
from app.services.connector import connect_and_run

async def test_device():
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = 51")
    row = c.fetchone()
    conn.close()

    if not row:
        print("Device 51 not found!")
        return

    device = dict(row)
    username, password = get_device_credentials(device)
    device["username"] = username

    print(f"Connecting to {device['name']} ({device['ip']}) as {device['username']}...")
    
    # Let's run show system
    output_system = await connect_and_run(device, password, "show system")
    print("\n=== RAW OUTPUT FOR 'show system' ===")
    print(output_system)
    
    # Let's run show version
    output_version = await connect_and_run(device, password, "show version")
    print("\n=== RAW OUTPUT FOR 'show version' ===")
    print(output_version)

if __name__ == "__main__":
    asyncio.run(test_device())
