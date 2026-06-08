from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from pydantic import BaseModel
from app.database import get_db_conn
from app.services.auth import get_current_user, require_operator_or_admin

router = APIRouter(prefix="/api/syslog", tags=["syslog"])

@router.get("")
async def get_syslogs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    device_id: Optional[str] = Query(None),
    severity: Optional[int] = Query(None, ge=0, le=7),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve syslog messages with pagination, filtering, and search."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # Base query
    query = """
        FROM device_syslogs s
        LEFT JOIN devices d ON s.device_id = d.id
        WHERE 1=1
    """
    params = []
    
    if device_id is not None and device_id != "":
        if device_id == "unregistered":
            query += " AND s.device_id IS NULL"
        else:
            try:
                query += " AND s.device_id = ?"
                params.append(int(device_id))
            except ValueError:
                pass
        
    if severity is not None:
        query += " AND s.severity = ?"
        params.append(severity)
        
    if search:
        query += " AND (s.message LIKE ? OR s.program LIKE ? OR d.name LIKE ? OR d.ip LIKE ? OR s.sender_ip LIKE ?)"
        search_like = f"%{search}%"
        params.extend([search_like, search_like, search_like, search_like, search_like])
        
    # Count total records
    c.execute(f"SELECT COUNT(*) {query}", params)
    total = c.fetchone()[0]
    
    # Fetch records
    offset = (page - 1) * limit
    c.execute(f"""
        SELECT s.id, s.device_id, s.facility, s.severity, s.program, s.message, s.timestamp, s.raw_message, 
               d.name as device_name, COALESCE(d.ip, s.sender_ip) as device_ip
        {query}
        ORDER BY s.timestamp DESC, s.id DESC
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

@router.get("/senders")
async def get_syslog_senders(current_user: dict = Depends(get_current_user)):
    """Retrieve list of devices/IPs that have sent syslog messages, with log counts and last seen times."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT 
                s.device_id,
                COALESCE(d.name, 'Perangkat Tidak Terdaftar') as device_name,
                COALESCE(d.ip, s.sender_ip) as device_ip,
                s.sender_ip as raw_sender_ip,
                COUNT(*) as log_count,
                MAX(s.timestamp) as last_seen
            FROM device_syslogs s
            LEFT JOIN devices d ON s.device_id = d.id
            GROUP BY s.device_id, COALESCE(d.ip, s.sender_ip)
            ORDER BY last_seen DESC
        """)
        rows = [dict(r) for r in c.fetchall()]
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.delete("/clear")
async def clear_syslogs(user: dict = Depends(require_operator_or_admin)):
    """Clear all syslog records from database."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM device_syslogs")
        deleted_count = c.rowcount
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "SYSLOG_CLEARED",
            "syslog",
            f"Membersihkan semua log syslog ({deleted_count} baris) dari database secara manual."
        )
        
        conn.commit()
        return {"success": True, "message": f"Berhasil menghapus {deleted_count} log syslog."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/patterns")
async def get_syslog_patterns(current_user: dict = Depends(get_current_user)):
    """Retrieve all syslog patterns with counts of occurrences."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("""
            SELECT p.*, COUNT(s.id) as occurrence_count, MAX(s.timestamp) as last_seen
            FROM syslog_patterns p
            LEFT JOIN device_syslogs s ON p.pattern_hash = s.pattern_hash
            GROUP BY p.pattern_hash
            ORDER BY occurrence_count DESC, last_seen DESC
        """)
        rows = [dict(r) for r in c.fetchall()]
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

class PatternUpdate(BaseModel):
    is_blocked: Optional[int] = None
    is_anomaly: Optional[int] = None

@router.put("/patterns/{pattern_hash}")
async def update_syslog_pattern(
    pattern_hash: str,
    body: PatternUpdate,
    user: dict = Depends(require_operator_or_admin)
):
    """Update block or anomaly state of a syslog pattern."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT * FROM syslog_patterns WHERE pattern_hash = ?", (pattern_hash,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pola syslog tidak ditemukan.")
            
        updates = []
        params = []
        if body.is_blocked is not None:
            updates.append("is_blocked = ?")
            params.append(body.is_blocked)
        if body.is_anomaly is not None:
            updates.append("is_anomaly = ?")
            params.append(body.is_anomaly)
            
        if not updates:
            return {"success": True, "message": "Tidak ada perubahan."}
            
        params.append(pattern_hash)
        c.execute(f"UPDATE syslog_patterns SET {', '.join(updates)} WHERE pattern_hash = ?", params)
        conn.commit()
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "UPDATE_SYSLOG_PATTERN",
            f"syslog/patterns/{pattern_hash}",
            f"Mengubah status pola {pattern_hash}: is_blocked={body.is_blocked}, is_anomaly={body.is_anomaly}"
        )
        return {"success": True, "message": "Status pola syslog berhasil diperbarui."}
    except HTTPException as he:
        raise he
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
