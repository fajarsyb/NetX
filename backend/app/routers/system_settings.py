from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.services.auth import get_current_user, require_operator_or_admin
from app.database import get_db_conn
from app.services.audit import log_audit

router = APIRouter(prefix="/api/system-settings", tags=["system-settings"])

from typing import Optional
from datetime import datetime

class SystemSettingsUpdate(BaseModel):
    ping_auto_refresh_enabled: bool
    ping_auto_refresh_interval: int
    mac_auto_refresh_enabled: bool
    mac_auto_refresh_interval: int
    arp_auto_refresh_enabled: bool
    arp_auto_refresh_interval: int
    
    # Alerting / Notification Channels
    alert_webhook_enabled: bool
    alert_webhook_url: Optional[str] = ""
    alert_telegram_enabled: bool
    alert_telegram_bot_token: Optional[str] = ""
    alert_telegram_chat_id: Optional[str] = ""
    alert_email_enabled: bool
    alert_email_smtp_host: Optional[str] = ""
    alert_email_smtp_port: int
    alert_email_smtp_user: Optional[str] = ""
    alert_email_smtp_password: Optional[str] = ""
    alert_email_to: Optional[str] = ""

@router.get("")
def get_system_settings(current_user: dict = Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT key, value FROM system_settings")
        rows = c.fetchall()
    except Exception as e:
        rows = []
    finally:
        conn.close()
    
    settings = {}
    for row in rows:
        key = row["key"]
        val = row["value"]
        if "enabled" in key:
            settings[key] = val.lower() == "true"
        elif "interval" in key or "port" in key:
            settings[key] = int(val) if val else 0
        else:
            settings[key] = val
            
    # Provide defaults if any settings are missing
    defaults = {
        "ping_auto_refresh_enabled": True,
        "ping_auto_refresh_interval": 300,
        "mac_auto_refresh_enabled": True,
        "mac_auto_refresh_interval": 3600,
        "arp_auto_refresh_enabled": True,
        "arp_auto_refresh_interval": 600,
        "alert_webhook_enabled": False,
        "alert_webhook_url": "",
        "alert_telegram_enabled": False,
        "alert_telegram_bot_token": "",
        "alert_telegram_chat_id": "",
        "alert_email_enabled": False,
        "alert_email_smtp_host": "",
        "alert_email_smtp_port": 587,
        "alert_email_smtp_user": "",
        "alert_email_smtp_password": "",
        "alert_email_to": "",
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
            
            "alert_webhook_enabled": "true" if settings.alert_webhook_enabled else "false",
            "alert_webhook_url": settings.alert_webhook_url or "",
            "alert_telegram_enabled": "true" if settings.alert_telegram_enabled else "false",
            "alert_telegram_bot_token": settings.alert_telegram_bot_token or "",
            "alert_telegram_chat_id": settings.alert_telegram_chat_id or "",
            "alert_email_enabled": "true" if settings.alert_email_enabled else "false",
            "alert_email_smtp_host": settings.alert_email_smtp_host or "",
            "alert_email_smtp_port": str(settings.alert_email_smtp_port or 587),
            "alert_email_smtp_user": settings.alert_email_smtp_user or "",
            "alert_email_smtp_password": settings.alert_email_smtp_password or "",
            "alert_email_to": settings.alert_email_to or "",
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

@router.post("/test-alert")
def send_test_alert(current_user: dict = Depends(get_current_user)):
    """Triggers a background test notification to all active alerting channels."""
    try:
        from app.services.alert_service import trigger_anomaly_alert
        trigger_anomaly_alert(
            device_id=0, # Use ID 0 for test alerts
            anomaly_type="test_alert",
            severity="info",
            interface_name="VirtualPort1",
            details="Ini adalah pesan uji coba sistem notifikasi NetX. Koneksi berhasil!",
            detected_at=datetime.now().isoformat()
        )
        return {"success": True, "message": "Pesan uji coba berhasil dikirim ke latar belakang."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

