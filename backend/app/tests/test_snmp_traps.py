import unittest
import asyncio
import json
from datetime import datetime
from app.database import get_db_conn, init_db
from app.services.snmp_trap_receiver import _save_trap_to_db, _process_trap_reactions

class TestSnmpTraps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("DELETE FROM snmp_traps WHERE device_id = 99998 OR source_ip IN ('192.168.200.200', '192.168.200.10')")
        c.execute("DELETE FROM device_l2_interfaces WHERE device_id = 99998")
        c.execute("DELETE FROM network_anomalies WHERE device_id = 99998")
        c.execute("DELETE FROM devices WHERE id = 99998")
        
        # Insert shared device 99998
        c.execute("""
            INSERT INTO devices (id, name, ip, protocol, username, password, status, snmp_community, snmp_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (99998, "MockTrapSwitch", "192.168.200.10", "ssh", "admin", "admin", "online", "public", "v2c", datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def tearDown(self):
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("DELETE FROM snmp_traps WHERE device_id = 99998 OR source_ip IN ('192.168.200.200', '192.168.200.10')")
        c.execute("DELETE FROM device_l2_interfaces WHERE device_id = 99998")
        c.execute("DELETE FROM network_anomalies WHERE device_id = 99998")
        c.execute("DELETE FROM devices WHERE id = 99998")
        conn.commit()
        conn.close()

    def test_save_trap_to_db(self):
        conn = get_db_conn()
        c = conn.cursor()
        try:
            varbinds = {"1.3.6.1.2.1.2.2.1.1.1": "1", "1.3.6.1.2.1.2.2.1.2.1": "GigabitEthernet0/1"}
            _save_trap_to_db(
                source_ip="192.168.200.200",
                version="v2c",
                community="public",
                trap_oid="1.3.6.1.6.3.1.1.5.3", # linkDown
                uptime=543210,
                varbinds_dict=varbinds,
                device_id=99998
            )
            
            c.execute("SELECT * FROM snmp_traps WHERE source_ip = '192.168.200.200'")
            row = c.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["generic_trap"], 2) # linkDown map is 2
            self.assertEqual(row["uptime"], 543210)
            self.assertEqual(row["device_id"], 99998)
            
            saved_varbinds = json.loads(row["varbinds"])
            self.assertEqual(saved_varbinds["1.3.6.1.2.1.2.2.1.2.1"], "GigabitEthernet0/1")
        finally:
            conn.close()

    def test_trap_reactions_down_and_up(self):
        async def run_test():
            conn = get_db_conn()
            c = conn.cursor()
            try:
                # Setup mock L2 interface
                c.execute("""
                    INSERT INTO device_l2_interfaces (device_id, interface_name, oper_status, fetched_at)
                    VALUES (?, ?, ?, ?)
                """, (99998, "GigabitEthernet0/1", "up", datetime.now().isoformat()))
                conn.commit()
                
                # 1. Simulate LinkDown Trap
                varbinds = {
                    "1.3.6.1.2.1.2.2.1.1.1": "1", # ifIndex = 1
                    "1.3.6.1.2.1.2.2.1.2.1": "GigabitEthernet0/1" # ifDescr
                }
                
                await _process_trap_reactions(
                    source_ip="192.168.200.10",
                    trap_oid="1.3.6.1.6.3.1.1.5.3", # linkDown OID
                    varbinds_dict=varbinds,
                    device_id=99998
                )
                
                # Check that interface went down
                c.execute("SELECT oper_status FROM device_l2_interfaces WHERE device_id = 99998 AND interface_name = 'GigabitEthernet0/1'")
                status = c.fetchone()["oper_status"]
                self.assertEqual(status, "down")
                
                # Check that anomaly was created
                c.execute("SELECT * FROM network_anomalies WHERE device_id = 99998 AND anomaly_type = 'port_flapping' AND is_active = 1")
                anomaly = c.fetchone()
                self.assertIsNotNone(anomaly)
                self.assertEqual(anomaly["interface_name"], "GigabitEthernet0/1")
                
                # 2. Simulate LinkUp Trap
                await _process_trap_reactions(
                    source_ip="192.168.200.10",
                    trap_oid="1.3.6.1.6.3.1.1.5.4", # linkUp OID
                    varbinds_dict=varbinds,
                    device_id=99998
                )
                
                # Check that interface went back up
                c.execute("SELECT oper_status FROM device_l2_interfaces WHERE device_id = 99998 AND interface_name = 'GigabitEthernet0/1'")
                status = c.fetchone()["oper_status"]
                self.assertEqual(status, "up")
                
                # Check that anomaly was resolved (is_active = 0)
                c.execute("SELECT * FROM network_anomalies WHERE device_id = 99998 AND anomaly_type = 'port_flapping'")
                anomaly = c.fetchone()
                self.assertEqual(anomaly["is_active"], 0)
                self.assertIsNotNone(anomaly["resolved_at"])
                
            finally:
                conn.close()
                
        asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()
