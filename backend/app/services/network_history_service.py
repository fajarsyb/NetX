import asyncio
import logging
import random
from datetime import datetime, timedelta
from app.database import get_db_conn

logger = logging.getLogger("netx.network_history_service")


def seed_network_history():
    """Seeds 30 days of mock history for unique ARP and MAC counts if the history table is empty."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM network_history")
    count = c.fetchone()[0]
    if count == 0:
        logger.info("Seeding network_history with 30 days of mock data...")

        # Get current counts to use as baseline
        c.execute("SELECT COUNT(DISTINCT mac_address) FROM arp_cache WHERE mac_address IS NOT NULL AND mac_address != ''")
        arp_base = c.fetchone()[0] or 120

        c.execute("SELECT COUNT(DISTINCT mac_address) FROM mac_addresses WHERE mac_address IS NOT NULL AND mac_address != ''")
        mac_base = c.fetchone()[0] or 180

        # Enforce minimums for better demonstration if cache is empty
        if arp_base < 10:
            arp_base = 120
        if mac_base < 10:
            mac_base = 180

        now = datetime.now()
        records = []

        # Seed 30 days of data, sampled every 2 hours
        for hours_ago in range(30 * 24, -1, -2):
            dt = now - timedelta(hours=hours_ago)

            # diurnal cycle: peak activity at 14:00 (2:00 PM), low at 2:00 AM
            hour_factor = 0.75 + 0.25 * (1.0 - abs(dt.hour - 14) / 12.0)
            # weekend drop: 20-30% fewer active devices on Saturday/Sunday
            weekday_factor = 0.75 if dt.weekday() >= 5 else 1.0

            # random fluctuation
            noise_arp = random.uniform(-4, 4)
            noise_mac = random.uniform(-6, 6)

            arp_val = int(arp_base * hour_factor * weekday_factor + noise_arp)
            mac_val = int(mac_base * hour_factor * weekday_factor + noise_mac)

            arp_val = max(5, arp_val)
            mac_val = max(10, mac_val)

            records.append((arp_val, mac_val, dt.isoformat()))

        c.executemany(
            "INSERT INTO network_history (arp_count, mac_count, fetched_at) VALUES (?, ?, ?)",
            records
        )
        conn.commit()
        logger.info(f"Successfully seeded {len(records)} network history points.")
    conn.close()


def record_network_history_snapshot():
    """Queries current unique ARP and MAC address count, and saves a history record."""
    conn = get_db_conn()
    c = conn.cursor()

    c.execute("SELECT COUNT(DISTINCT mac_address) FROM arp_cache WHERE mac_address IS NOT NULL AND mac_address != ''")
    arp_cnt = c.fetchone()[0] or 0

    c.execute("SELECT COUNT(DISTINCT mac_address) FROM mac_addresses WHERE mac_address IS NOT NULL AND mac_address != ''")
    mac_cnt = c.fetchone()[0] or 0

    now = datetime.now().isoformat()

    c.execute(
        "INSERT INTO network_history (arp_count, mac_count, fetched_at) VALUES (?, ?, ?)",
        (arp_cnt, mac_cnt, now)
    )
    conn.commit()
    conn.close()
    logger.info(f"Recorded network history snapshot: unique ARP={arp_cnt}, unique MAC={mac_cnt}")


async def start_network_history_scheduler():
    """Continuous loop running in the background, executing a snapshot every 10 minutes."""
    logger.info("Initializing Network History Scheduler...")
    
    # Auto-seed mock data if database table is empty
    try:
        seed_network_history()
    except Exception as e:
        logger.error(f"Error seeding network history: {e}")

    # Immediately capture the first active state
    try:
        record_network_history_snapshot()
    except Exception as e:
        logger.error(f"Error taking initial network history snapshot: {e}")

    while True:
        await asyncio.sleep(600)  # Wait 10 minutes
        try:
            record_network_history_snapshot()
        except Exception as e:
            logger.error(f"Error in network history snapshot scheduler tick: {e}")
