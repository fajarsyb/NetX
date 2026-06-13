import unittest
from fastapi.testclient import TestClient
import sys
import os

# Ensure backend directory is in python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from datetime import datetime
from main import app
from app.database import get_db_conn
from app.services.auth import hash_password

class TestIntegrationAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.test_username = "integration_test_user_unique"
        cls.test_password = "integration_test_pass"
        cls.hashed = hash_password(cls.test_password)
        
        # Insert test user directly into database
        conn = get_db_conn()
        c = conn.cursor()
        # Clean up any potential leftover from a failed run
        c.execute("DELETE FROM users WHERE username = ?", (cls.test_username,))
        c.execute("""
            INSERT INTO users (username, password, full_name, role, is_active, created_at)
            VALUES (?, ?, ?, 'admin', 1, ?)
        """, (cls.test_username, cls.hashed, "Integration Test User", datetime.now().isoformat()))
        conn.commit()
        cls.test_user_id = c.lastrowid
        conn.close()

    @classmethod
    def tearDownClass(cls):
        # Clean up test user
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("DELETE FROM users WHERE username = ?", (cls.test_username,))
        conn.commit()
        conn.close()

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_unauthorized_endpoints(self):
        # Accessing protected routes without token should return 401
        for route in ["/api/devices", "/api/system-settings", "/api/remote-backups"]:
            res = self.client.get(route)
            self.assertEqual(res.status_code, 401)

    def test_login_and_auth_flow(self):
        # 1. Login with OAuth2 Password Flow
        response = self.client.post(
            "/api/auth/login",
            data={"username": self.test_username, "password": self.test_password}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("access_token", data)
        token = data["access_token"]
        
        # 2. Use token to get current user info
        headers = {"Authorization": f"Bearer {token}"}
        res_me = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(res_me.status_code, 200)
        user_info = res_me.json()
        self.assertEqual(user_info["username"], self.test_username)
        self.assertEqual(user_info["role"], "admin")

        # 3. Use token to get system settings
        res_settings = self.client.get("/api/system-settings", headers=headers)
        self.assertEqual(res_settings.status_code, 200)
        self.assertIn("ping_auto_refresh_enabled", res_settings.json())
