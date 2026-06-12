import threading
import urllib.request
import urllib.parse
import json
import logging
import smtplib
from email.mime.text import MIMEText
from app.database import get_db_conn

logger = logging.getLogger("netx.alert_service")

def get_alert_settings():
    """Fetches key-value configuration flags from the system_settings table."""
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("SELECT key, value FROM system_settings")
        rows = c.fetchall()
    except Exception as e:
        logger.error(f"Failed to fetch system settings: {e}")
        rows = []
    finally:
        conn.close()
    
    settings = {}
    for r in rows:
        settings[r["key"]] = r["value"]
    return settings

def _send_alerts_background(device_id, anomaly_type, severity, interface_name, details, detected_at):
    """Sends payloads in a background thread to prevent blocking event loop execution."""
    try:
        # Fetch device details
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT name, ip FROM devices WHERE id = ?", (device_id,))
        dev_row = c.fetchone()
        conn.close()
        
        if dev_row:
            device_name = dev_row["name"]
            device_ip = dev_row["ip"]
        else:
            # Handle mock or deleted devices gracefully
            device_name = "Mock / Unknown Device"
            device_ip = "0.0.0.0"
            
        settings = get_alert_settings()
        
        # 1. Webhook Alert
        if settings.get("alert_webhook_enabled") == "true" and settings.get("alert_webhook_url"):
            try:
                url = settings["alert_webhook_url"]
                payload = {
                    "event": "anomaly_detected",
                    "device_id": device_id,
                    "device_name": device_name,
                    "device_ip": device_ip,
                    "anomaly_type": anomaly_type,
                    "severity": severity,
                    "interface_name": interface_name or "",
                    "details": details or "",
                    "detected_at": detected_at
                }
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=5) as res:
                    res.read()
                logger.info(f"Webhook alert sent successfully to {url}")
            except Exception as e:
                logger.error(f"Failed to send Webhook alert: {e}")
                
        # 2. Telegram Alert
        if settings.get("alert_telegram_enabled") == "true" and settings.get("alert_telegram_bot_token") and settings.get("alert_telegram_chat_id"):
            try:
                token = settings["alert_telegram_bot_token"]
                chat_id = settings["alert_telegram_chat_id"]
                msg = (
                    f"⚠️ *NetX Alert: Anomali Terdeteksi!*\n\n"
                    f"*Perangkat:* {device_name} ({device_ip})\n"
                    f"*Tipe:* {anomaly_type}\n"
                    f"*Tingkat:* {severity.upper()}\n"
                    f"*Interface:* {interface_name or '-'}\n"
                    f"*Detail:* {details or '-'}\n"
                    f"*Waktu:* {detected_at}"
                )
                url = f"https://api.telegram.org/bot{token}/sendMessage"
                data = urllib.parse.urlencode({
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "Markdown"
                }).encode("utf-8")
                req = urllib.request.Request(url, data=data)
                with urllib.request.urlopen(req, timeout=5) as res:
                    res.read()
                logger.info(f"Telegram alert sent successfully to chat {chat_id}")
            except Exception as e:
                logger.error(f"Failed to send Telegram alert: {e}")
                
        # 3. Email Alert
        if settings.get("alert_email_enabled") == "true" and settings.get("alert_email_to"):
            try:
                smtp_host = settings.get("alert_email_smtp_host")
                smtp_port = int(settings.get("alert_email_smtp_port", 587) or 587)
                smtp_user = settings.get("alert_email_smtp_user")
                smtp_pass = settings.get("alert_email_smtp_password")
                to_emails = [e.strip() for e in settings["alert_email_to"].split(",") if e.strip()]
                
                if not to_emails:
                    return
                    
                body = (
                    f"Sistem NetX telah mendeteksi anomali pada infrastruktur jaringan Anda.\n\n"
                    f"Detail Anomali:\n"
                    f"- Perangkat: {device_name} ({device_ip})\n"
                    f"- Tipe Anomali: {anomaly_type}\n"
                    f"- Keparahan: {severity}\n"
                    f"- Interface: {interface_name or '-'}\n"
                    f"- Keterangan: {details or '-'}\n"
                    f"- Waktu Deteksi: {detected_at}\n\n"
                    f"Silakan login ke Dashboard NetX untuk melakukan investigasi lebih lanjut."
                )
                
                msg = MIMEText(body)
                msg["Subject"] = f"[NetX Alert] Anomali Terdeteksi - {severity.upper()}: {anomaly_type}"
                msg["From"] = smtp_user or "alerts@netx.local"
                msg["To"] = ", ".join(to_emails)
                
                with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                    if smtp_port == 587:
                        server.starttls()
                    if smtp_user and smtp_pass:
                        server.login(smtp_user, smtp_pass)
                    server.sendmail(msg["From"], to_emails, msg.as_string())
                logger.info(f"Email alert sent successfully to {to_emails}")
            except Exception as e:
                logger.error(f"Failed to send Email alert: {e}")
                
    except Exception as ex:
        logger.error(f"Error in background alert handler: {ex}")

def trigger_anomaly_alert(device_id, anomaly_type, severity, interface_name, details, detected_at):
    """Entrypoint to trigger concurrent notification dispatch in background threads."""
    t = threading.Thread(
        target=_send_alerts_background,
        args=(device_id, anomaly_type, severity, interface_name, details, detected_at)
    )
    t.daemon = True
    t.start()
