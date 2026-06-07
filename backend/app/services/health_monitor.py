"""
NetX Self-Health Monitoring Service
Tracks internal diagnostics such as DB query latency, event loop lag, throughput, and disk usage.
"""
import os
import time
import shutil
from pathlib import Path
from datetime import datetime, timedelta

# Global Diagnostics State
class HealthMonitor:
    def __init__(self):
        # Database query performance
        self.db_query_count = 0
        self.db_total_latency = 0.0  # seconds
        
        # Scans (throughput)
        self.scan_timestamps = []  # list of timestamps of completed scans
        
        # Event loop lag
        self.loop_lag_ms = 0.0

    def record_db_latency(self, duration_seconds: float):
        self.db_query_count += 1
        self.db_total_latency += duration_seconds

    def record_scan_completed(self):
        self.scan_timestamps.append(time.time())
        # Keep only the last 15 minutes of scan history to prevent growth
        cutoff = time.time() - 900
        self.scan_timestamps = [t for t in self.scan_timestamps if t > cutoff]

    def set_loop_lag(self, lag_ms: float):
        self.loop_lag_ms = lag_ms

    def get_db_latency_average_ms(self) -> float:
        if self.db_query_count == 0:
            return 0.0
        return (self.db_total_latency / self.db_query_count) * 1000.0

    def get_analyzer_throughput(self) -> float:
        # Calculate scans per minute over the last 5 minutes
        now = time.time()
        cutoff = now - 300  # 5 minutes
        recent_scans = [t for t in self.scan_timestamps if t > cutoff]
        
        # Normalize to scans per minute
        return len(recent_scans) / 5.0

    def get_disk_usage(self) -> dict:
        backend_dir = Path(__file__).parent.parent.parent
        db_path = backend_dir / "data" / "netx.db"
        
        # Disk usage of the drive containing the backend folder
        try:
            total, used, free = shutil.disk_usage(str(backend_dir))
            free_percent = (free / total) * 100.0
        except Exception:
            total, used, free, free_percent = 0, 0, 0, 0.0

        # SQLite database file size
        db_size_mb = 0.0
        if db_path.exists():
            db_size_mb = os.path.getsize(db_path) / (1024 * 1024)

        return {
            "total_gb": round(total / (1024**3), 2),
            "used_gb": round(used / (1024**3), 2),
            "free_gb": round(free / (1024**3), 2),
            "free_percent": round(free_percent, 1),
            "db_size_mb": round(db_size_mb, 2)
        }

    def get_diagnostics(self) -> dict:
        db_latency = self.get_db_latency_average_ms()
        throughput = self.get_analyzer_throughput()
        disk = self.get_disk_usage()
        
        # Determine alerts
        alerts = []
        status = "healthy"
        
        # 1. DB Query Latency Alert
        if db_latency > 300.0:
            status = "degraded"
            alerts.append({
                "component": "Database Latency",
                "severity": "critical",
                "message": f"Latensi rata-rata query database sangat tinggi: {round(db_latency, 1)} ms"
            })
        elif db_latency > 100.0:
            if status == "healthy":
                status = "warning"
            alerts.append({
                "component": "Database Latency",
                "severity": "warning",
                "message": f"Latensi rata-rata query database meningkat: {round(db_latency, 1)} ms"
            })

        # 2. Event Loop Lag Alert
        if self.loop_lag_ms > 500.0:
            status = "degraded"
            alerts.append({
                "component": "Event Loop",
                "severity": "critical",
                "message": f"Lag event loop terdeteksi kritis: {round(self.loop_lag_ms, 1)} ms"
            })
        elif self.loop_lag_ms > 150.0:
            if status == "healthy":
                status = "warning"
            alerts.append({
                "component": "Event Loop",
                "severity": "warning",
                "message": f"Lag event loop asinkron meningkat: {round(self.loop_lag_ms, 1)} ms"
            })

        # 3. Disk Space Alert
        if disk["free_percent"] > 0.0:  # check if valid data returned
            if disk["free_percent"] < 5.0:
                status = "degraded"
                alerts.append({
                    "component": "Disk Space",
                    "severity": "critical",
                    "message": f"Kapasitas penyimpanan hampir habis: {disk['free_percent']}% tersisa"
                })
            elif disk["free_percent"] < 15.0:
                if status == "healthy":
                    status = "warning"
                alerts.append({
                    "component": "Disk Space",
                    "severity": "warning",
                    "message": f"Kapasitas penyimpanan tersisa menipis: {disk['free_percent']}% tersisa"
                })

        return {
            "status": status,
            "timestamp": datetime.now().isoformat(),
            "metrics": {
                "db_query_count": self.db_query_count,
                "db_query_latency_ms": round(db_latency, 2),
                "event_loop_lag_ms": round(self.loop_lag_ms, 2),
                "analyzer_throughput_scans_per_min": round(throughput, 2),
                "disk_usage": disk,
                "redis_queue": {
                    "configured": False,
                    "status": "Inactive",
                    "lag_ms": 0.0,
                    "message": "Redis tidak digunakan. Menggunakan antrean asinkron internal."
                }
            },
            "alerts": alerts
        }

# Singleton instance
monitor = HealthMonitor()


async def start_event_loop_monitor():
    """Periodically measures the event loop lag and updates the monitor."""
    import asyncio
    import logging
    logger = logging.getLogger("netx.health_loop")
    logger.info("Initializing Asyncio Event Loop Health Monitor...")
    
    interval = 2.0
    while True:
        t0 = asyncio.get_event_loop().time()
        await asyncio.sleep(interval)
        t1 = asyncio.get_event_loop().time()
        
        elapsed = t1 - t0
        lag_ms = max(0.0, (elapsed - interval) * 1000.0)
        monitor.set_loop_lag(lag_ms)
