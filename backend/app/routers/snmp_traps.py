import json
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from app.database import get_db_conn
from app.services.auth import get_current_user, require_operator_or_admin

router = APIRouter(prefix="/api/snmp-traps", tags=["snmp_traps"])

@router.get("")
async def get_snmp_traps(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    device_id: Optional[str] = Query(None),
    source_ip: Optional[str] = Query(None),
    generic_trap: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve SNMP Traps with pagination, filtering, and search."""
    conn = get_db_conn()
    c = conn.cursor()
    
    query = """
        FROM snmp_traps t
        LEFT JOIN devices d ON t.device_id = d.id
        WHERE 1=1
    """
    params = []
    
    if device_id is not None and device_id != "":
        if device_id == "unregistered":
            query += " AND t.device_id IS NULL"
        else:
            try:
                query += " AND t.device_id = ?"
                params.append(int(device_id))
            except ValueError:
                pass
                
    if source_ip:
        query += " AND t.source_ip = ?"
        params.append(source_ip)
        
    if generic_trap is not None:
        query += " AND t.generic_trap = ?"
        params.append(generic_trap)
        
    if search:
        query += " AND (t.source_ip LIKE ? OR t.community LIKE ? OR t.varbinds LIKE ? OR d.name LIKE ?)"
        search_like = f"%{search}%"
        params.extend([search_like, search_like, search_like, search_like])
        
    # Count total records
    c.execute(f"SELECT COUNT(*) {query}", params)
    total = c.fetchone()[0]
    
    # Fetch records
    offset = (page - 1) * limit
    c.execute(f"""
        SELECT t.id, t.device_id, t.source_ip, t.version, t.community, t.enterprise_oid, 
               t.generic_trap, t.specific_trap, t.uptime, t.varbinds, t.received_at,
               d.name as device_name
        {query}
        ORDER BY t.received_at DESC, t.id DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    
    rows = []
    for r in c.fetchall():
        row_dict = dict(r)
        if row_dict.get("varbinds"):
            try:
                row_dict["varbinds"] = json.loads(row_dict["varbinds"])
            except:
                pass
        rows.append(row_dict)
        
    conn.close()
    
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit or 1,
        "results": rows
    }

@router.delete("/clear")
async def clear_snmp_traps(user: dict = Depends(require_operator_or_admin)):
    """Clear all SNMP Trap records from database."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM snmp_traps")
        deleted_count = c.rowcount
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "SNMP_TRAPS_CLEARED",
            "snmp_traps",
            f"Membersihkan semua log SNMP Trap ({deleted_count} baris) dari database secara manual."
        )
        
        conn.commit()
        return {"success": True, "message": f"Berhasil menghapus {deleted_count} log SNMP Trap."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
