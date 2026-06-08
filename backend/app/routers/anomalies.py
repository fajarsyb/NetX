from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.database import get_db_conn
from app.services.auth import get_current_user, require_operator_or_admin

router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])

@router.get("/active")
async def get_active_anomalies(current_user: dict = Depends(get_current_user)):
    """Retrieve all active network anomalies."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT a.*, d.name as device_name, d.ip as device_ip
        FROM network_anomalies a
        JOIN devices d ON a.device_id = d.id
        WHERE a.is_active = 1
        ORDER BY a.detected_at DESC
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.get("/history")
async def get_anomalies_history(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1),
    anomaly_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    device_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve network anomalies history with pagination and filters."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # Build query
    query = """
        FROM network_anomalies a
        JOIN devices d ON a.device_id = d.id
        WHERE 1=1
    """
    params = []
    
    if anomaly_type:
        query += " AND a.anomaly_type = ?"
        params.append(anomaly_type)
    if severity:
        query += " AND a.severity = ?"
        params.append(severity)
    if device_id:
        query += " AND a.device_id = ?"
        params.append(device_id)
    if search:
        query += " AND (a.details LIKE ? OR a.interface_name LIKE ? OR d.name LIKE ? OR d.ip LIKE ?)"
        search_param = f"%{search}%"
        params.extend([search_param, search_param, search_param, search_param])
        
    # Count total
    c.execute(f"SELECT COUNT(*) {query}", params)
    total = c.fetchone()[0]
    
    # Fetch paginated rows
    offset = (page - 1) * limit
    c.execute(f"""
        SELECT a.*, d.name as device_name, d.ip as device_ip
        {query}
        ORDER BY a.detected_at DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit or 1,
        "results": rows
    }

@router.post("/{anomaly_id}/resolve")
async def resolve_anomaly(anomaly_id: int, user: dict = Depends(require_operator_or_admin)):
    """Mark a specific anomaly as resolved."""
    conn = get_db_conn()
    c = conn.cursor()
    
    c.execute("SELECT * FROM network_anomalies WHERE id = ?", (anomaly_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Anomali tidak ditemukan.")
        
    anomaly = dict(row)
    if not anomaly["is_active"]:
        conn.close()
        return {"success": True, "message": "Anomali sudah diselesaikan sebelumnya."}
        
    now_iso = datetime.now().isoformat()
    
    try:
        c.execute("""
            UPDATE network_anomalies 
            SET is_active = 0, resolved_at = ? 
            WHERE id = ?
        """, (now_iso, anomaly_id))
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "NETWORK_ANOMALY_RESOLVED",
            f"anomalies/{anomaly_id}",
            f"Menyelesaikan anomali {anomaly['anomaly_type']} pada interface {anomaly['interface_name']} secara manual."
        )
        
        conn.commit()
        return {"success": True, "message": "Anomali berhasil ditandai sebagai terselesaikan."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/device-summary")
async def get_device_anomaly_summary(current_user: dict = Depends(get_current_user)):
    """Return a per-device summary of active anomalies (port health indicators)."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT device_id, severity, anomaly_type
        FROM network_anomalies
        WHERE is_active = 1
    """)
    rows = c.fetchall()
    conn.close()

    device_map = {}
    for r in rows:
        did = r["device_id"]
        if did not in device_map:
            device_map[did] = {"device_id": did, "critical_count": 0, "warning_count": 0, "anomaly_types": set()}
        if r["severity"] == "critical":
            device_map[did]["critical_count"] += 1
        else:
            device_map[did]["warning_count"] += 1
        device_map[did]["anomaly_types"].add(r["anomaly_type"])

    result = []
    for d in device_map.values():
        d["anomaly_types"] = list(d["anomaly_types"])
        result.append(d)
    return result

@router.post("/resolve-all")
async def resolve_all_anomalies(user: dict = Depends(require_operator_or_admin)):
    """Mark all active anomalies as resolved."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # Get active count
    c.execute("SELECT COUNT(*) FROM network_anomalies WHERE is_active = 1")
    active_count = c.fetchone()[0]
    
    if active_count == 0:
        conn.close()
        return {"success": True, "message": "Tidak ada anomali aktif untuk diselesaikan."}
        
    now_iso = datetime.now().isoformat()
    
    try:
        c.execute("UPDATE network_anomalies SET is_active = 0, resolved_at = ? WHERE is_active = 1", (now_iso,))
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "NETWORK_ANOMALIES_RESOLVED_ALL",
            "anomalies",
            f"Menyelesaikan {active_count} anomali secara massal."
        )
        
        conn.commit()
        return {"success": True, "message": f"Berhasil menyelesaikan {active_count} anomali."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/rca")
async def get_rca_incidents(current_user: dict = Depends(get_current_user)):
    """Retrieve correlated anomaly incidents grouped by root causes and their impacts."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        # Fetch all active anomalies with device info
        c.execute("""
            SELECT a.*, d.name as device_name, d.ip as device_ip
            FROM network_anomalies a
            JOIN devices d ON a.device_id = d.id
            WHERE a.is_active = 1
            ORDER BY a.detected_at DESC
        """)
        anoms = [dict(r) for r in c.fetchall()]
        conn.close()
        
        # Build lookup by ID
        anom_map = {a["id"]: a for a in anoms}
        
        # Separate root causes and child impacts
        root_causes = []
        child_map = {}
        
        for a in anoms:
            pid = a.get("parent_anomaly_id")
            if pid and pid in anom_map:
                if pid not in child_map:
                    child_map[pid] = []
                child_map[pid].append(a)
            else:
                root_causes.append(a)
                
        incidents = []
        for rc in root_causes:
            rc_id = rc["id"]
            impacts = child_map.get(rc_id, [])
            incidents.append({
                "id": rc_id,
                "root_cause": rc,
                "impacts": impacts,
                "impact_count": len(impacts)
            })
            
        def sort_key(inc):
            sev_score = {"critical": 2, "warning": 1}.get(inc["root_cause"]["severity"], 0)
            return (sev_score, inc["impact_count"], inc["root_cause"]["detected_at"])
            
        incidents.sort(key=sort_key, reverse=True)
        return incidents
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))

