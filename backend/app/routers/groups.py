from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
import asyncio
from app.database import get_db_conn
from app.models import GroupCreate, GroupUpdate
from app.services.auth import get_current_user, require_operator_or_admin, require_permission
from app.services.audit import log_audit

router = APIRouter(prefix="/api/groups", tags=["groups"])

@router.get("")
async def list_groups(current_user: dict = Depends(get_current_user)):
    perms = current_user.get("permissions") or {}
    allowed_groups = perms.get("groups", ["*"])

    conn = get_db_conn()
    c = conn.cursor()
    
    if "*" in allowed_groups:
        c.execute("""
            SELECT g.id, g.name, g.description, g.parent_id, g.created_at,
                   p.name as parent_name,
                   COUNT(d.id) as device_count
            FROM device_groups g
            LEFT JOIN device_groups p ON g.parent_id = p.id
            LEFT JOIN devices d ON d.group_id = g.id
            GROUP BY g.id
            ORDER BY g.name COLLATE NOCASE
        """)
    else:
        # Filter by allowed group names
        placeholders = ", ".join("?" for _ in allowed_groups)
        c.execute(f"""
            SELECT g.id, g.name, g.description, g.parent_id, g.created_at,
                   p.name as parent_name,
                   COUNT(d.id) as device_count
            FROM device_groups g
            LEFT JOIN device_groups p ON g.parent_id = p.id
            LEFT JOIN devices d ON d.group_id = g.id
            WHERE g.name IN ({placeholders})
            GROUP BY g.id
            ORDER BY g.name COLLATE NOCASE
        """, allowed_groups)
        
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.post("")
async def create_group(group: GroupCreate, user: dict = Depends(require_permission(feature="manage_groups"))):
    conn = get_db_conn()
    c = conn.cursor()
    now = datetime.now().isoformat()
    try:
        c.execute("""
            INSERT INTO device_groups (name, description, parent_id, created_at)
            VALUES (?, ?, ?, ?)
        """, (group.name, group.description, group.parent_id, now))
        conn.commit()
        group_id = c.lastrowid
        conn.close()
        log_audit(user["id"], user["username"], "CREATE_GROUP", f"groups/{group_id}", f"Created group: {group.name}")
        return {"success": True, "group_id": group_id, "message": "Group berhasil dibuat."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail="Nama group sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{group_id}")
async def update_group(group_id: int, group: GroupUpdate, user: dict = Depends(require_permission(feature="manage_groups"))):
    if group.parent_id is not None:
        if is_circular_group_loop(group_id, group.parent_id):
            raise HTTPException(status_code=400, detail="Tidak bisa membuat hirarki melingkar (circular loop).")

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM device_groups WHERE id = ?", (group_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Group tidak ditemukan.")

    updates = group.dict(exclude_unset=True)
    if not updates:
        conn.close()
        return {"success": True, "message": "Tidak ada perubahan."}

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [group_id]
    try:
        c.execute(f"UPDATE device_groups SET {set_clause} WHERE id = ?", vals)
        conn.commit()
        conn.close()
        log_audit(user["id"], user["username"], "UPDATE_GROUP", f"groups/{group_id}", f"Updated group fields: {', '.join(updates.keys())}")
        return {"success": True, "message": "Group berhasil diupdate."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail="Nama group sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{group_id}")
