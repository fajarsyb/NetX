import os
import io
import logging
import ftplib
import tempfile
from pathlib import Path
import paramiko
from scp import SCPClient
from app.database import get_db_conn, encrypt_password, decrypt_password

logger = logging.getLogger("netx.services.remote_backup")

class RemoteBackupService:
    @staticmethod
    def get_settings() -> dict:
        """Fetch remote backup settings from database."""
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM remote_backup_settings ORDER BY id DESC LIMIT 1")
        row = c.fetchone()
        conn.close()
        
        if not row:
            return {
                "id": None,
                "protocol": "sftp",
                "host": "",
                "port": 22,
                "username": "",
                "password": "",
                "path": "",
                "is_active": 0,
                "backup_db": 0,
                "backup_config": 0
            }
        
        res = dict(row)
        res["password"] = decrypt_password(res.get("password") or "")
        return res

    @staticmethod
    def save_settings(settings: dict):
        """Save/Update remote backup settings in database."""
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT COUNT(*) as cnt FROM remote_backup_settings")
        count = c.fetchone()["cnt"]
        
        enc_pass = encrypt_password(settings.get("password") or "")
        
        if count == 0:
            c.execute("""
                INSERT INTO remote_backup_settings (
                    protocol, host, port, username, password, path, is_active, backup_db, backup_config
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                settings.get("protocol", "sftp"),
                settings.get("host", ""),
                int(settings.get("port", 22)),
                settings.get("username", ""),
                enc_pass,
                settings.get("path", ""),
                int(settings.get("is_active", 0)),
                int(settings.get("backup_db", 0)),
                int(settings.get("backup_config", 0))
            ))
        else:
            c.execute("""
                UPDATE remote_backup_settings SET
                    protocol = ?, host = ?, port = ?, username = ?, password = ?, path = ?, 
                    is_active = ?, backup_db = ?, backup_config = ?
            """)
            # Wait, let's make sure we update all rows or the first row
            # Since there is only ever 1 settings row, updating all is fine
            c.execute("""
                UPDATE remote_backup_settings SET
                    protocol = ?, host = ?, port = ?, username = ?, password = ?, path = ?, 
                    is_active = ?, backup_db = ?, backup_config = ?
            """, (
                settings.get("protocol", "sftp"),
                settings.get("host", ""),
                int(settings.get("port", 22)),
                settings.get("username", ""),
                enc_pass,
                settings.get("path", ""),
                int(settings.get("is_active", 0)),
                int(settings.get("backup_db", 0)),
                int(settings.get("backup_config", 0))
            ))
            
        conn.commit()
        conn.close()

    @staticmethod
    def test_connection(settings: dict) -> dict:
        """Test connection to the remote backup destination."""
        protocol = settings.get("protocol", "sftp").lower()
        host = settings.get("host", "")
        port = int(settings.get("port", 22))
        username = settings.get("username", "")
        password = settings.get("password", "")
        path = settings.get("path", "")
        
        if not host or not username:
            return {"success": False, "message": "Host dan Username harus diisi."}
            
        try:
            if protocol == "ftp":
                ftp = ftplib.FTP()
                ftp.connect(host, port, timeout=5)
                ftp.login(username, password)
                if path:
                    ftp.cwd(path)
                ftp.quit()
                return {"success": True, "message": "Koneksi FTP berhasil!"}
                
            elif protocol == "sftp":
                transport = paramiko.Transport((host, port))
                transport.connect(username=username, password=password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                if path:
                    sftp.chdir(path)
                sftp.close()
                transport.close()
                return {"success": True, "message": "Koneksi SFTP berhasil!"}
                
            elif protocol == "scp":
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(host, port, username, password, timeout=5)
                scp = SCPClient(ssh.get_transport())
                # SCP doesn't have directory change operation like SFTP, but we can verify SSH works
                scp.close()
                ssh.close()
                return {"success": True, "message": "Koneksi SCP/SSH berhasil!"}
                
            else:
                return {"success": False, "message": f"Protokol tidak dikenal: {protocol}"}
                
        except Exception as e:
            return {"success": False, "message": f"Koneksi gagal: {str(e)}"}

    @staticmethod
    def upload_file(local_path: str, remote_filename: str) -> bool:
        """Upload a local file to the active remote backup destination if active."""
        settings = RemoteBackupService.get_settings()
        if not settings.get("is_active") or not settings.get("backup_db"):
            return False
            
        protocol = settings.get("protocol", "sftp").lower()
        host = settings.get("host", "")
        port = int(settings.get("port", 22))
        username = settings.get("username", "")
        password = settings.get("password", "")
        base_path = settings.get("path", "")
        
        if not host or not username:
            logger.warning("Remote backup is active but host or username is not set.")
            return False
            
        remote_path = remote_filename
        if base_path:
            # Clean remote path joining
            remote_path = f"{base_path.rstrip('/')}/{remote_filename}"
            
        logger.info(f"Uploading file {local_path} to remote destination via {protocol}...")
        try:
            if protocol == "ftp":
                ftp = ftplib.FTP()
                ftp.connect(host, port, timeout=10)
                ftp.login(username, password)
                with open(local_path, "rb") as f:
                    ftp.storbinary(f"STOR {remote_path}", f)
                ftp.quit()
                logger.info("FTP upload successful.")
                return True
                
            elif protocol == "sftp":
                transport = paramiko.Transport((host, port))
                transport.connect(username=username, password=password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                sftp.put(local_path, remote_path)
                sftp.close()
                transport.close()
                logger.info("SFTP upload successful.")
                return True
                
            elif protocol == "scp":
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(host, port, username, password, timeout=10)
                with SCPClient(ssh.get_transport()) as scp:
                    scp.put(local_path, remote_path)
                ssh.close()
                logger.info("SCP upload successful.")
                return True
                
        except Exception as e:
            logger.error(f"Remote upload failed: {e}")
            return False
            
        return False

    @staticmethod
    def upload_config(device_name: str, config_content: str, version: int) -> bool:
        """Upload a configuration backup string to the remote destination if active."""
        settings = RemoteBackupService.get_settings()
        if not settings.get("is_active") or not settings.get("backup_config"):
            return False
            
        protocol = settings.get("protocol", "sftp").lower()
        host = settings.get("host", "")
        port = int(settings.get("port", 22))
        username = settings.get("username", "")
        password = settings.get("password", "")
        base_path = settings.get("path", "")
        
        if not host or not username:
            return False
            
        safe_dev_name = device_name.replace(" ", "_").replace("/", "_")
        remote_filename = f"config_{safe_dev_name}_v{version}.txt"
        
        remote_path = remote_filename
        if base_path:
            remote_path = f"{base_path.rstrip('/')}/{remote_filename}"
            
        logger.info(f"Uploading config for device {device_name} (v{version}) via {protocol}...")
        try:
            if protocol == "ftp":
                ftp = ftplib.FTP()
                ftp.connect(host, port, timeout=10)
                ftp.login(username, password)
                bio = io.BytesIO(config_content.encode("utf-8"))
                ftp.storbinary(f"STOR {remote_path}", bio)
                ftp.quit()
                logger.info("FTP config upload successful.")
                return True
                
            elif protocol == "sftp":
                transport = paramiko.Transport((host, port))
                transport.connect(username=username, password=password)
                sftp = paramiko.SFTPClient.from_transport(transport)
                with sftp.open(remote_path, "w") as f:
                    f.write(config_content)
                sftp.close()
                transport.close()
                logger.info("SFTP config upload successful.")
                return True
                
            elif protocol == "scp":
                # SCP requires a local file, we write to a temporary file
                with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as tf:
                    tf.write(config_content)
                    temp_path = tf.name
                try:
                    ssh = paramiko.SSHClient()
                    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    ssh.connect(host, port, username, password, timeout=10)
                    with SCPClient(ssh.get_transport()) as scp:
                        scp.put(temp_path, remote_path)
                    ssh.close()
                    logger.info("SCP config upload successful.")
                finally:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                return True
                
        except Exception as e:
            logger.error(f"Remote config upload failed for {device_name}: {e}")
            return False
            
        return False
