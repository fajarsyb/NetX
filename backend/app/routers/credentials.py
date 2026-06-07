from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from app.database import get_db_conn, encrypt_password, decrypt_password
from app.services.auth import get_current_user, require_admin
from app.services.audit import log_audit
from app.services.credential_scanner import run_credential_scan, get_compliance_records

router = APIRouter(prefix="/api/credentials", tags=["credentials"])

class CredentialCreate(BaseModel):
    name: str
    username: str
    password: str

class CredentialUpdate(BaseModel):
    name: str
    username: str
    password: str

class ScanRequest(BaseModel):
    device_ids: Optional[List[int]] = None

@router.get("")
async def list_credentials():
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, name, username, created_at FROM device_credentials ORDER BY name COLLATE NOCASE")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.post("")
async def create_credential(cred: CredentialCreate, admin: dict = Depends(require_admin)):
    conn = get_db_conn()
    c = conn.cursor()
    now = datetime.now().isoformat()
    enc_pass = encrypt_password(cred.password)
    try:
        c.execute(
            "INSERT INTO device_credentials (name, username, password, created_at) VALUES (?, ?, ?, ?)",
            (cred.name, cred.username, enc_pass, now)
        )
        conn.commit()
        cred_id = c.lastrowid
        conn.close()
        log_audit(admin["id"], admin["username"], "CREATE_CREDENTIAL", f"credentials/{cred_id}", f"Created credential template: {cred.name}")
        return {"success": True, "id": cred_id, "message": "Credential berhasil ditambahkan."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail="Nama credential sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{cred_id}")
async def delete_credential(cred_id: int, admin: dict = Depends(require_admin)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT name FROM device_credentials WHERE id = ?", (cred_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Credential tidak ditemukan.")
    cred_name = row["name"]
    
    c.execute("DELETE FROM device_credentials WHERE id = ?", (cred_id,))
    conn.commit()
    conn.close()
    log_audit(admin["id"], admin["username"], "DELETE_CREDENTIAL", f"credentials/{cred_id}", f"Deleted credential template: {cred_name}")
    return {"success": True, "message": "Credential berhasil dihapus."}

@router.get("/compliance")
async def get_compliance(admin: dict = Depends(require_admin)):
    try:
        records = get_compliance_records()
        return records
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/compliance/scan")
async def trigger_scan(req: Optional[ScanRequest] = None, admin: dict = Depends(require_admin)):
    try:
        device_ids = req.device_ids if req else None
        results = await run_credential_scan(device_ids)
        log_audit(admin["id"], admin["username"], "SCAN_CREDENTIALS", "credentials/compliance", f"Triggered credential compliance scan on {len(results)} devices.")
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
