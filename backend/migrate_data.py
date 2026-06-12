"""
NetX Database Migration Script
Migrates data from SQLite (data/netx.db) to PostgreSQL database.
"""
import os
import sys
import sqlite3
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend directory is in path
BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

# Load configuration
load_dotenv(dotenv_path=BACKEND_DIR / ".env")

SQLITE_DB_PATH = BACKEND_DIR / "data" / "netx.db"

# Check dependencies
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[-] Eror: Library psycopg2 belum terinstal. Silakan jalankan: pip install psycopg2-binary")
    sys.exit(1)

# Order of tables to migrate (respecting foreign key dependencies)
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

def migrate():
    if not SQLITE_DB_PATH.exists():
        print(f"[-] Database SQLite tidak ditemukan di {SQLITE_DB_PATH}")
        sys.exit(1)

    print("[*] Memulai migrasi database dari SQLite ke PostgreSQL...")
    print(f"[*] SQLite file: {SQLITE_DB_PATH}")

    # Read PG Credentials from environment variables
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
        sys.exit(1)

    # Disable constraints temporarily for clean migration or do sequential inserts
    sqlite_conn = sqlite3.connect(str(SQLITE_DB_PATH))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()

    try:
        # Initialize PostgreSQL tables schema first
        print("[*] Menginisialisasi skema tabel di PostgreSQL...")
        os.environ["DB_ENGINE"] = "postgresql"
        import app.database
        app.database.DB_ENGINE = "postgresql"
        if app.database.PG_POOL is None:
            try:
                from psycopg2.pool import ThreadedConnectionPool
                app.database.PG_POOL = ThreadedConnectionPool(
                    minconn=1,
                    maxconn=30,
                    host=os.environ.get("DB_HOST", "localhost"),
                    port=int(os.environ.get("DB_PORT", "5432")),
                    database=os.environ.get("DB_NAME", "netx"),
                    user=os.environ.get("DB_USER", "postgres"),
                    password=os.environ.get("DB_PASSWORD", ""),
                    sslmode=os.environ.get("DB_SSL_MODE", "prefer"),
                )
            except Exception as e:
                print(f"[-] Gagal inisialisasi pool PostgreSQL dinamis: {e}")
        app.database.init_db()

        # Cache valid IDs for Foreign Key sanitization
        valid_user_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM users").fetchall()}
        valid_group_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_groups").fetchall()}
        valid_credential_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM device_credentials").fetchall()}
        valid_device_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM devices").fetchall()}
        valid_pattern_hashes = {r["pattern_hash"] for r in sqlite_cursor.execute("SELECT pattern_hash FROM syslog_patterns").fetchall()}
        valid_mib_ids = {r["id"] for r in sqlite_cursor.execute("SELECT id FROM snmp_mibs").fetchall()}

        # Run migration table by table
        for table in TABLES_ORDER:
            print(f"[*] Memproses tabel: {table}...")
            
            # Get table count in SQLite
            sqlite_cursor.execute(f"SELECT COUNT(*) as count FROM [{table}]")
            total_rows = sqlite_cursor.fetchone()["count"]
            if total_rows == 0:
                print(f"    [~] Tabel {table} kosong. Skip.")
                continue

            # Fetch all rows from SQLite
            sqlite_cursor.execute(f"SELECT * FROM [{table}]")
            rows = sqlite_cursor.fetchall()
            
            # Prepare PostgreSQL insert query
            columns = rows[0].keys()
            
            # Format columns and values placeholder
            cols_str = ", ".join([f'"{c}"' for c in columns])
            placeholders = ", ".join(["%s"] * len(columns))
            
            # Build query
            insert_query = f'INSERT INTO "{table}" ({cols_str}) VALUES ({placeholders})'
            
            # For primary key sequence tracking in PostgreSQL (SERIAL columns)
            has_id = "id" in columns

            # Execute batch insert in PostgreSQL
            # We can use execute_batch or execute loop
            # RealDictRow is converted to tuple in column order
            inserted_count = 0
            for row in rows:
                row_dict = dict(row)
                
                # Sanitize Foreign Keys to prevent Postgres violations on orphaned SQLite records
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

            # Update serial sequence value in PostgreSQL so it starts after the migrated IDs
            if has_id:
                try:
                    seq_query = f"SELECT setval(pg_get_serial_sequence('\"{table}\"', 'id'), COALESCE(MAX(id), 1)) FROM \"{table}\";"
                    pg_cursor.execute(seq_query)
                except Exception as seq_err:
                    # Some tables might not use default sequence name or have complex structure, ignore sequence warning
                    pass

        # Commit everything
        pg_conn.commit()
        print("[+] Migrasi data berhasil diselesaikan!")
        print("[*] Anda sekarang dapat mengaktifkan PostgreSQL di menu integrasi dan me-restart server.")

    except Exception as e:
        pg_conn.rollback()
        print(f"[-] Terjadi kesalahan saat migrasi: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
