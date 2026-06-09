from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from app.database import get_db_conn
from app.services.auth import require_operator_or_admin, get_current_user
from app.services.device_backup_service import calculate_next_run, backup_device_config, compare_backups

router = APIRouter(prefix="/api/device-backups", tags=["device-backups"])


class ScheduleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    device_ids: str = Field(..., description="comma separated list of device IDs or 'all'")
    frequency: str = Field(..., description="'hourly', 'daily', 'weekly'")
    time: Optional[str] = Field(default="", description="HH:MM format")
    day_of_week: Optional[int] = Field(default=0, description="0-6 (0=Monday)")
    is_active: Optional[int] = Field(default=1)


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    device_ids: Optional[str] = None
    frequency: Optional[str] = None
    time: Optional[str] = None
    day_of_week: Optional[int] = None
    is_active: Optional[int] = None


# ─── BACKUP HISTORY & DEVICES ───────────────────────────────────────────────

@router.get("")
async def list_device_backups(current_user: dict = Depends(get_current_user)):
    """List all device configuration backup records."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT b.id, b.device_id, b.version, b.status, b.error_message, b.created_at,
               d.name as device_name, d.ip as device_ip, LENGTH(b.config_content) as size
        FROM device_config_backups b
        JOIN devices d ON b.device_id = d.id
        ORDER BY b.created_at DESC
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@router.get("/devices")
async def list_juniper_devices(current_user: dict = Depends(get_current_user)):
    """List all supported devices with their latest backup status."""
    conn = get_db_conn()
    c = conn.cursor()
    
    from app.core.drivers import driver_manager

    c.execute("""
        SELECT d.id, d.name, d.ip, d.status as device_status, d.last_seen, d.device_type,
               (SELECT MAX(version) FROM device_config_backups WHERE device_id = d.id AND status = 'success') as latest_version,
               (SELECT created_at FROM device_config_backups WHERE device_id = d.id ORDER BY created_at DESC LIMIT 1) as last_backup_time,
               (SELECT status FROM device_config_backups WHERE device_id = d.id ORDER BY created_at DESC LIMIT 1) as last_backup_status
        FROM devices d
        ORDER BY d.name COLLATE NOCASE
    """)
    rows = []
    for r in c.fetchall():
        d = dict(r)
        driver = driver_manager.get_driver(d["device_type"])
        if driver and driver.supports_backup:
            rows.append(d)
            
    conn.close()
    return rows


@router.get("/versions/{device_id}")
async def list_device_backup_versions(device_id: int, current_user: dict = Depends(get_current_user)):
    """List all configuration backup versions for a specific device."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id, version, status, error_message, created_at, LENGTH(config_content) as size
        FROM device_config_backups
        WHERE device_id = ?
        ORDER BY version DESC, created_at DESC
    """, (device_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows




@router.post("/backup/{device_id}")
async def trigger_device_backup(device_id: int, user: dict = Depends(require_operator_or_admin)):
    """Trigger a manual backup for a specific device immediately via Redis queue."""
    from app.queue.queue import job_queue
    try:
        res = await job_queue.run_sync_over_async("device_backup", {
            "device_id": device_id,
            "only_if_changed": True,
            "user_id": user["id"],
            "username": user["username"]
        }, priority="high", timeout=60.0)
        
        if not res.get("success"):
            raise HTTPException(status_code=500, detail=res.get("error", "Backup konfigurasi gagal."))
        return res.get("result", {})
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Timeout: Proses backup konfigurasi melebihi batas waktu.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{backup_id}")
async def delete_backup_version(backup_id: int, user: dict = Depends(require_operator_or_admin)):
    """Delete a specific configuration backup version."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM device_config_backups WHERE id = ?", (backup_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Cadangan tidak ditemukan.")
    c.execute("DELETE FROM device_config_backups WHERE id = ?", (backup_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Versi cadangan berhasil dihapus."}


@router.get("/diff/{backup_id_1}/{backup_id_2}")
async def diff_backups(backup_id_1: int, backup_id_2: int, current_user: dict = Depends(get_current_user)):
    """Compare two backup configurations and return line-by-line differences."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT b.id, b.config_content, b.version, b.created_at, d.name as device_name
        FROM device_config_backups b
        JOIN devices d ON b.device_id = d.id
        WHERE b.id = ?
    """, (backup_id_1,))
    row1 = c.fetchone()

    c.execute("""
        SELECT b.id, b.config_content, b.version, b.created_at, d.name as device_name
        FROM device_config_backups b
        JOIN devices d ON b.device_id = d.id
        WHERE b.id = ?
    """, (backup_id_2,))
    row2 = c.fetchone()
    conn.close()

    if not row1 or not row2:
        raise HTTPException(status_code=404, detail="Satu atau kedua cadangan tidak ditemukan.")

    desc1 = f"Versi {row1['version']} ({datetime.fromisoformat(row1['created_at']).strftime('%Y-%m-%d %H:%M:%S')})"
    desc2 = f"Versi {row2['version']} ({datetime.fromisoformat(row2['created_at']).strftime('%Y-%m-%d %H:%M:%S')})"

    diff_lines = compare_backups(
        row1["config_content"],
        row2["config_content"],
        from_desc=desc1,
        to_desc=desc2
    )

    return {
        "device_name": row1["device_name"],
        "version1": row1["version"],
        "version2": row2["version"],
        "created_at1": row1["created_at"],
        "created_at2": row2["created_at"],
        "diff": diff_lines
    }


# ─── BACKUP SCHEDULES ────────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(current_user: dict = Depends(get_current_user)):
    """List all configured backup schedules."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_backup_schedules ORDER BY name COLLATE NOCASE")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


@router.post("/schedules")
async def create_schedule(sched: ScheduleCreate, user: dict = Depends(require_operator_or_admin)):
    """Create a new device backup schedule."""
    next_run = calculate_next_run(sched.frequency, sched.time, sched.day_of_week).isoformat()
    now = datetime.now().isoformat()

    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("""
            INSERT INTO device_backup_schedules (name, device_ids, frequency, time, day_of_week, is_active, next_run, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (sched.name, sched.device_ids, sched.frequency, sched.time or "", sched.day_of_week or 0, sched.is_active, next_run, now))
        conn.commit()
        schedule_id = c.lastrowid
        conn.close()
        return {"success": True, "schedule_id": schedule_id, "message": "Jadwal backup berhasil dibuat."}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: int, sched: ScheduleUpdate, user: dict = Depends(require_operator_or_admin)):
    """Update an existing backup schedule and recalculate the next run time."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_backup_schedules WHERE id = ?", (schedule_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Jadwal tidak ditemukan.")

    current = dict(row)
    updates = sched.dict(exclude_none=True)

    # Merge updates to compute next run
    for k, v in updates.items():
        current[k] = v

    next_run = calculate_next_run(current["frequency"], current["time"], current["day_of_week"]).isoformat()
    
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys()) + ", next_run = ?"
    vals = list(updates.values()) + [next_run, schedule_id]

    try:
        c.execute(f"UPDATE device_backup_schedules SET {set_clause} WHERE id = ?", vals)
        conn.commit()
        conn.close()
        return {"success": True, "message": "Jadwal backup berhasil diperbarui."}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: int, user: dict = Depends(require_operator_or_admin)):
    """Delete a backup schedule."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM device_backup_schedules WHERE id = ?", (schedule_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Jadwal tidak ditemukan.")
    c.execute("DELETE FROM device_backup_schedules WHERE id = ?", (schedule_id,))
    conn.commit()
    conn.close()
    return {"success": True, "message": "Jadwal backup berhasil dihapus."}


@router.post("/schedules/{schedule_id}/run")
async def run_schedule_now(schedule_id: int, user: dict = Depends(require_operator_or_admin)):
    """Trigger execution of a schedule in the background immediately."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM device_backup_schedules WHERE id = ?", (schedule_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Jadwal tidak ditemukan.")

    schedule = dict(row)
    conn.close()

    # Trigger backup asynchronously
    import asyncio
    from app.services.device_backup_service import execute_schedule_backups
    asyncio.create_task(execute_schedule_backups(schedule))

    return {"success": True, "message": "Pencadangan terjadwal berhasil dijalankan di latar belakang."}


@router.get("/{backup_id}")
async def get_backup_content(backup_id: int, current_user: dict = Depends(get_current_user)):
    """Get the full configuration text of a specific backup."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT b.id, b.device_id, b.config_content, b.version, b.created_at, d.name as device_name
        FROM device_config_backups b
        JOIN devices d ON b.device_id = d.id
        WHERE b.id = ?
    """, (backup_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Cadangan tidak ditemukan.")
    return dict(row)

