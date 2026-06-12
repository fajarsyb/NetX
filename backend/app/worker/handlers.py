import logging
import os
import asyncio


logger = logging.getLogger("netx.worker.handlers")

async def handle_job(task_name: str, params: dict):
    logger.info(f"Executing handler for task: {task_name} with params: {params}")
    
    # Define system/mock user context
    user_context = {"id": params.get("user_id", 1), "username": params.get("username", "system")}
    from app.core.plugins import plugin_manager
    import inspect

    def is_serial_device(device_id: int) -> bool:
        from app.database import get_db_conn
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT protocol FROM devices WHERE id = ?", (device_id,))
        row = c.fetchone()
        conn.close()
        return bool(row and row["protocol"] == "serial")

    if task_name == "device_backup":
        if is_serial_device(params["device_id"]):
            logger.info(f"Skipping backup for serial device {params['device_id']}")
            return {"success": True, "skipped": True, "message": "Serial device skipped from background backup"}
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        result = await handler(
            device_id=params["device_id"],
            only_if_changed=params.get("only_if_changed", False),
            user_id=user_context["id"],
            username=user_context["username"]
        )
        logger.info(f"Backup job for device {params['device_id']} completed: {result}")
        return result

    elif task_name == "device_backup_schedule":
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        schedule = {
            "id": params["schedule_id"],
            "name": f"Schedule #{params['schedule_id']}",
            "device_ids": params["device_ids"]
        }
        await handler(schedule)
        logger.info(f"Scheduled backup job completed for schedule {params['schedule_id']}")

    elif task_name == "network_history_snapshot":
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        if inspect.iscoroutinefunction(handler):
            await handler()
        else:
            handler()
        logger.info("Network history snapshot completed.")

    elif task_name == "anomaly_scan":
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        if inspect.iscoroutinefunction(handler):
            await handler()
        else:
            handler()
        logger.info("Anomaly detection scan completed.")

    elif task_name in ("refresh_arp", "refresh_lldp", "refresh_cdp", "refresh_mac", "refresh_l2"):
        if is_serial_device(params["device_id"]):
            logger.info(f"Skipping {task_name} for serial device {params['device_id']}")
            return {"success": True, "skipped": True, "message": f"Serial device skipped from {task_name}"}
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        return await handler(params["device_id"], user=user_context)


    elif task_name == "detect_snmp_info":
        if is_serial_device(params["device_id"]):
            logger.info(f"Skipping SNMP detection for serial device {params['device_id']}")
            return {"success": True, "skipped": True, "message": "Serial device skipped from SNMP detection"}
        from app.routers.snmp import detect_snmp_info
        return await detect_snmp_info(params["device_id"], method=params.get("method", "auto"))

    elif task_name == "bulk_refresh":
        await handle_bulk_refresh(params)

    elif task_name == "ping_all_devices":
        await run_ping_all_devices()

    elif task_name == "bulk_ping":
        await handle_bulk_ping(params)

    else:
        raise ValueError(f"Unknown task name: {task_name}")

