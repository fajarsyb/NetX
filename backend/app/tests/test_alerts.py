import unittest
import time
from unittest.mock import patch, MagicMock
import sys
import os

# Ensure backend directory is in python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.services.alert_service import trigger_anomaly_alert, _ALERT_COOLDOWN, COOLDOWN_WINDOW_SECONDS

class TestAlertServiceDeduplication(unittest.TestCase):
    def setUp(self):
        # Clear the global registry before each test
        _ALERT_COOLDOWN.clear()

    @patch("app.services.alert_service._send_alerts_background")
    def test_alert_bypass_for_test_alerts(self, mock_send):
        # Sending test_alert twice should trigger _send_alerts_background twice (bypassing cooldown)
        trigger_anomaly_alert(1, "test_alert", "info", "Gi0/1", "Test message", "2026-06-13T00:00:00")
        trigger_anomaly_alert(1, "test_alert", "info", "Gi0/1", "Test message", "2026-06-13T00:00:00")
        
        # Give a split second for threads to spawn
        time.sleep(0.1)
        self.assertEqual(mock_send.call_count, 2)

    @patch("app.services.alert_service._send_alerts_background")
    def test_alert_deduplication_cooldown(self, mock_send):
        # Sending a regular alert twice within the window should trigger it only once
        trigger_anomaly_alert(1, "broadcast_storm", "critical", "Gi0/1", "Storm detected", "2026-06-13T00:00:00")
        trigger_anomaly_alert(1, "broadcast_storm", "critical", "Gi0/1", "Storm detected", "2026-06-13T00:00:05")
        
        time.sleep(0.1)
        self.assertEqual(mock_send.call_count, 1)

    @patch("app.services.alert_service._send_alerts_background")
    def test_alert_distinct_keys(self, mock_send):
        # Distinct anomaly types should not suppress each other
        trigger_anomaly_alert(1, "broadcast_storm", "critical", "Gi0/1", "Storm detected", "2026-06-13T00:00:00")
        trigger_anomaly_alert(1, "cpu_high", "warning", "Gi0/1", "CPU at 90%", "2026-06-13T00:00:00")
        
        # Distinct devices should not suppress each other
        trigger_anomaly_alert(2, "broadcast_storm", "critical", "Gi0/1", "Storm detected", "2026-06-13T00:00:00")
        
        time.sleep(0.1)
        self.assertEqual(mock_send.call_count, 3)
