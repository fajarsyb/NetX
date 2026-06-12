from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.services.auth import get_current_user, require_operator_or_admin
from app.database import get_db_conn
from app.services.audit import log_audit

router = APIRouter(prefix="/api/system-settings", tags=["system-settings"])

class SystemSettingsUpdate(BaseModel):
    ping_auto_refresh_enabled: bool
    ping_auto_refresh_interval: int
    mac_auto_refresh_enabled: bool
    mac_auto_refresh_interval: int
    arp_auto_refresh_enabled: bool
    arp_auto_refresh_interval: int

@router.get("")
def get_system_settings(current_user: dict = Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT key, value FROM system_settings")
        rows = c.fetchall()
    except Exception as e:
        # Fallback if table doesn't exist yet (should exist from init_db)
        rows = []
    finally:
        conn.close()
    
    settings = {}
    for row in rows:
        key = row["key"]
        val = row["value"]
        if "enabled" in key:
            settings[key] = val.lower() == "true"
        elif "interval" in key:
            settings[key] = int(val)
        else:
            settings[key] = val
            
    # Provide defaults if any settings are missing
    defaults = {
        "ping_auto_refresh_enabled": True,
        "ping_auto_refresh_interval": 300,
        "mac_auto_refresh_enabled": True,
        "mac_auto_refresh_interval": 3600,
        "arp_auto_refresh_enabled": True,
        "arp_auto_refresh_interval": 600
    }
    for k, v in defaults.items():
        if k not in settings:
            settings[k] = v
            
    return settings

@router.post("")
def update_system_settings(
    settings: SystemSettingsUpdate,
    user: dict = Depends(require_operator_or_admin)
):
    conn = get_db_conn()
    c = conn.cursor()
    
    try:
        updates = {
            "ping_auto_refresh_enabled": "true" if settings.ping_auto_refresh_enabled else "false",
            "ping_auto_refresh_interval": str(settings.ping_auto_refresh_interval),
            "mac_auto_refresh_enabled": "true" if settings.mac_auto_refresh_enabled else "false",
            "mac_auto_refresh_interval": str(settings.mac_auto_refresh_interval),
            "arp_auto_refresh_enabled": "true" if settings.arp_auto_refresh_enabled else "false",
            "arp_auto_refresh_interval": str(settings.arp_auto_refresh_interval),
        }
        
        for key, val in updates.items():
            c.execute("DELETE FROM system_settings WHERE key = ?", (key,))
            c.execute("INSERT INTO system_settings (key, value) VALUES (?, ?)", (key, val))
            
        conn.commit()
        log_audit(
            user["id"],
            user["username"],
            "UPDATE_SYSTEM_SETTINGS",
            "system_settings",
            f"Updated system settings: {updates}"
        )
        return {"success": True, "message": "Pengaturan sistem berhasil diperbarui."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal memperbarui pengaturan: {str(e)}")
    finally:
        conn.close()