def save_ping_result(device_id: int, rtt_ms: float, loss_pct: int, reachable: bool):
    from app.database import get_db_conn
    from datetime import datetime
    
    status = "online" if reachable else "offline"
    checked_at = datetime.now().isoformat()
    
    conn = get_db_conn()
    c = conn.cursor()
    
    # 1. Update devices table
    c.execute(
        """
        UPDATE devices 
        SET ping_rtt_ms = ?, ping_loss_pct = ?, ping_checked_at = ?, status = ? 
        WHERE id = ?
        """,
        (rtt_ms, loss_pct, checked_at, status, device_id)
    )
    
    # 2. Insert into device_ping_history
    c.execute(
        """
        INSERT INTO device_ping_history (device_id, rtt_ms, loss_pct, status, checked_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (device_id, rtt_ms, loss_pct, "reachable" if reachable else "unreachable", checked_at)
    )
    
    # 3. Clean up history: Keep only last 10 entries for this device_id
    c.execute(
        """
        DELETE FROM device_ping_history 
        WHERE device_id = ? AND id NOT IN (
            SELECT id FROM device_ping_history 
            WHERE device_id = ? 
            ORDER BY id DESC 
            LIMIT 10
        )
        """,
        (device_id, device_id)
    )
    
    conn.commit()
    conn.close()

async def run_ping_all_devices():
    from app.database import get_db_conn
    from app.services.ping_service import ping_device
    
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, ip FROM devices WHERE protocol != 'serial'")
    devices = c.fetchall()
    conn.close()
    
    if not devices:
        logger.info("No devices to ping.")
        return
        
    sem = asyncio.Semaphore(15)
    
    async def ping_and_save(device):
        async with sem:
            dev_id = device["id"]
            ip = device["ip"]
            try:
                res = await ping_device(ip, count=3, timeout=3)
                save_ping_result(dev_id, res["rtt_ms"], res["loss_pct"], res["reachable"])
                logger.info(f"Scheduled ping for device {dev_id} ({ip}): {res}")
            except Exception as e:
                logger.error(f"Error pinging device {dev_id} ({ip}): {e}")
                
    tasks = [asyncio.create_task(ping_and_save(d)) for d in devices]
    await asyncio.gather(*tasks)

async def handle_bulk_ping(params: dict):
    task_id = params["task_id"]
    device_ids = params["device_ids"]
    user_id = params.get("user_id", 1)
    username = params.get("username", "system")
    
    import redis.asyncio as aioredis
    import json
    from app.database import get_db_conn
    from app.services.ping_service import ping_device
    
    r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    
    # Initialize bulk ping state in Redis
    status_entry = {
        "status": "running",
        "total": len(device_ids),
        "current": 0,
        "results": {}
    }
    await r.setex(f"bulk_ping:{task_id}", 86400, json.dumps(status_entry))
    
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, ip, protocol FROM devices")
    devices_dict = {row["id"]: {"name": row["name"], "ip": row["ip"], "protocol": row["protocol"]} for row in c.fetchall()}
    conn.close()
    
    results = status_entry["results"]
    completed_steps = 0
    
    sem = asyncio.Semaphore(10)
    
    async def ping_one(dev_id):
        nonlocal completed_steps
        dev_info = devices_dict.get(dev_id, {"name": f"Device {dev_id}", "ip": None, "protocol": None})
        dev_name = dev_info["name"]
        ip = dev_info["ip"]
        protocol = dev_info.get("protocol")
        
        if protocol == "serial":
            results[str(dev_id)] = {
                "name": dev_name,
                "success": True,
                "skipped": True,
                "message": "Serial device skipped from pinging"
            }
            completed_steps += 1
            status_entry["current"] = completed_steps
            await r.setex(f"bulk_ping:{task_id}", 86400, json.dumps(status_entry))
            return
            
        if not ip:
            results[str(dev_id)] = {
                "name": dev_name,
                "success": False,
                "error": "IP address not configured"
            }
            completed_steps += 1
            status_entry["current"] = completed_steps
            await r.setex(f"bulk_ping:{task_id}", 86400, json.dumps(status_entry))
            return

        async with sem:
            try:
                res = await ping_device(ip, count=3, timeout=3)
                save_ping_result(dev_id, res["rtt_ms"], res["loss_pct"], res["reachable"])
                results[str(dev_id)] = {
                    "name": dev_name,
                    "success": True,
                    "rtt_ms": res["rtt_ms"],
                    "loss_pct": res["loss_pct"],
                    "reachable": res["reachable"]
                }
            except Exception as e:
                results[str(dev_id)] = {
                    "name": dev_name,
                    "success": False,
                    "error": str(e)
                }
            
            completed_steps += 1
            status_entry["current"] = completed_steps
            await r.setex(f"bulk_ping:{task_id}", 86400, json.dumps(status_entry))

    tasks = [asyncio.create_task(ping_one(d_id)) for d_id in device_ids]
    await asyncio.gather(*tasks)
    
    status_entry["status"] = "completed"
    await r.setex(f"bulk_ping:{task_id}", 86400, json.dumps(status_entry))


async def handle_bulk_refresh(params: dict):
    task_id = params["task_id"]
    device_ids = params["device_ids"]
    components = params["components"]
    user_id = params.get("user_id", 1)
    username = params.get("username", "system")

    from app.routers.arp import refresh_arp_logic
    from app.routers.lldp import refresh_lldp_logic
    from app.routers.cdp import refresh_cdp_logic
    from app.routers.snmp import detect_snmp_info
    from app.routers.mac import refresh_mac_table_logic
    import redis.asyncio as aioredis
    import json
    from app.database import get_db_conn
    from app.services.audit import log_audit

    r = aioredis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    
    # Initialize state in Redis
    status_entry = {
        "status": "running",
        "total": len(device_ids) * len(components),
        "current": 0,
        "results": {}
    }
    await r.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))
    results = status_entry["results"]

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, device_type, protocol FROM devices")
    device_info = {row["id"]: {"name": row["name"], "device_type": row["device_type"], "protocol": row["protocol"]} for row in c.fetchall()}
    conn.close()

    completed_steps = 0
    user_context = {"id": user_id, "username": username}

    for dev_id in device_ids:
        dev_data = device_info.get(dev_id, {"name": f"Device {dev_id}", "device_type": "cisco_ios", "protocol": "ssh"})
        dev_name = dev_data["name"]
        dev_type = dev_data["device_type"] or ""
        protocol = dev_data.get("protocol", "ssh")
        results[str(dev_id)] = {"name": dev_name}

        if protocol == "serial":
            for comp in components:
                results[str(dev_id)][comp] = {"success": True, "skipped": True, "message": "Serial device skipped from background refresh"}
                completed_steps += 1
            status_entry["current"] = completed_steps
            await r.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))
            continue

        for comp in components:
            try:
                if comp == "arp":
                    await refresh_arp_logic(dev_id, user=user_context)
                elif comp == "lldp":
                    await refresh_lldp_logic(dev_id, user=user_context)
                elif comp == "cdp":
                    if not dev_type.lower().startswith("cisco"):
                        results[str(dev_id)][comp] = {"success": True, "skipped": True}
                        completed_steps += 1
                        status_entry["current"] = completed_steps
                        await r.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))
                        continue
                    await refresh_cdp_logic(dev_id, user=user_context)
                elif comp == "info":
                    await detect_snmp_info(dev_id, method="auto")
                elif comp == "mac":
                    await refresh_mac_table_logic(dev_id, user=user_context)
                elif comp == "l2":
                    from app.services.l2_service import L2AnalysisService
                    await L2AnalysisService.refresh_device_l2_data(dev_id, user=user_context)

                results[str(dev_id)][comp] = {"success": True}
            except Exception as e:
                err_msg = str(e)
                results[str(dev_id)][comp] = {"success": False, "error": err_msg}
                log_audit(user_id, username, "REFRESH_FAIL", f"devices/{dev_id}", f"Gagal refresh {comp} pada {dev_name}: {err_msg}")

            completed_steps += 1
            status_entry["current"] = completed_steps
            await r.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))
            await asyncio.sleep(0.5)

    status_entry["status"] = "completed"
    await r.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))


