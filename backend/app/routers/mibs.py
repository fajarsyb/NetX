from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.database import get_db_conn
from app.services.auth import require_operator_or_admin, get_current_user
from app.services.mib_parser import parse_mib_text, resolve_mibs_oids

router = APIRouter(prefix="/api/mibs", tags=["mibs"])

class MibUpdate(BaseModel):
    description: Optional[str] = None
    vendor: Optional[str] = None
    is_active: Optional[int] = None

@router.post("/import")
async def import_mib(
    file: UploadFile = File(...),
    description: Optional[str] = Form(""),
    vendor: Optional[str] = Form("all"),
    user: dict = Depends(require_operator_or_admin)
):
    """
    Upload and parse an ASN.1 SNMP MIB file.
    Extracts OBJECT-TYPEs and OBJECT IDENTIFIERs, resolves their relative OIDs,
    and stores them in the database.
    """
    content_bytes = await file.read()
    try:
        content_text = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            content_text = content_bytes.decode("latin-1")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Gagal membaca file: {str(e)}")

    # Parse MIB content
    mib_name, parsed_objects = parse_mib_text(content_text)
    
    if not parsed_objects:
        raise HTTPException(
            status_code=400, 
            detail="Tidak menemukan objek OID yang valid dalam berkas MIB ini. Pastikan berkas menggunakan sintaks ASN.1 MIB standar."
        )

    conn = get_db_conn()
    try:
        # Resolve OIDs
        resolved_objects = resolve_mibs_oids(parsed_objects, conn)
        
        c = conn.cursor()
        now = datetime.now().isoformat()
        
        # Check if MIB already exists
        c.execute("SELECT id FROM snmp_mibs WHERE name = ?", (mib_name,))
        existing = c.fetchone()
        
        if existing:
            mib_id = existing["id"]
            # Overwrite metadata and clear old objects
            c.execute("""
                UPDATE snmp_mibs 
                SET description = ?, vendor = ?, created_at = ? 
                WHERE id = ?
            """, (description or f"Parsed from {file.filename}", vendor or "all", now, mib_id))
            c.execute("DELETE FROM snmp_mib_objects WHERE mib_id = ?", (mib_id,))
        else:
            # Insert new MIB metadata
            c.execute("""
                INSERT INTO snmp_mibs (name, description, vendor, is_active, created_at)
                VALUES (?, ?, ?, 1, ?)
            """, (mib_name, description or f"Parsed from {file.filename}", vendor or "all", now))
            mib_id = c.lastrowid
            
        # Bulk insert parsed objects
        insert_data = [
            (
                mib_id,
                obj["name"],
                obj["oid"],
                obj["syntax"],
                obj["description"]
            )
            for obj in resolved_objects
        ]
        
        c.executemany("""
            INSERT INTO snmp_mib_objects (mib_id, name, oid, syntax, description)
            VALUES (?, ?, ?, ?, ?)
        """, insert_data)
        
        conn.commit()
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "SNMP_MIB_IMPORTED",
            f"mibs/{mib_id}",
            f"Berhasil mengimpor MIB {mib_name} dengan {len(resolved_objects)} objek."
        )
        
        return {
            "success": True,
            "mib_id": mib_id,
            "name": mib_name,
            "objects_count": len(resolved_objects),
            "message": f"MIB '{mib_name}' berhasil diimpor dengan {len(resolved_objects)} objek."
        }
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        conn.close()

@router.get("")
async def list_mibs(current_user: dict = Depends(get_current_user)):
    """
    List all imported SNMP MIBs with object counts.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT m.id, m.name, m.description, m.vendor, m.is_active, m.created_at,
               COUNT(o.id) as objects_count
        FROM snmp_mibs m
        LEFT JOIN snmp_mib_objects o ON m.id = o.mib_id
        GROUP BY m.id
        ORDER BY m.name COLLATE NOCASE
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.put("/{mib_id}")
async def update_mib(
    mib_id: int, 
    body: MibUpdate, 
    user: dict = Depends(require_operator_or_admin)
):
    """
    Update MIB description, vendor mappings, or active state.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM snmp_mibs WHERE id = ?", (mib_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="MIB tidak ditemukan.")
        
    current = dict(row)
    updates = body.dict(exclude_none=True)
    
    if not updates:
        conn.close()
        return {"success": True, "message": "Tidak ada perubahan."}
        
    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    vals = list(updates.values()) + [mib_id]
    
    try:
        c.execute(f"UPDATE snmp_mibs SET {set_clause} WHERE id = ?", vals)
        conn.commit()
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "SNMP_MIB_UPDATED",
            f"mibs/{mib_id}",
            f"Memperbarui parameter MIB {current['name']}: {list(updates.keys())}"
        )
        return {"success": True, "message": "MIB berhasil diperbarui."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.delete("/{mib_id}")
async def delete_mib(mib_id: int, user: dict = Depends(require_operator_or_admin)):
    """
    Delete an imported MIB and all its associated objects.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name FROM snmp_mibs WHERE id = ?", (mib_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="MIB tidak ditemukan.")
        
    mib_name = row["name"]
    try:
        c.execute("DELETE FROM snmp_mibs WHERE id = ?", (mib_id,))
        conn.commit()
        
        # Log audit
        from app.services.audit import log_audit
        log_audit(
            user["id"],
            user["username"],
            "SNMP_MIB_DELETED",
            f"mibs/{mib_id}",
            f"Menghapus MIB {mib_name} dan seluruh objek di dalamnya."
        )
        return {"success": True, "message": f"MIB '{mib_name}' berhasil dihapus."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get("/{mib_id}/objects")
async def list_mib_objects(mib_id: int, current_user: dict = Depends(get_current_user)):
    """
    List all OIDs/objects parsed in a specific MIB.
    """
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id, name, oid, syntax, description 
        FROM snmp_mib_objects 
        WHERE mib_id = ? 
        ORDER BY name COLLATE NOCASE
    """, (mib_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.get("/objects/active")
async def get_active_mib_objects(
    vendor: Optional[str] = None, 
    current_user: dict = Depends(get_current_user)
):
    """
    Retrieve all OID objects from active MIBs.
    Filters by vendor if specified (returning objects associated with that vendor or 'all').
    """
    conn = get_db_conn()
    c = conn.cursor()
    
    if vendor:
        c.execute("""
            SELECT o.id, o.name, o.oid, o.syntax, o.description, m.name as mib_name, m.vendor as mib_vendor
            FROM snmp_mib_objects o
            JOIN snmp_mibs m ON o.mib_id = m.id
            WHERE m.is_active = 1 AND (m.vendor = ? OR m.vendor = 'all')
            ORDER BY o.name COLLATE NOCASE
        """, (vendor,))
    else:
        c.execute("""
            SELECT o.id, o.name, o.oid, o.syntax, o.description, m.name as mib_name, m.vendor as mib_vendor
            FROM snmp_mib_objects o
            JOIN snmp_mibs m ON o.mib_id = m.id
            WHERE m.is_active = 1
            ORDER BY o.name COLLATE NOCASE
        """)
        
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows
