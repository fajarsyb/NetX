import os
import zipfile
import sqlite3
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.services.auth import require_admin
from app.services.audit import log_audit

router = APIRouter(prefix="/api/backups", tags=["backups"])

BACKUP_DIR = "data/backups"
os.makedirs(BACKUP_DIR, exist_ok=True)

@router.get("")
async def list_backups(admin: dict = Depends(require_admin)):
    backups = []
    for f in os.listdir(BACKUP_DIR):
        if f.endswith(".zip"):
            fp = os.path.join(BACKUP_DIR, f)
            stat = os.stat(fp)
            backups.append({
                "filename": f,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
    # Sort by mtime descending
    backups.sort(key=lambda x: x["created_at"], reverse=True)
    return backups

@router.post("")
async def create_backup(admin: dict = Depends(require_admin)):
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_name = f"netx_backup_{timestamp}.zip"
        zip_path = os.path.join(BACKUP_DIR, zip_name)
        
        # 1. Backup the SQLite DB using backup API to avoid locks or half-written WAL
        temp_db_path = os.path.join(BACKUP_DIR, "temp_netx.db")
        src_conn = sqlite3.connect("data/netx.db")
        dest_conn = sqlite3.connect(temp_db_path)
        with dest_conn:
            src_conn.backup(dest_conn)
        dest_conn.close()
        src_conn.close()
        
        # 2. Compress both db and key
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(temp_db_path, "netx.db")
            if os.path.exists("data/secret.key"):
                zipf.write("data/secret.key", "secret.key")
                
        # 3. Clean temp db
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
            
        log_audit(admin["id"], admin["username"], "CREATE_BACKUP", f"backups/{zip_name}", f"Backup created successfully: {zip_name}")
        return {"success": True, "filename": zip_name, "message": "Pencadangan berhasil."}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal membuat backup: {str(e)}")

@router.post("/{filename}/restore")
async def restore_backup(filename: str, admin: dict = Depends(require_admin)):
    zip_path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="File backup tidak ditemukan.")
        
    try:
        # 1. Extract zip to a temporary folder
        temp_extract_dir = os.path.join(BACKUP_DIR, "temp_extract")
        os.makedirs(temp_extract_dir, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zipf:
            zipf.extractall(temp_extract_dir)
            
        restored_db = os.path.join(temp_extract_dir, "netx.db")
        restored_key = os.path.join(temp_extract_dir, "secret.key")
        
        if not os.path.exists(restored_db):
            # Clean up
            shutil.rmtree(temp_extract_dir)
            raise HTTPException(status_code=400, detail="Backup file corrupt: netx.db tidak ditemukan.")
            
        # 2. Restore Database in-place via backup API (safe for active connections)
        src_conn = sqlite3.connect(restored_db)
        dest_conn = sqlite3.connect("data/netx.db")
        with dest_conn:
            src_conn.backup(dest_conn)
        dest_conn.close()
        src_conn.close()
        
        # 3. Restore secret key if exists
        if os.path.exists(restored_key):
            shutil.copy2(restored_key, "data/secret.key")
            
        # 4. Clean up temporary files
        shutil.rmtree(temp_extract_dir)
        
        log_audit(admin["id"], admin["username"], "RESTORE_BACKUP", f"backups/{filename}", f"Database restored from backup: {filename}")
        return {"success": True, "message": "Pemulihan basis data berhasil. Hubungkan kembali perangkat jika diperlukan."}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memulihkan cadangan: {str(e)}")

@router.delete("/{filename}")
async def delete_backup(filename: str, admin: dict = Depends(require_admin)):
    zip_path = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="File backup tidak ditemukan.")
        
    try:
        os.remove(zip_path)
        log_audit(admin["id"], admin["username"], "DELETE_BACKUP", f"backups/{filename}", f"Deleted backup file: {filename}")
        return {"success": True, "message": "Cadangan berhasil dihapus."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal menghapus file cadangan: {str(e)}")
