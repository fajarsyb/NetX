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

    if task_name == "device_backup":
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
        handler = plugin_manager.get_task_handler(task_name)
        if not handler:
            raise ValueError(f"No plugin registered for task: {task_name}")
        return await handler(params["device_id"], user=user_context)


    elif task_name == "detect_snmp_info":
        from app.routers.snmp import detect_snmp_info
        return await detect_snmp_info(params["device_id"], method=params.get("method", "auto"))

    elif task_name == "bulk_refresh":
        await handle_bulk_refresh(params)

    else:
        raise ValueError(f"Unknown task name: {task_name}")

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
    c.execute("SELECT id, name, device_type FROM devices")
    device_info = {row["id"]: {"name": row["name"], "device_type": row["device_type"]} for row in c.fetchall()}
    conn.close()

    completed_steps = 0
    user_context = {"id": user_id, "username": username}

    for dev_id in device_ids:
        dev_data = device_info.get(dev_id, {"name": f"Device {dev_id}", "device_type": "cisco_ios"})
        dev_name = dev_data["name"]
        dev_type = dev_data["device_type"] or ""
        results[str(dev_id)] = {"name": dev_name}

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

