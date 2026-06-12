"""
NetX PostgreSQL Database Restore Script
Restores database from the latest SQLite backup zip (or specific zip/db) to PostgreSQL.
"""
import os
import sys
import zipfile
import sqlite3
import shutil
import tempfile
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

# Load environment configuration
load_dotenv(dotenv_path=BACKEND_DIR / ".env")

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[-] Error: Library psycopg2 belum terinstal. Silakan jalankan: pip install psycopg2-binary")
    sys.exit(1)

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

def find_latest_backup():
    backup_dir = BACKEND_DIR / "data" / "backups"
    if not backup_dir.exists():
        return None
    
    zip_files = []
    for f in os.listdir(backup_dir):
        if f.endswith(".zip") and f.startswith("netx_backup_"):
            zip_files.append(backup_dir / f)
            
    if not zip_files:
        return None
        
    # Sort lexicographically / chronologically
    zip_files.sort()
    return zip_files[-1]

def perform_restore(sqlite_db_path, secret_key_path=None):
    pg_host = os.environ.get("DB_HOST", "localhost")
    pg_port = int(os.environ.get("DB_PORT", "5432"))
    pg_name = os.environ.get("DB_NAME", "netx")
    pg_user = os.environ.get("DB_USER", "postgres")
    pg_pass = os.environ.get("DB_PASSWORD", "")
    pg_ssl = os.environ.get("DB_SSL_MODE", "prefer")

    print(f"[*] Menghubungkan ke PostgreSQL: postgresql://{pg_user}@{pg_host}:{pg_port}/{pg_name}")
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
        print(f"[-] Gagal menghubungkan ke PostgreSQL: {e}")
        return False

    sqlite_conn = sqlite3.connect(str(sqlite_db_path))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()

    try:
        # 1. Truncate all tables CASCADE
        print("[*] Melakukan pembersihan data di PostgreSQL (TRUNCATE CASCADE)...")
        tables_quoted = [f'"{t}"' for t in TABLES_ORDER]
        truncate_query = f"TRUNCATE TABLE {', '.join(tables_quoted)} CASCADE;"
        pg_cursor.execute(truncate_query)
        print("[+] Semua tabel PostgreSQL berhasil dibersihkan.")

        # 2. Cache valid IDs for Foreign Key sanitization
        valid_user_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM users").fetchall()}
        valid_group_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_groups").fetchall()}
        valid_credential_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_credentials").fetchall()}
        valid_device_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM devices").fetchall()}
        valid_pattern_hashes = {r["pattern_hash"] for r in sqlite_cursor.execute("SELECT pattern_hash FROM syslog_patterns").fetchall()}
        valid_mib_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM snmp_mibs").fetchall()}

        # 3. Copy table by table
        for table in TABLES_ORDER:
            # Check SQLite table existence
            sqlite_cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", (table,))
            if sqlite_cursor.fetchone()[0] == 0:
                print(f"[~] Tabel {table} tidak ada di SQLite. Skip.")
                continue

            sqlite_cursor.execute(f"SELECT COUNT(*) as count FROM [{table}]")
            total_rows = sqlite_cursor.fetchone()["count"]
            if total_rows == 0:
                print(f"[~] Tabel {table} kosong di SQLite. Skip.")
                continue

            print(f"[*] Memulihkan tabel {table} ({total_rows} baris)...")
            sqlite_cursor.execute(f"SELECT * FROM [{table}]")
            rows = sqlite_cursor.fetchall()

            columns = rows[0].keys()
            cols_str = ", ".join([f'"{c}"' for c in columns])
            placeholders = ", ".join(["%s"] * len(columns))
            insert_query = f'INSERT INTO "{table}" ({cols_str}) VALUES ({placeholders})'
            has_id = "id" in columns

            inserted_count = 0
            for row in rows:
                row_dict = dict(row)
                
                # Sanitize Foreign Keys to prevent violations
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
                inserted_count += 1

            print(f"    [+] Berhasil menyalin {inserted_count} baris ke tabel {table}.")

            # Update serial sequence value in PostgreSQL (SERIAL columns)
            if has_id:
                try:
                    seq_query = f"SELECT setval(pg_get_serial_sequence('\"{table}\"', 'id'), COALESCE(MAX(id), 1)) FROM \"{table}\";"
                    pg_cursor.execute(seq_query)
                except Exception:
                    pass

        pg_conn.commit()
        
        # 4. Restore secret key if provided
        if secret_key_path and os.path.exists(secret_key_path):
            dest_key = BACKEND_DIR / "data" / "secret.key"
            print(f"[*] Menyalin secret.key dari cadangan ke {dest_key}")
            shutil.copy2(secret_key_path, dest_key)

        print("[+] Pemulihan basis data PostgreSQL berhasil diselesaikan!")
        return True

    except Exception as e:
        pg_conn.rollback()
        print(f"[-] Terjadi kesalahan saat pemulihan: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        sqlite_conn.close()
        pg_conn.close()

def main():
    print("=== NETX POSTGRESQL RESTORE SCRIPT ===")
    
    # 1. Determine backup zip file
    backup_file = None
    if len(sys.argv) > 1:
        backup_file = Path(sys.argv[1])
    else:
        print("[*] Mencari file cadangan terbaru...")
        backup_file = find_latest_backup()
        
    if not backup_file or not backup_file.exists():
        print("[-] File cadangan tidak ditemukan.")
        # Fallback to direct data/netx.db
        fallback_db = BACKEND_DIR / "data" / "netx.db"
        if fallback_db.exists():
            print(f"[*] Menggunakan file database SQLite aktif langsung: {fallback_db}")
            perform_restore(fallback_db)
        else:
            print("[-] Tidak ada database SQLite aktif maupun file cadangan zip.")
            sys.exit(1)
        return

    print(f"[+] Menggunakan file cadangan: {backup_file}")
    
    # 2. Extract backup zip to a temporary folder
    with tempfile.TemporaryDirectory() as tempdir:
        temp_dir_path = Path(tempdir)
        print(f"[*] Mengekstrak arsip cadangan ke folder temporer...")
        try:
            with zipfile.ZipFile(backup_file, 'r') as zipf:
                zipf.extractall(temp_dir_path)
        except Exception as e:
            print(f"[-] Gagal mengekstrak file zip: {e}")
            sys.exit(1)
            
        restored_db = temp_dir_path / "netx.db"
        restored_key = temp_dir_path / "secret.key"
        
        if not restored_db.exists():
            print("[-] File cadangan rusak: netx.db tidak ditemukan di dalam arsip.")
            sys.exit(1)
            
        # 3. Perform restoration
        success = perform_restore(restored_db, restored_key if restored_key.exists() else None)
        if not success:
            sys.exit(1)

if __name__ == "__main__":
    main()
