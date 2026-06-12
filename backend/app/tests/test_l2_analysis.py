import unittest
import asyncio
from datetime import datetime
from app.database import get_db_conn, init_db
from app.services.l2_service import L2AnalysisService, normalize_mac, parse_duration

class TestL2Analysis(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Initialize schema once before testing L2 lifecycle
        init_db()

    def test_normalize_mac(self):
        # Test basic MAC normalization
        self.assertEqual(normalize_mac("001a.e2b0.1100"), "00:1A:E2:B0:11:00")
        self.assertEqual(normalize_mac("00-1a-e2-b0-11-00"), "00:1A:E2:B0:11:00")
        self.assertEqual(normalize_mac("00:1a:e2:b0:11:00"), "00:1A:E2:B0:11:00")
        self.assertEqual(normalize_mac("001ae2b01100"), "00:1A:E2:B0:11:00")
        # Test invalid or empty MAC address
        self.assertEqual(normalize_mac(""), "")
        self.assertEqual(normalize_mac(None), "")
        self.assertEqual(normalize_mac("SHORT"), "SHORT")

    def test_parse_duration(self):
        # Test duration parsing
        self.assertEqual(parse_duration(90), "1m")
        self.assertEqual(parse_duration(3600), "1h")
        self.assertEqual(parse_duration(86400), "1d")
        self.assertEqual(parse_duration(86400 + 3600 + 120), "1d 1h 2m")
        # Test edge/invalid values
        self.assertEqual(parse_duration(None), "—")
        self.assertEqual(parse_duration(-5), "—")

    def test_simulation_data_generation(self):
        async def run_test():
            device = {
                "id": 99999,
                "name": "TestSimSwitch",
                "ip": "192.168.99.99",
                "device_type": "juniper_junos",
                "device_role": "Access Switch",
                "hardware_model": "EX3400-24P",
                "snmp_community": "public",
                "snmp_version": "v2c",
                "status": "offline"
            }
            res = await L2AnalysisService._generate_simulated_data(device)
            self.assertIn("stp", res)
            self.assertIn("vlans", res)
            self.assertIn("interfaces", res)
            self.assertIn("macs", res)
            self.assertIn("port_security", res)
            self.assertIn("scores", res)
            
            # Verify interface name matches prefix for juniper
            for inf in res["interfaces"]:
                self.assertTrue(inf["interface_name"].startswith("ge-0/0/"))

            # Check scores
            scores = res["scores"]
            self.assertIn("l2", scores)
            self.assertIn("port", scores)
            self.assertIn("stp", scores)
            self.assertIn("sfp", scores)
            self.assertIn("loop_risk", scores)
            self.assertIn("broadcast_risk", scores)

        asyncio.run(run_test())

    def test_db_lifecycle_and_correlation(self):
        async def run_test():
            conn = get_db_conn()
            c = conn.cursor()
            
            # Ensure mock device doesn't exist
            c.execute("DELETE FROM devices WHERE id = 99999")
            # Insert a mock device
            c.execute("""
                INSERT INTO devices (
                    id, name, ip, protocol, port, username, password,
                    device_type, status, created_at, snmp_community, snmp_version, device_role
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                99999, "MockL2Switch", "172.18.99.99", "ssh", 22, "admin", "admin",
                "cisco_ios", "offline", datetime.now().isoformat(), "public", "v2c", "Access Switch"
            ))
            conn.commit()

            try:
                # Run L2 sync (should trigger simulation fallback)
                sync_res = await L2AnalysisService.refresh_device_l2_data(99999)
                self.assertTrue(sync_res["success"])
                self.assertEqual(sync_res["device_id"], 99999)
                
                # Check DB persistence
                c.execute("SELECT * FROM device_l2_spanning_tree WHERE device_id = 99999")
                stp_row = c.fetchone()
                self.assertIsNotNone(stp_row)
                self.assertEqual(stp_row["stp_mode"], "rapid-pvst")

                c.execute("SELECT * FROM device_l2_interfaces WHERE device_id = 99999")
                ports = c.fetchall()
                self.assertTrue(len(ports) > 0)
                
                # Verify that loop timeline events were logged (since mock data generates loop anomalies on port 5)
                c.execute("SELECT * FROM device_l2_timeline WHERE device_id = 99999")
                timeline = c.fetchall()
                self.assertTrue(len(timeline) > 0)
                
                # Ensure loop_detected event type exists
                event_types = [t["event_type"] for t in timeline]
                self.assertIn("loop_detected", event_types)
                
            finally:
                # Cleanup DB entries for device 99999
                c.execute("DELETE FROM device_l2_spanning_tree WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_stp_ports WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_vlans WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_interfaces WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_port_security WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_macs WHERE device_id = 99999")
                c.execute("DELETE FROM device_l2_timeline WHERE device_id = 99999")
                c.execute("DELETE FROM devices WHERE id = 99999")
                conn.commit()
                conn.close()

        asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()
