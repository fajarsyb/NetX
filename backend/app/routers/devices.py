from fastapi import APIRouter, HTTPException, Response, Depends, BackgroundTasks, UploadFile, File
from datetime import datetime
from typing import Optional
import csv
import io
from app.database import get_db_conn, encrypt_password, decrypt_password, get_device_credentials
from app.models import DeviceCreate, DeviceUpdate
from app.services.connector import test_connection
from app.services.auth import get_current_user, require_operator_or_admin, require_permission, get_user_permissions
from app.services.audit import log_audit
from app.routers.snmp import detect_snmp_info

def check_user_device_access(device_row: dict, user: dict) -> bool:
    """Check if the user is allowed to access the device based on allowed groups."""
    if not isinstance(user, dict):
        return True
    if user.get("role") == "admin":
        return True
    perms = user.get("permissions") or {}
    allowed_groups = perms.get("groups", ["*"])
    if "*" in allowed_groups:
        return True
    # Resolve the device group
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name FROM device_groups WHERE id = ?", (device_row.get("group_id"),))
    grow = c.fetchone()
    conn.close()
    gname = (grow["name"] or "Ungrouped") if grow else "Ungrouped"
    return gname in allowed_groups

router = APIRouter(prefix="/api/devices", tags=["devices"])

SUPPORTED_DEVICE_TYPES = [
    "cisco_ios", "cisco_xe", "cisco_nxos", "cisco_asa",
    "mikrotik_routeros", "juniper_junos",
    "hp_procurve", "hp_comware",
    "ruckus_fastiron", "huawei", "ruijie_os",
    "fortinet", "aruba_os",
    "extreme_exos", "dell_os10",
    "paloalto_panos", "allied_telesis", "vyos",
]


@router.get("/export/csv")
async def export_devices_csv(columns: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    # Check permissions
    perms = current_user.get("permissions") or {}
    allowed_groups = perms.get("groups", ["*"])

    FIELD_MAP = {
        "id":             ("d.id", "ID"),
        "name":           ("d.name", "Device Name"),
        "ip":             ("d.ip", "IP Address"),
        "protocol":       ("d.protocol", "Protocol"),
        "port":           ("d.port", "Port"),
        "username":       ("d.username", "Username"),
        "device_type":    ("d.device_type", "Device Type"),
        "description":    ("d.description", "Description"),
        "status":         ("d.status", "Status"),
        "last_seen":      ("d.last_seen", "Last Seen"),
        "group_name":     ("g.name", "Group Name"),
        "os_version":     ("d.os_version", "OS Version"),
        "serial_number":  ("d.serial_number", "Serial Number"),
        "mac_address":    ("d.mac_address", "MAC Address"),
        "hardware_model": ("d.hardware_model", "Hardware Model"),
        "device_role":    ("d.device_role", "Device Role"),
        "created_at":     ("d.created_at", "Created At"),
    }
    
    selected_keys = []
    if columns:
        selected_keys = [k.strip().lower() for k in columns.split(",") if k.strip().lower() in FIELD_MAP]
        
    if not selected_keys:
        selected_keys = list(FIELD_MAP.keys())
        
    select_exprs = [FIELD_MAP[k][0] + f" AS {k}" for k in selected_keys]
    select_clause = ", ".join(select_exprs)

    where_clause = ""
    params = []
    if "*" not in allowed_groups:
        include_ungrouped = "Ungrouped" in allowed_groups
        filtered_groups = [g for g in allowed_groups if g != "Ungrouped"]
        where_clauses = []
        if filtered_groups:
            placeholders = ", ".join("?" for _ in filtered_groups)
            where_clauses.append(f"g.name IN ({placeholders})")
            params.extend(filtered_groups)
        if include_ungrouped:
            where_clauses.append("d.group_id IS NULL")
            
        if not where_clauses:
            return Response(content="Akses Ditolak: Anda tidak diizinkan mengekspor perangkat apa pun.", media_type="text/plain")
        where_clause = "WHERE " + " OR ".join(where_clauses)

    conn = get_db_conn()
    c = conn.cursor()
    c.execute(f"""
        SELECT {select_clause}
        FROM devices d
        LEFT JOIN device_groups g ON d.group_id = g.id
        {where_clause}
        ORDER BY d.name COLLATE NOCASE
    """, params)
    rows = c.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write header
    headers = [FIELD_MAP[k][1] for k in selected_keys]
    writer.writerow(headers)
    
    # Write rows
    for r in rows:
        writer.writerow([r[k] for k in selected_keys])
        
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=netx_devices.csv"}
    )


