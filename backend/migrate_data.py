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
    "users",
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
    "device_syslogs"
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
        from app.database import init_db
        # We temporarily force DB_ENGINE to postgresql for init_db to create PostgreSQL tables
        os.environ["DB_ENGINE"] = "postgresql"
        init_db()

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
            data_to_insert = []
            for row in rows:
                row_data = tuple(row[c] for c in columns)
                data_to_insert = row_data
                pg_cursor.execute(insert_query, row_data)

            print(f"    [+] Berhasil menyalin {len(rows)} baris ke tabel {table}.")

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
