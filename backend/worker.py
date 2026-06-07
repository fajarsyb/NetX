import asyncio
import os
import logging
from app.services.device_backup_service import start_device_backup_scheduler
from app.services.network_history_service import start_network_history_scheduler
from app.services.anomaly_detector import start_anomaly_detection_scheduler
from app.services.syslog_server import start_syslog_server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("netx.worker")

async def main():
    logger.info("Initializing NetX Background Worker Engine...")
    
    # Start the device configuration backup scheduler in the background
    asyncio.create_task(start_device_backup_scheduler())
    # Start the network history tracker in the background
    asyncio.create_task(start_network_history_scheduler())
    # Start the network anomaly detection scheduler in the background
    asyncio.create_task(start_anomaly_detection_scheduler())
    # Start the syslog UDP server in the background
    syslog_transport = await start_syslog_server()
    
    if syslog_transport is None:
        logger.warning("Syslog UDP Server failed to bind. Running other schedulers...")
        # Keep the worker loop alive manually if syslog didn't bind
        while True:
            await asyncio.sleep(3600)
    else:
        # Keep running while syslog transport is active
        try:
            while not syslog_transport.is_closing():
                await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Worker runtime error: {e}")
        finally:
            syslog_transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("NetX Background Worker Engine stopped by user.")