async def delete_group(group_id: int, user: dict = Depends(require_permission(feature="manage_groups"))):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name FROM device_groups WHERE id = ?", (group_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Group tidak ditemukan.")
    grp_name = row["name"]
    
    c.execute("DELETE FROM device_groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()
    log_audit(user["id"], user["username"], "DELETE_GROUP", f"groups/{group_id}", f"Deleted group: {grp_name}")
    return {"success": True, "message": "Group berhasil dihapus."}


def is_circular_group_loop(group_id: int, parent_id: int) -> bool:
    if group_id == parent_id:
        return True
    
    conn = get_db_conn()
    c = conn.cursor()
    curr_id = parent_id
    visited = {group_id}
    
    while curr_id is not None:
        if curr_id in visited:
            conn.close()
            return True
        visited.add(curr_id)
        c.execute("SELECT parent_id FROM device_groups WHERE id = ?", (curr_id,))
        row = c.fetchone()
        if not row:
            break
        curr_id = row[0]
        
    conn.close()
    return False


def get_all_device_ids_in_group(group_id: int) -> list[int]:
    conn = get_db_conn()
    c = conn.cursor()
    
    group_ids = [group_id]
    to_visit = [group_id]
    
    while to_visit:
        curr = to_visit.pop(0)
        c.execute("SELECT id FROM device_groups WHERE parent_id = ?", (curr,))
        children = [r[0] for r in c.fetchall()]
        for child in children:
            if child not in group_ids:
                group_ids.append(child)
                to_visit.append(child)
                
    if not group_ids:
        conn.close()
        return []
        
    placeholders = ",".join("?" for _ in group_ids)
    c.execute(f"SELECT id FROM devices WHERE group_id IN ({placeholders})", group_ids)
    device_ids = [r[0] for r in c.fetchall()]
    conn.close()
    
    return device_ids


async def refresh_single_device_full(device_id: int) -> dict:
    results = {"arp": False, "lldp": False, "cdp": False, "snmp": False, "errors": []}
    
    from app.routers.arp import refresh_arp
    from app.routers.lldp import refresh_lldp
    from app.routers.cdp import refresh_cdp
    from app.routers.snmp import detect_snmp_info
    
    # Query device type to determine CDP eligibility
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT device_type FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()
    
    device_type = (row["device_type"] or "") if row else ""
    is_cisco = device_type.lower().startswith("cisco")
    
    # 1. SNMP Refresh
    try:
        await detect_snmp_info(device_id)
        results["snmp"] = True
    except Exception as e:
        err_msg = getattr(e, 'detail', str(e))
        results["errors"].append(f"SNMP Error: {err_msg}")
        
    # 2. ARP Refresh
    try:
        await refresh_arp(device_id)
        results["arp"] = True
    except Exception as e:
        err_msg = getattr(e, 'detail', str(e))
        results["errors"].append(f"ARP Error: {err_msg}")
        
    # 3. LLDP Refresh
    try:
        await refresh_lldp(device_id)
        results["lldp"] = True
    except Exception as e:
        err_msg = getattr(e, 'detail', str(e))
        results["errors"].append(f"LLDP Error: {err_msg}")

    # 4. CDP Refresh
    if is_cisco:
        try:
            await refresh_cdp(device_id)
            results["cdp"] = True
        except Exception as e:
            err_msg = getattr(e, 'detail', str(e))
            results["errors"].append(f"CDP Error: {err_msg}")
    else:
        results["cdp"] = None
        
    return results


@router.post("/{group_id}/refresh")
async def refresh_group_devices(group_id: int, user: dict = Depends(get_current_user)):
    # Verify group access
    perms = user.get("permissions") or {}
    allowed_groups = perms.get("groups", ["*"])
    if "*" not in allowed_groups:
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT name FROM device_groups WHERE id = ?", (group_id,))
        grow = c.fetchone()
        conn.close()
        gname = grow["name"] if grow else "Ungrouped"
        if gname not in allowed_groups:
            raise HTTPException(status_code=403, detail="Akses Ditolak: Anda tidak diizinkan merefresh grup ini.")
    device_ids = get_all_device_ids_in_group(group_id)
    if not device_ids:
        return {
            "success": True, 
            "message": "Tidak ada perangkat di dalam group ini untuk di-refresh.", 
            "refreshed_count": 0,
            "results": {}
        }
        
    # Query names of devices for reporting
    conn = get_db_conn()
    c = conn.cursor()
    placeholders = ",".join("?" for _ in device_ids)
    c.execute(f"SELECT id, name, ip FROM devices WHERE id IN ({placeholders})", device_ids)
    dev_info = {r["id"]: {"name": r["name"], "ip": r["ip"]} for r in c.fetchall()}
    conn.close()
    
    device_results = {}
    for idx, dev_id in enumerate(device_ids):
        info = dev_info.get(dev_id, {"name": f"Device #{dev_id}", "ip": ""})
        dev_name = info["name"]
        dev_ip = info["ip"]
        
        # Process sequential device refresh
        res = await refresh_single_device_full(dev_id)
        
        device_results[dev_id] = {
            **info,
            **res
        }
        
        # Log audit entry for this device
        if res.get("errors"):
            errors_str = "; ".join(res["errors"])
            log_audit(
                user["id"],
                user["username"],
                "REFRESH_FAIL",
                f"devices/{dev_id}",
                f"Gagal refresh data pada {dev_name} ({dev_ip}): {errors_str}"
            )
        else:
            log_audit(
                user["id"],
                user["username"],
                "REFRESH_SUCCESS",
                f"devices/{dev_id}",
                f"Berhasil refresh seluruh data (SNMP, ARP, LLDP, CDP) pada {dev_name} ({dev_ip})."
            )
            
        # Delay to avoid overloading device and network
        if idx < len(device_ids) - 1:
            await asyncio.sleep(0.5)
            
    return {
        "success": True,
        "message": f"Penyegaran grup selesai. {len(device_ids)} perangkat diproses.",
        "refreshed_count": len(device_ids),
        "results": device_results
    }
