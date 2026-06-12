import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.services.auth import require_admin
from app.services.remote_backup_service import RemoteBackupService
from app.database import get_db_conn

router = APIRouter(prefix="/api/remote-backups", tags=["remote-backups"])

class RemoteBackupSettingsModel(BaseModel):
    protocol: str = Field("sftp", description="'ftp', 'sftp', 'scp'")
    host: str = Field(..., min_length=1)
    port: int = Field(22)
    username: str = Field(..., min_length=1)
    password: str = Field("")
    path: Optional[str] = Field("")
    is_active: int = Field(0)
    backup_db: int = Field(0)
    backup_config: int = Field(0)

@router.get("")
def get_settings(admin: dict = Depends(require_admin)):
    """Retrieve remote backup settings."""
    try:
        settings = RemoteBackupService.get_settings()
        # Mask password for client security
        if settings.get("password"):
            settings["password"] = "••••••••"
        return settings
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("")
def save_settings(data: RemoteBackupSettingsModel, admin: dict = Depends(require_admin)):
    """Save or update remote backup settings."""
    try:
        existing = RemoteBackupService.get_settings()
        settings_dict = data.dict()
        
        # If the user did not change the masked password, preserve the existing one
        if settings_dict["password"] == "••••••••":
            settings_dict["password"] = existing.get("password") or ""
            
        RemoteBackupService.save_settings(settings_dict)
        return {"success": True, "message": "Pengaturan backup eksternal berhasil disimpan."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test")
def test_connection(data: RemoteBackupSettingsModel, admin: dict = Depends(require_admin)):
    """Test remote connection parameters."""
    try:
        existing = RemoteBackupService.get_settings()
        settings_dict = data.dict()
        
        if settings_dict["password"] == "••••••••":
            settings_dict["password"] = existing.get("password") or ""
            
        res = RemoteBackupService.test_connection(settings_dict)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-db")
def upload_latest_database_backup(admin: dict = Depends(require_admin)):
    """Manually trigger upload of the latest database backup file."""
    # Find latest backup zip
    from restore_to_postgres import find_latest_backup
    latest_zip = find_latest_backup()
    if not latest_zip or not latest_zip.exists():
        raise HTTPException(status_code=404, detail="Tidak ada file backup database lokal untuk diunggah.")
        
    filename = latest_zip.name
    success = RemoteBackupService.upload_file(str(latest_zip), filename, force=True)
    if success:
        return {"success": True, "message": f"Berhasil mengunggah file database '{filename}' ke server backup."}
    else:
        raise HTTPException(status_code=502, detail="Gagal mengunggah file database ke server remote. Periksa log server.")
