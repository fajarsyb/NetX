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
        from app.database import DB_ENGINE, get_db_conn
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_name = f"netx_backup_{timestamp}.zip"
        zip_path = os.path.join(BACKUP_DIR, zip_name)
        
        temp_db_path = os.path.join(BACKUP_DIR, "temp_netx.db")
        
        # 1. Initialize temporary SQLite DB with NetX schema
        import app.database
        old_engine = app.database.DB_ENGINE
        old_path = app.database.DB_PATH
        try:
            app.database.DB_ENGINE = "sqlite"
            app.database.DB_PATH = temp_db_path
            app.database.init_db()
        finally:
            app.database.DB_ENGINE = old_engine
            app.database.DB_PATH = old_path
            
        # 2. Populate data based on current DB Engine
        if DB_ENGINE == "postgresql":
            pg_conn = get_db_conn()
            pg_cursor = pg_conn.cursor()
            
            sqlite_conn = sqlite3.connect(temp_db_path)
            sqlite_conn.execute("PRAGMA foreign_keys = OFF;")
            sqlite_cursor = sqlite_conn.cursor()
            
            TABLES_ORDER = [
                "device_groups",
                "device_credentials",
                "threshold_profiles",
                "users",
                "audit_logs",
                "devices",
                "arp_cache",
                "arp_history",
                "lldp_neighbors",
                "cdp_neighbors",
                "routing_table",
                "mac_addresses",
                "topology_positions",
                "device_config_backups",
                "device_backup_schedules",
                "network_history",
                "snmp_mibs",
                "snmp_mib_objects",
                "device_snmp_objects",
                "network_anomalies",
                "interface_stats_latest",
                "mac_history_tracking",
                "device_credential_compliance",
                "syslog_patterns",
                "device_syslogs",
                "device_l2_spanning_tree",
                "device_l2_stp_ports",
                "device_l2_vlans",
                "device_l2_interfaces",
                "device_l2_port_security",
                "device_l2_macs",
                "device_l2_timeline",
                "device_l2_port_lifecycle"
            ]
            
            for table in TABLES_ORDER:
                try:
                    pg_cursor.execute(f'SELECT * FROM "{table}"')
                    rows = pg_cursor.fetchall()
                except Exception:
                    continue
                
                # Clear any default seeded rows from the temporary SQLite table
                try:
                    sqlite_cursor.execute(f'DELETE FROM "{table}"')
                except Exception:
                    pass

                if not rows:
                    continue
                    
                columns = rows[0].keys()
                cols_str = ", ".join([f'"{c}"' for c in columns])
                placeholders = ", ".join(["?"] * len(columns))
                insert_query = f'INSERT INTO "{table}" ({cols_str}) VALUES ({placeholders})'
                
                for row in rows:
                    row_dict = dict(row)
                    row_data = tuple(row_dict[c] for c in columns)
                    sqlite_cursor.execute(insert_query, row_data)
                    
            sqlite_conn.commit()
            sqlite_conn.close()
            pg_conn.close()
        else:
            # SQLite fast backup
            src_conn = sqlite3.connect("data/netx.db")
            dest_conn = sqlite3.connect(temp_db_path)
            with dest_conn:
                src_conn.backup(dest_conn)
            dest_conn.close()
            src_conn.close()
            
        # 3. Compress both db and key
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(temp_db_path, "netx.db")
            if os.path.exists("data/secret.key"):
                zipf.write("data/secret.key", "secret.key")
                
        # 4. Clean temp db
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
            
        # 5. Remote Backup Upload if active
        from app.services.remote_backup_service import RemoteBackupService
        uploaded = RemoteBackupService.upload_file(zip_path, zip_name)
        remote_msg = " dan diunggah ke server remote" if uploaded else ""
        
        log_audit(admin["id"], admin["username"], "CREATE_BACKUP", f"backups/{zip_name}", f"Backup created successfully: {zip_name}{remote_msg}")
        return {"success": True, "filename": zip_name, "message": f"Pencadangan berhasil{remote_msg}."}
        
    except Exception as e:
        if os.path.exists(temp_db_path):
            try:
                os.remove(temp_db_path)
            except Exception:
                pass
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
            
        # 2. Restore Database based on DB Engine
        from app.database import DB_ENGINE
        if DB_ENGINE == "postgresql":
            import psycopg2
            
            # Read PG Credentials from environment variables
            pg_host = os.environ.get("DB_HOST", "localhost")
            pg_port = int(os.environ.get("DB_PORT", "5432"))
            pg_name = os.environ.get("DB_NAME", "netx")
            pg_user = os.environ.get("DB_USER", "postgres")
            pg_pass = os.environ.get("DB_PASSWORD", "")
            pg_ssl = os.environ.get("DB_SSL_MODE", "prefer")
            
            try:
                pg_conn = psycopg2.connect(
                    host=pg_host,
                    port=pg_port,
                    dbname=pg_name,
                    user=pg_user,
                    password=pg_pass,
                    sslmode=pg_ssl
                )
                pg_cursor = pg_conn.cursor()
            except Exception as e:
                shutil.rmtree(temp_extract_dir)
                raise HTTPException(status_code=500, detail=f"Gagal menghubungkan ke PostgreSQL untuk pemulihan: {str(e)}")
                
            sqlite_conn = sqlite3.connect(restored_db)
            sqlite_conn.row_factory = sqlite3.Row
            sqlite_cursor = sqlite_conn.cursor()
            
            TABLES_ORDER = [
                "device_groups",
                "device_credentials",
                "threshold_profiles",
                "users",
                "audit_logs",
                "devices",
                "arp_cache",
                "arp_history",
                "lldp_neighbors",
                "cdp_neighbors",
                "routing_table",
                "mac_addresses",
                "topology_positions",
                "device_config_backups",
                "device_backup_schedules",
                "network_history",
                "snmp_mibs",
                "snmp_mib_objects",
                "device_snmp_objects",
                "network_anomalies",
                "interface_stats_latest",
                "mac_history_tracking",
                "device_credential_compliance",
                "syslog_patterns",
                "device_syslogs",
                "device_l2_spanning_tree",
                "device_l2_stp_ports",
                "device_l2_vlans",
                "device_l2_interfaces",
                "device_l2_port_security",
                "device_l2_macs",
                "device_l2_timeline",
                "device_l2_port_lifecycle"
            ]
            
            try:
                # 2a. Truncate all tables CASCADE
                tables_quoted = [f'"{t}"' for t in TABLES_ORDER]
                truncate_query = f"TRUNCATE TABLE {', '.join(tables_quoted)} CASCADE;"
                pg_cursor.execute(truncate_query)
                
                # 2b. Cache valid IDs for Foreign Key sanitization
                valid_user_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM users").fetchall()}
                valid_group_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_groups").fetchall()}
                valid_credential_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_credentials").fetchall()}
                valid_device_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM devices").fetchall()}
                
                try:
                    valid_pattern_hashes = {r["pattern_hash"] for r in sqlite_cursor.execute("SELECT pattern_hash FROM syslog_patterns").fetchall()}
                except Exception:
                    valid_pattern_hashes = set()
                    
                try:
                    valid_mib_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM snmp_mibs").fetchall()}
                except Exception:
                    valid_mib_ids = set()
                    
                # 2c. Copy tables in sequence
                for table in TABLES_ORDER:
                    # Check SQLite table existence
                    sqlite_cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", (table,))
                    if sqlite_cursor.fetchone()[0] == 0:
                        continue
                        
                    sqlite_cursor.execute(f"SELECT COUNT(*) as count FROM [{table}]")
                    total_rows = sqlite_cursor.fetchone()["count"]
                    if total_rows == 0:
                        continue
                        
                    sqlite_cursor.execute(f"SELECT * FROM [{table}]")
                    rows = sqlite_cursor.fetchall()
                    
                    columns = rows[0].keys()
                    cols_str = ", ".join([f'"{c}"' for c in columns])
                    placeholders = ", ".join(["%s"] * len(columns))
                    insert_query = f'INSERT INTO "{table}" ({cols_str}) VALUES ({placeholders})'
                    has_id = "id" in columns
                    
                    for row in rows:
                        row_dict = dict(row)
                        
                        # Sanitize Foreign Keys
                        if table == "audit_logs":
                            if row_dict.get("user_id") not in valid_user_ids:
                                row_dict["user_id"] = None
                        elif table == "devices":
                            if row_dict.get("group_id") not in valid_group_ids:
                                row_dict["group_id"] = None
                            if row_dict.get("credential_id") not in valid_credential_ids:
                                row_dict["credential_id"] = None
                        elif table in [
                            "arp_cache", "arp_history", "lldp_neighbors", "cdp_neighbors", 
                            "routing_table", "mac_addresses", "device_config_backups", 
                            "device_snmp_objects", "network_anomalies", "interface_stats_latest", 
                            "mac_history_tracking", "device_credential_compliance",
                            "device_l2_spanning_tree", "device_l2_stp_ports", "device_l2_vlans", 
                            "device_l2_interfaces", "device_l2_port_security", "device_l2_macs", 
                            "device_l2_timeline", "device_l2_port_lifecycle"
                        ]:
                            if row_dict.get("device_id") not in valid_device_ids:
                                continue
                        elif table == "device_syslogs":
                            if row_dict.get("device_id") not in valid_device_ids:
                                row_dict["device_id"] = None
                            if row_dict.get("pattern_hash") not in valid_pattern_hashes:
                                row_dict["pattern_hash"] = None
                        elif table == "snmp_mib_objects":
                            if row_dict.get("mib_id") not in valid_mib_ids:
                                continue
                                
                        row_data = tuple(row_dict[c] for c in columns)
                        pg_cursor.execute(insert_query, row_data)
                        
                    if has_id:
                        try:
                            seq_query = f"SELECT setval(pg_get_serial_sequence('\"{table}\"', 'id'), COALESCE(MAX(id), 1)) FROM \"{table}\";"
                            pg_cursor.execute(seq_query)
                        except Exception:
                            pass
                            
                pg_conn.commit()
            except Exception as err:
                pg_conn.rollback()
                raise HTTPException(status_code=500, detail=f"Gagal memindahkan data ke PostgreSQL: {str(err)}")
            finally:
                sqlite_conn.close()
                pg_conn.close()
        else:
            # 2d. Restore Database in-place via backup API (SQLite)
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