@router.get("")
async def list_devices(current_user: dict = Depends(get_current_user)):
    perms = current_user.get("permissions") or {}
    allowed_groups = perms.get("groups", ["*"])

    conn = get_db_conn()
    c = conn.cursor()

    if "*" in allowed_groups:
        c.execute("""
            SELECT d.id, d.name, d.ip, d.protocol, d.port, d.username, d.device_type,
                   d.description, d.status, d.last_seen, d.group_id, d.created_at,
                   d.custom_arp_cmd, d.custom_lldp_cmd, d.custom_cdp_cmd, d.custom_routing_cmd,
                   d.snmp_version, d.snmp_community,
                   d.os_version, d.serial_number, d.mac_address, d.hardware_model,
                   d.credential_id, d.custom_info_cmd, d.raw_info, d.device_role,
                   d.threshold_profile_id, g.name as group_name
            FROM devices d
            LEFT JOIN device_groups g ON d.group_id = g.id
            ORDER BY d.name COLLATE NOCASE
        """)
    else:
        include_ungrouped = "Ungrouped" in allowed_groups
        filtered_groups = [g for g in allowed_groups if g != "Ungrouped"]
        
        where_clauses = []
        params = []
        if filtered_groups:
            placeholders = ", ".join("?" for _ in filtered_groups)
            where_clauses.append(f"g.name IN ({placeholders})")
            params.extend(filtered_groups)
        if include_ungrouped:
            where_clauses.append("d.group_id IS NULL")
            
        if not where_clauses:
            conn.close()
            return []
            
        where_str = " OR ".join(where_clauses)
        c.execute(f"""
            SELECT d.id, d.name, d.ip, d.protocol, d.port, d.username, d.device_type,
                   d.description, d.status, d.last_seen, d.group_id, d.created_at,
                   d.custom_arp_cmd, d.custom_lldp_cmd, d.custom_cdp_cmd, d.custom_routing_cmd,
                   d.snmp_version, d.snmp_community,
                   d.os_version, d.serial_number, d.mac_address, d.hardware_model,
                   d.credential_id, d.custom_info_cmd, d.raw_info, d.device_role,
                   d.threshold_profile_id, g.name as group_name
            FROM devices d
            LEFT JOIN device_groups g ON d.group_id = g.id
            WHERE {where_str}
            ORDER BY d.name COLLATE NOCASE
        """, params)

    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@router.post("")
async def create_device(dev: DeviceCreate, background_tasks: BackgroundTasks, user: dict = Depends(require_permission(feature="add_device"))):
    if dev.device_type not in SUPPORTED_DEVICE_TYPES:
        raise HTTPException(status_code=400, detail=f"device_type '{dev.device_type}' tidak didukung.")

    # Check if they can access the group they are adding the device to!
    if user.get("role") != "admin":
        perms = user.get("permissions") or {}
        allowed_groups = perms.get("groups", ["*"])
        if "*" not in allowed_groups:
            group_name = "Ungrouped"
            if dev.group_id:
                conn = get_db_conn()
                c = conn.cursor()
                c.execute("SELECT name FROM device_groups WHERE id = ?", (dev.group_id,))
                grow = c.fetchone()
                conn.close()
                if grow:
                    group_name = grow["name"]
            if group_name not in allowed_groups:
                raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak diizinkan menambahkan perangkat ke grup ini.")

    conn = get_db_conn()
    c = conn.cursor()
    now = datetime.now().isoformat()
    enc_pass = encrypt_password(dev.password)
    try:
        c.execute("""
            INSERT INTO devices (name, ip, protocol, port, username, password,
                                 device_type, description, group_id, credential_id, created_at,
                                 custom_arp_cmd, custom_lldp_cmd, custom_cdp_cmd, custom_routing_cmd,
                                 custom_info_cmd, snmp_version, snmp_community, device_role,
                                 hardware_model, os_version, serial_number, mac_address, threshold_profile_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (dev.name, dev.ip, dev.protocol, dev.port, dev.username,
              enc_pass, dev.device_type, dev.description, dev.group_id, dev.credential_id, now,
              dev.custom_arp_cmd, dev.custom_lldp_cmd, dev.custom_cdp_cmd, dev.custom_routing_cmd,
              dev.custom_info_cmd, dev.snmp_version, dev.snmp_community, dev.device_role,
              dev.hardware_model, dev.os_version, dev.serial_number, dev.mac_address, dev.threshold_profile_id))
        conn.commit()
        device_id = c.lastrowid
        conn.close()
        
        # Trigger SNMP detection in background
        background_tasks.add_task(detect_snmp_info, device_id)
        
        log_audit(user["id"], user["username"], "CREATE_DEVICE", f"devices/{device_id}", f"Created device: {dev.name} ({dev.ip})")
        return {"success": True, "device_id": device_id, "message": "Device berhasil ditambahkan."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail="Nama atau IP device sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/csv")
async def import_devices_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission(feature="add_device"))
):
    contents = await file.read()
    try:
        decoded = contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            decoded = contents.decode("latin-1")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Gagal mendecode file CSV: {str(e)}")

    output = io.StringIO(decoded)
    reader = csv.DictReader(output)
    
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="File CSV kosong atau format tidak valid.")

    # Normalisasi header
    header_mapping = {
        "device name": "name",
        "name": "name",
        "ip address": "ip",
        "ip": "ip",
        "protocol": "protocol",
        "port": "port",
        "username": "username",
        "password": "password",
        "device type": "device_type",
        "device_type": "device_type",
        "description": "description",
        "group name": "group_name",
        "group_name": "group_name",
        "snmp version": "snmp_version",
        "snmp_version": "snmp_version",
        "snmp community": "snmp_community",
        "snmp_community": "snmp_community",
        "device role": "device_role",
        "device_role": "device_role",
        "role": "device_role",
    }
    
    normalized_headers = {}
    for col in reader.fieldnames:
        col_clean = col.strip().lower()
        if col_clean in header_mapping:
            normalized_headers[col] = header_mapping[col_clean]
        else:
            normalized_headers[col] = col_clean

    success_count = 0
    errors = []
    imported_ids = []
    
    conn = get_db_conn()
    c = conn.cursor()
    
    # Cache groups
    c.execute("SELECT id, name FROM device_groups")
    group_cache = {row["name"].lower().strip(): row["id"] for row in c.fetchall()}
    
    now = datetime.now().isoformat()
    
    for idx, row in enumerate(reader):
        row_num = idx + 1
        # Extract row data with mapping
        row_data = {}
        for original_col, normalized_col in normalized_headers.items():
            if original_col in row:
                row_data[normalized_col] = row.get(original_col, "").strip() if row.get(original_col) else ""

        name = row_data.get("name", "")
        ip = row_data.get("ip", "")
        device_type = row_data.get("device_type", "")
        
        # Validasi field wajib
        if not name:
            errors.append({"row": row_num, "name": name, "ip": ip, "error": "Nama device wajib diisi."})
            continue
        if not ip:
            errors.append({"row": row_num, "name": name, "ip": ip, "error": "IP address wajib diisi."})
            continue
        if not device_type:
            errors.append({"row": row_num, "name": name, "ip": ip, "error": "Device type wajib diisi."})
            continue
            
        if device_type not in SUPPORTED_DEVICE_TYPES:
            errors.append({"row": row_num, "name": name, "ip": ip, "error": f"Device type '{device_type}' tidak didukung."})
            continue
            
        protocol = row_data.get("protocol", "ssh").lower()
        if protocol not in ("ssh", "telnet"):
            protocol = "ssh"
            
        port_raw = row_data.get("port")
        if port_raw:
            try:
                port = int(port_raw)
                if not (1 <= port <= 65535):
                    port = 23 if protocol == "telnet" else 22
            except ValueError:
                port = 23 if protocol == "telnet" else 22
        else:
            port = 23 if protocol == "telnet" else 22
            
        username = row_data.get("username", "")
        password = row_data.get("password", "")
        description = row_data.get("description", "")
        
        snmp_version = row_data.get("snmp_version", "v2c")
        if snmp_version not in ("v1", "v2c", "v3"):
            snmp_version = "v2c"
            
        snmp_community = row_data.get("snmp_community", "public")
        device_role = row_data.get("device_role", "Access Switch")
        
        group_name = row_data.get("group_name", "")
        group_id = None
        if group_name:
            g_key = group_name.lower().strip()
            if g_key in group_cache:
                group_id = group_cache[g_key]
            else:
                try:
                    c.execute("INSERT INTO device_groups (name, description) VALUES (?, ?)", (group_name.strip(), "Auto-created during bulk import"))
                    conn.commit()
                    group_id = c.lastrowid
                    group_cache[g_key] = group_id
                except Exception:
                    pass
                    
        enc_pass = encrypt_password(password) if password else ""
        
        try:
            c.execute("""
                INSERT INTO devices (name, ip, protocol, port, username, password,
                                     device_type, description, group_id, created_at,
                                     snmp_version, snmp_community, device_role, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline')
            """, (name, ip, protocol, port, username, enc_pass, device_type, description, group_id, now, snmp_version, snmp_community, device_role))
            conn.commit()
            device_id = c.lastrowid
            imported_ids.append(device_id)
            success_count += 1
        except Exception as e:
            conn.rollback()
            err_str = str(e)
            if "UNIQUE" in err_str:
                err_msg = f"Device dengan nama '{name}' atau IP '{ip}' sudah terdaftar."
            else:
                err_msg = err_str
            errors.append({"row": row_num, "name": name, "ip": ip, "error": err_msg})
            
    conn.close()
    
    # Jalankan background task untuk scan info SNMP
    for device_id in imported_ids:
        background_tasks.add_task(detect_snmp_info, device_id)
        
    log_audit(user["id"], user["username"], "IMPORT_DEVICES", "devices/import", f"Bulk imported devices. Success: {success_count}, Failed: {len(errors)}")
    
    return {
        "success": True,
        "message": f"Proses impor selesai. {success_count} berhasil, {len(errors)} gagal.",
        "success_count": success_count,
        "failed_count": len(errors),
        "errors": errors
    }


@router.get("/device-types")
async def get_device_types():
    return SUPPORTED_DEVICE_TYPES


@router.get("/{device_id}")
async def get_device(device_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT d.id, d.name, d.ip, d.protocol, d.port, d.username, d.device_type,
               d.description, d.status, d.last_seen, d.group_id, d.created_at,
               d.custom_arp_cmd, d.custom_lldp_cmd, d.custom_cdp_cmd, d.custom_routing_cmd,
               d.snmp_version, d.snmp_community,
               d.os_version, d.serial_number, d.mac_address, d.hardware_model,
               d.credential_id, d.custom_info_cmd, d.raw_info, d.device_role,
               d.threshold_profile_id, g.name as group_name
        FROM devices d
        LEFT JOIN device_groups g ON d.group_id = g.id
        WHERE d.id = ?
    """, (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    
    device = dict(row)
    if not check_user_device_access(device, current_user):
        raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak memiliki akses ke perangkat di grup ini.")
        
    return device


@router.put("/{device_id}")
async def update_device(device_id: int, dev: DeviceUpdate, user: dict = Depends(require_permission(feature="edit_device"))):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, group_id FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    dev_name = row["name"]
    old_group_id = row["group_id"]

    # Verify access to the current device (group check)
    device_mock = {"group_id": old_group_id}
    if not check_user_device_access(device_mock, user):
        conn.close()
        raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak memiliki akses ke perangkat di grup ini.")

    updates = dev.dict(exclude_none=True)
    if not updates:
        conn.close()
        return {"success": True, "message": "Tidak ada perubahan."}

    # Verify access to the new group if it is changing
    if "group_id" in updates and updates["group_id"] != old_group_id:
        if user.get("role") != "admin":
            perms = user.get("permissions") or {}
            allowed_groups = perms.get("groups", ["*"])
            if "*" not in allowed_groups:
                new_group_name = "Ungrouped"
                if updates["group_id"]:
                    c.execute("SELECT name FROM device_groups WHERE id = ?", (updates["group_id"],))
                    grow = c.fetchone()
                    if grow:
                        new_group_name = grow["name"]
                if new_group_name not in allowed_groups:
                    conn.close()
                    raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak diizinkan memindahkan perangkat ke grup ini.")

    if "password" in updates:
        if updates["password"] == "":
            del updates["password"]
        else:
            updates["password"] = encrypt_password(updates["password"])

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [device_id]
    try:
        c.execute(f"UPDATE devices SET {set_clause} WHERE id = ?", vals)
        conn.commit()
        conn.close()
        log_audit(user["id"], user["username"], "UPDATE_DEVICE", f"devices/{device_id}", f"Updated device: {dev_name} (Fields changed: {', '.join(updates.keys())})")
        return {"success": True, "message": "Device berhasil diupdate."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail="Nama atau IP device sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{device_id}")
async def delete_device(device_id: int, user: dict = Depends(require_permission(feature="delete_device"))):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name, group_id FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")
    dev_name = row["name"]
    group_id = row["group_id"]
    
    device_mock = {"group_id": group_id}
    if not check_user_device_access(device_mock, user):
        conn.close()
        raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak memiliki akses ke perangkat di grup ini.")
    
    c.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    conn.commit()
    conn.close()
    log_audit(user["id"], user["username"], "DELETE_DEVICE", f"devices/{device_id}", f"Deleted device: {dev_name}")
    return {"success": True, "message": "Device berhasil dihapus."}


@router.post("/{device_id}/test-connection")
async def test_device_connection(device_id: int, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Device tidak ditemukan.")

    device = dict(row)
    if not check_user_device_access(device, user):
        raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak memiliki akses ke perangkat di grup ini.")

    username, password = get_device_credentials(device)
    device["username"] = username
    result = await test_connection(device, password)

    # Update status in DB
    conn2 = get_db_conn()
    c2 = conn2.cursor()
    new_status = "online" if result["success"] else "offline"
    c2.execute(
        "UPDATE devices SET status = ?, last_seen = ? WHERE id = ?",
        (new_status, datetime.now().isoformat(), device_id),
    )
    conn2.commit()
    conn2.close()

    # Trigger SNMP detection in background if connection test is successful
    if result["success"]:
        background_tasks.add_task(detect_snmp_info, device_id)

    return result


@router.post("/test-connection-raw")
async def test_device_connection_raw(dev: DeviceCreate):
    """Test connection without saving the device to DB."""
    device_dict = dev.dict()
    username, password = get_device_credentials(device_dict)
    device_dict["username"] = username
    result = await test_connection(device_dict, password)
    return result

# ─── BULK REFRESH SYSTEM ─────────────────────────────────────────────────────
import uuid
import asyncio
from pydantic import BaseModel
from typing import List

class BulkRefreshRequest(BaseModel):
    device_ids: List[int]
    components: List[str]

import redis
import json
import os

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
redis_client = redis.from_url(REDIS_URL)

bulk_refresh_status = {}

@router.post("/bulk-refresh")
async def trigger_bulk_refresh(
    req: BulkRefreshRequest, 
    user: dict = Depends(require_operator_or_admin)
):
    """Trigger sequential bulk refresh of network components across multiple devices."""
    if not req.device_ids:
        raise HTTPException(status_code=400, detail="Pilih minimal satu perangkat.")
    if not req.components:
        raise HTTPException(status_code=400, detail="Pilih minimal satu komponen untuk disegarkan.")

    task_id = str(uuid.uuid4())
    status_entry = {
        "status": "running",
        "total": len(req.device_ids) * len(req.components),
        "current": 0,
        "results": {}
    }
    
    try:
        redis_client.setex(f"bulk_refresh:{task_id}", 86400, json.dumps(status_entry))
    except Exception as e:
        logger.error(f"Failed to write bulk refresh status to Redis: {e}")
        bulk_refresh_status[task_id] = status_entry

    from app.queue.queue import job_queue
    job_queue.enqueue("bulk_refresh", {
        "task_id": task_id,
        "device_ids": req.device_ids,
        "components": req.components,
        "user_id": user["id"],
        "username": user["username"]
    }, priority="high")

    return {
        "success": True,
        "task_id": task_id,
        "message": "Proses refresh massal berhasil dimulai."
    }

@router.get("/bulk-refresh/{task_id}")
async def get_bulk_refresh_status(task_id: str, current_user: dict = Depends(get_current_user)):
    """Fetch live progress of bulk refresh task."""
    try:
        data = redis_client.get(f"bulk_refresh:{task_id}")
        if not data:
            if task_id in bulk_refresh_status:
                return bulk_refresh_status[task_id]
            raise HTTPException(status_code=404, detail="Task ID tidak ditemukan.")
        return json.loads(data.decode("utf-8"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read bulk refresh status from Redis: {e}")
        if task_id in bulk_refresh_status:
            return bulk_refresh_status[task_id]
        raise HTTPException(status_code=500, detail="Failed to fetch task status.")


@router.get("/{device_id}/port-map")
async def get_device_port_map(device_id: int, current_user: dict = Depends(get_current_user)):
    """Retrieve combined port mapping details (MACs, IPs, LLDP, CDP, SNMP) for a device."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    dev_row = c.fetchone()
    if not dev_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Perangkat tidak ditemukan.")
    
    device = dict(dev_row)

    # Fetch cached tables
    c.execute("""
        SELECT vlan, mac_address, entry_type, interface, mac_vendor, fetched_at 
        FROM mac_addresses 
        WHERE device_id = ?
    """, (device_id,))
    mac_rows = [dict(r) for r in c.fetchall()]

    c.execute("""
        SELECT local_port, neighbor_name, neighbor_ip, neighbor_mac, neighbor_port, 
               neighbor_vendor, device_category, device_hint, fetched_at
        FROM lldp_neighbors 
        WHERE device_id = ?
    """, (device_id,))
    lldp_rows = [dict(r) for r in c.fetchall()]

    c.execute("""
        SELECT local_port, neighbor_name, neighbor_ip, neighbor_platform, neighbor_port, fetched_at
        FROM cdp_neighbors 
        WHERE device_id = ?
    """, (device_id,))
    cdp_rows = [dict(r) for r in c.fetchall()]

    # Fetch global ARP cache to resolve MAC -> IP
    c.execute("SELECT ip_address, mac_address FROM arp_cache")
    arp_rows = [dict(r) for r in c.fetchall()]
    conn.close()

    # Normalize MAC -> IP mapping
    def normalize_mac(mac: str) -> str:
        import re
        clean = re.sub(r"[:\-\.\s]", "", mac).upper()
        if len(clean) != 12:
            return mac.upper()
        return ":".join(clean[i:i+2] for i in range(0, 12, 2))

    mac_to_ip = {}
    for r in arp_rows:
        n_mac = normalize_mac(r["mac_address"])
        if n_mac and r["ip_address"]:
            mac_to_ip[n_mac] = r["ip_address"]

    # Normalize Interface names for reliable mapping
    def norm_iface(name: str) -> str:
        if not name:
            return ""
        import re
        s = name.lower().replace(" ", "").replace("-", "").replace("_", "")
        s = s.replace("gigabitethernet", "gi")
        s = s.replace("fastethernet", "fa")
        s = s.replace("ethernet", "eth")
        s = s.replace("tengigabitethernet", "te")
        s = s.replace("ten-gigabitethernet", "te")
        s = s.replace("fortygigabitethernet", "fo")
        s = s.replace("hundredgigabitethernet", "hu")
        s = s.replace("port-channel", "po")
        s = s.replace("portchannel", "po")
        s = s.replace("management", "mgmt")
        return s

    # Try fetching SNMP interfaces if configured
    snmp_ifs = []
    if device.get("snmp_community"):
        try:
            from app.routers.snmp import get_snmp_interfaces
            snmp_ifs = await get_snmp_interfaces(device_id)
        except Exception:
            pass

    ports = {}

    # Initialize from SNMP if available
    for i in snmp_ifs:
        name = i["name"]
        norm = norm_iface(name)
        ports[norm] = {
            "interface": name,
            "normalized": norm,
            "status": i["status"],
            "admin_status": i.get("admin_status", "up"),
            "speed": i["speed"],
            "alias": i["alias"],
            "mac_entries": [],
            "lldp_neighbor": None,
            "cdp_neighbor": None
        }

    def get_or_create_port(original_name: str):
        if not original_name:
            return None
        norm = norm_iface(original_name)
        if norm not in ports:
            ports[norm] = {
                "interface": original_name,
                "normalized": norm,
                "status": "unknown",
                "admin_status": "unknown",
                "speed": "—",
                "alias": "",
                "mac_entries": [],
                "lldp_neighbor": None,
                "cdp_neighbor": None
            }
        return ports[norm]

    # Populate MAC entries
    for m in mac_rows:
        p = get_or_create_port(m["interface"])
        if p:
            n_mac = normalize_mac(m["mac_address"])
            resolved_ip = mac_to_ip.get(n_mac, "—")
            p["mac_entries"].append({
                "mac_address": m["mac_address"],
                "mac_vendor": m["mac_vendor"] or "Unknown",
                "vlan": m["vlan"] or "—",
                "entry_type": m["entry_type"] or "dynamic",
                "ip_address": resolved_ip
            })
            if p["status"] in ("unknown", "down") and p["mac_entries"]:
                p["status"] = "up"

    # Populate LLDP neighbors
    for l in lldp_rows:
        p = get_or_create_port(l["local_port"])
        if p:
            p["lldp_neighbor"] = {
                "neighbor_name": l["neighbor_name"] or "—",
                "neighbor_ip": l["neighbor_ip"] or "—",
                "neighbor_mac": l["neighbor_mac"] or "—",
                "neighbor_port": l["neighbor_port"] or "—",
                "neighbor_vendor": l["neighbor_vendor"] or "Unknown",
                "device_category": l["device_category"] or "unknown",
                "device_hint": l["device_hint"] or "Unknown"
            }
            if p["status"] in ("unknown", "down"):
                p["status"] = "up"

    # Populate CDP neighbors
    for c_row in cdp_rows:
        p = get_or_create_port(c_row["local_port"])
        if p:
            p["cdp_neighbor"] = {
                "neighbor_name": c_row["neighbor_name"] or "—",
                "neighbor_ip": c_row["neighbor_ip"] or "—",
                "neighbor_platform": c_row["neighbor_platform"] or "—",
                "neighbor_port": c_row["neighbor_port"] or "—"
            }
            if p["status"] in ("unknown", "down"):
                p["status"] = "up"

    # Sort naturally
    import re
    def natural_sort_key(s):
        return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s["interface"])]

    sorted_ports = list(ports.values())
    try:
        sorted_ports.sort(key=natural_sort_key)
    except Exception:
        sorted_ports.sort(key=lambda x: x["interface"])

    return sorted_ports


