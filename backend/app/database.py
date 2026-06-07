import os
import sqlite3
from datetime import datetime
from cryptography.fernet import Fernet

DB_DIR = "data"
DB_PATH = os.path.join(DB_DIR, "netx.db")
KEY_PATH = os.path.join(DB_DIR, "secret.key")

os.makedirs(DB_DIR, exist_ok=True)


# ─── CREDENTIAL ENCRYPTION ──────────────────────────────────────────────────
def _get_or_create_key() -> bytes:
    if not os.path.exists(KEY_PATH):
        key = Fernet.generate_key()
        with open(KEY_PATH, "wb") as f:
            f.write(key)
        return key
    with open(KEY_PATH, "rb") as f:
        return f.read()


CIPHER = Fernet(_get_or_create_key())


def encrypt_password(password: str) -> str:
    if not password:
        return ""
    return CIPHER.encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_password(enc: str) -> str:
    if not enc:
        return ""
    try:
        return CIPHER.decrypt(enc.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


# Load environment variables from .env file if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DB_ENGINE = os.environ.get("DB_ENGINE", "sqlite").lower()
PG_POOL = None


# Dict-like Row class that supports string keys and integer index access
class DictLikeRow(dict):
    def __init__(self, items):
        super().__init__(items)
        self._keys = list(self.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            if 0 <= key < len(self._keys):
                return super().__getitem__(self._keys[key])
            raise IndexError(f"Index {key} out of range")
        return super().__getitem__(key)


# Custom cursor wrapper for psycopg2 cursor to handle sqlite syntax conversions and track latency
class PostgreSQLCursorWrapper:
    def __init__(self, real_cursor):
        self.real_cursor = real_cursor
        self._lastrowid = None

    def execute(self, query, vars=None):
        if not query:
            return self.real_cursor.execute(query, vars)
        
        # 1. Convert ? placeholder to %s placeholder
        if "?" in query:
            query = query.replace("?", "%s")

        # 2. Convert COLLATE NOCASE to standard sorting
        if "COLLATE NOCASE" in query:
            query = query.replace("COLLATE NOCASE", "")

        # 3. Convert LIKE to case-insensitive ILIKE in PostgreSQL
        if " LIKE " in query.upper():
            parts = query.split()
            for i, part in enumerate(parts):
                if part.upper() == "LIKE":
                    parts[i] = "ILIKE"
            query = " ".join(parts)

        # 4. Rewrite specific INSERT OR REPLACE to PostgreSQL UPSERT format
        if "INSERT OR REPLACE INTO interface_stats_latest" in query:
            query = """
                INSERT INTO interface_stats_latest (
                    device_id, interface_name, in_broadcast, out_broadcast,
                    in_multicast, out_multicast, in_unicast, out_unicast,
                    oper_status, stp_top_changes, status_changes_history, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (device_id, interface_name) DO UPDATE SET
                    in_broadcast = EXCLUDED.in_broadcast,
                    out_broadcast = EXCLUDED.out_broadcast,
                    in_multicast = EXCLUDED.in_multicast,
                    out_multicast = EXCLUDED.out_multicast,
                    in_unicast = EXCLUDED.in_unicast,
                    out_unicast = EXCLUDED.out_unicast,
                    oper_status = EXCLUDED.oper_status,
                    stp_top_changes = EXCLUDED.stp_top_changes,
                    status_changes_history = EXCLUDED.status_changes_history,
                    updated_at = EXCLUDED.updated_at
            """

        import time as pytime
        from app.services.health_monitor import monitor
        t0 = pytime.perf_counter()
        try:
            res = self.real_cursor.execute(query, vars)
        finally:
            duration = pytime.perf_counter() - t0
            monitor.record_db_latency(duration)

        # 5. Simulate lastrowid for psycopg2 using lastval() if it's an INSERT
        is_insert = query.strip().upper().startswith("INSERT")
        if is_insert:
            try:
                temp_c = self.real_cursor.connection.cursor()
                temp_c.execute("SELECT lastval();")
                self._lastrowid = temp_c.fetchone()[0]
                temp_c.close()
            except Exception:
                self._lastrowid = None
        else:
            self._lastrowid = None

        return res

    def executemany(self, query, vars_list):
        if query and "?" in query:
            query = query.replace("?", "%s")
        import time as pytime
        from app.services.health_monitor import monitor
        t0 = pytime.perf_counter()
        try:
            return self.real_cursor.executemany(query, vars_list)
        finally:
            duration = pytime.perf_counter() - t0
            monitor.record_db_latency(duration)

    @property
    def lastrowid(self):
        return self._lastrowid

    def fetchone(self):
        val = self.real_cursor.fetchone()
        return DictLikeRow(val) if val is not None else None

    def fetchall(self):
        vals = self.real_cursor.fetchall()
        return [DictLikeRow(v) for v in vals] if vals is not None else []

    def fetchmany(self, size):
        vals = self.real_cursor.fetchmany(size)
        return [DictLikeRow(v) for v in vals] if vals is not None else []

    @property
    def rowcount(self):
        return self.real_cursor.rowcount

    def __getattr__(self, name):
        return getattr(self.real_cursor, name)


class PostgreSQLConnectionWrapper:
    def __init__(self, real_conn):
        self.real_conn = real_conn

    def cursor(self, *args, **kwargs):
        import psycopg2.extras
        if "cursor_factory" not in kwargs:
            kwargs["cursor_factory"] = psycopg2.extras.RealDictCursor
        real_cur = self.real_conn.cursor(*args, **kwargs)
        return PostgreSQLCursorWrapper(real_cur)

    def commit(self):
        return self.real_conn.commit()

    def rollback(self):
        return self.real_conn.rollback()

    def close(self):
        if PG_POOL is not None:
            PG_POOL.putconn(self.real_conn)

    def execute(self, query, vars=None):
        cur = self.cursor()
        cur.execute(query, vars)
        return cur

    def __getattr__(self, name):
        return getattr(self.real_conn, name)


# SQLite Wrappers for Query Latency Diagnostics
class SQLiteCursorWrapper:
    def __init__(self, real_cursor):
        self.real_cursor = real_cursor

    def execute(self, query, vars=None):
        import time as pytime
        from app.services.health_monitor import monitor
        t0 = pytime.perf_counter()
        try:
            if vars is not None:
                return self.real_cursor.execute(query, vars)
            return self.real_cursor.execute(query)
        finally:
            duration = pytime.perf_counter() - t0
            monitor.record_db_latency(duration)

    def executemany(self, query, vars_list):
        import time as pytime
        from app.services.health_monitor import monitor
        t0 = pytime.perf_counter()
        try:
            return self.real_cursor.executemany(query, vars_list)
        finally:
            duration = pytime.perf_counter() - t0
            monitor.record_db_latency(duration)

    def __getattr__(self, name):
        return getattr(self.real_cursor, name)


class SQLiteConnectionWrapper:
    def __init__(self, real_conn):
        self.real_conn = real_conn

    def cursor(self, *args, **kwargs):
        real_cur = self.real_conn.cursor(*args, **kwargs)
        return SQLiteCursorWrapper(real_cur)

    def commit(self):
        return self.real_conn.commit()

    def rollback(self):
        return self.real_conn.rollback()

    def close(self):
        return self.real_conn.close()

    def execute(self, query, vars=None):
        cur = self.cursor()
        if vars is not None:
            cur.execute(query, vars)
        else:
            cur.execute(query)
        return cur

    def __getattr__(self, name):
        return getattr(self.real_conn, name)


if DB_ENGINE == "postgresql":
    try:
        import psycopg2
        import psycopg2.extras
        from psycopg2.pool import ThreadedConnectionPool
        PG_POOL = ThreadedConnectionPool(
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
        import logging
        logging.getLogger("netx.database").error(f"Gagal inisialisasi pool PostgreSQL: {e}")


# ─── DATABASE CONNECTION ────────────────────────────────────────────────────
def get_db_conn():
    if DB_ENGINE == "postgresql" and PG_POOL is not None:
        try:
            conn = PG_POOL.getconn()
            return PostgreSQLConnectionWrapper(conn)
        except Exception as e:
            import logging
            logging.getLogger("netx.database").error(f"Gagal mengambil koneksi PostgreSQL: {e}")
            raise e
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        return SQLiteConnectionWrapper(conn)


# ─── SCHEMA INITIALIZATION ──────────────────────────────────────────────────
def init_db():
    conn = get_db_conn()
    c = conn.cursor()

    if DB_ENGINE == "postgresql":
        # ─── PostgreSQL DDL Schemas ───
        
        # Device Groups
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_groups (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            parent_id   INTEGER,
            created_at  VARCHAR(100) NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES device_groups(id) ON DELETE SET NULL
        );
        """)

        # Device Credentials
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_credentials (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL UNIQUE,
            username    VARCHAR(255) NOT NULL,
            password    TEXT NOT NULL,
            created_at  VARCHAR(100) NOT NULL
        );
        """)

        # Users
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          SERIAL PRIMARY KEY,
            username    VARCHAR(255) NOT NULL UNIQUE,
            password    TEXT NOT NULL,
            full_name   VARCHAR(255) DEFAULT '',
            role        VARCHAR(50) NOT NULL DEFAULT 'user',
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  VARCHAR(100) NOT NULL
        );
        """)

        # Audit Logs
        c.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER,
            username    VARCHAR(255) NOT NULL,
            action      TEXT NOT NULL,
            target      VARCHAR(255) NOT NULL,
            details     TEXT DEFAULT '',
            timestamp   VARCHAR(100) NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """)

        # Devices
        c.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL UNIQUE,
            ip          VARCHAR(100) NOT NULL UNIQUE,
            protocol    VARCHAR(50) NOT NULL DEFAULT 'ssh',
            port        INTEGER DEFAULT 22,
            username    VARCHAR(255) NOT NULL DEFAULT '',
            password    TEXT NOT NULL DEFAULT '',
            device_type VARCHAR(100) NOT NULL DEFAULT 'cisco_ios',
            description TEXT DEFAULT '',
            status      VARCHAR(50) DEFAULT 'unknown',
            last_seen   VARCHAR(100),
            group_id    INTEGER,
            created_at  VARCHAR(100) NOT NULL,
            custom_arp_cmd TEXT DEFAULT '',
            custom_lldp_cmd TEXT DEFAULT '',
            custom_cdp_cmd TEXT DEFAULT '',
            custom_routing_cmd TEXT DEFAULT '',
            snmp_version VARCHAR(50) DEFAULT 'v2c',
            snmp_community VARCHAR(255) DEFAULT 'public',
            os_version VARCHAR(255) DEFAULT '',
            serial_number VARCHAR(255) DEFAULT '',
            mac_address VARCHAR(255) DEFAULT '',
            hardware_model VARCHAR(255) DEFAULT '',
            credential_id INTEGER,
            custom_info_cmd TEXT DEFAULT '',
            raw_info TEXT DEFAULT '',
            device_role VARCHAR(100) DEFAULT 'Access Switch',
            FOREIGN KEY (group_id) REFERENCES device_groups(id) ON DELETE SET NULL,
            FOREIGN KEY (credential_id) REFERENCES device_credentials(id) ON DELETE SET NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id);")

        # ARP Cache
        c.execute("""
        CREATE TABLE IF NOT EXISTS arp_cache (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            ip_address      VARCHAR(100) NOT NULL,
            mac_address     VARCHAR(100) NOT NULL,
            interface       VARCHAR(100) DEFAULT '',
            entry_type      VARCHAR(50) DEFAULT 'dynamic',
            age_minutes     INTEGER DEFAULT 0,
            mac_vendor      VARCHAR(255) DEFAULT '',
            device_category VARCHAR(100) DEFAULT 'unknown',
            device_hint     TEXT DEFAULT '',
            fetched_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_arp_cache_device ON arp_cache(device_id);")

        # ARP History
        c.execute("""
        CREATE TABLE IF NOT EXISTS arp_history (
            id          SERIAL PRIMARY KEY,
            device_id   INTEGER NOT NULL,
            arp_count   INTEGER NOT NULL,
            fetched_at  VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # LLDP neighbors
        c.execute("""
        CREATE TABLE IF NOT EXISTS lldp_neighbors (
            id                SERIAL PRIMARY KEY,
            device_id         INTEGER NOT NULL,
            local_port        VARCHAR(100) NOT NULL DEFAULT '',
            neighbor_name     VARCHAR(255) DEFAULT '',
            neighbor_ip       VARCHAR(100) DEFAULT '',
            neighbor_mac      VARCHAR(100) DEFAULT '',
            neighbor_platform VARCHAR(255) DEFAULT '',
            neighbor_port     VARCHAR(100) DEFAULT '',
            neighbor_vendor   VARCHAR(255) DEFAULT '',
            device_category   VARCHAR(100) DEFAULT 'unknown',
            device_hint       TEXT DEFAULT '',
            fetched_at        VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_lldp_device ON lldp_neighbors(device_id);")

        # CDP Neighbors
        c.execute("""
        CREATE TABLE IF NOT EXISTS cdp_neighbors (
            id                SERIAL PRIMARY KEY,
            device_id         INTEGER NOT NULL,
            local_port        VARCHAR(100) NOT NULL DEFAULT '',
            neighbor_name     VARCHAR(255) DEFAULT '',
            neighbor_ip       VARCHAR(100) DEFAULT '',
            neighbor_platform VARCHAR(255) DEFAULT '',
            neighbor_port     VARCHAR(100) DEFAULT '',
            fetched_at        VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_cdp_device ON cdp_neighbors(device_id);")

        # Routing Table
        c.execute("""
        CREATE TABLE IF NOT EXISTS routing_table (
            id                SERIAL PRIMARY KEY,
            device_id         INTEGER NOT NULL,
            destination       VARCHAR(255) NOT NULL,
            gateway           VARCHAR(255) DEFAULT '',
            interface         VARCHAR(100) DEFAULT '',
            protocol          VARCHAR(100) DEFAULT '',
            metric            VARCHAR(50) DEFAULT '',
            fetched_at        VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_routing_device ON routing_table(device_id);")

        # MAC Addresses
        c.execute("""
        CREATE TABLE IF NOT EXISTS mac_addresses (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            vlan            VARCHAR(50) DEFAULT '',
            mac_address     VARCHAR(100) NOT NULL,
            entry_type      VARCHAR(50) DEFAULT 'dynamic',
            interface       VARCHAR(100) NOT NULL,
            mac_vendor      VARCHAR(255) DEFAULT '',
            fetched_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_mac_addresses_device ON mac_addresses(device_id);")

        # Topology Positions
        c.execute("""
        CREATE TABLE IF NOT EXISTS topology_positions (
            node_id VARCHAR(255) PRIMARY KEY,
            x REAL NOT NULL,
            y REAL NOT NULL
        );
        """)

        # Device Config Backups
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_config_backups (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            config_content  TEXT NOT NULL,
            version         INTEGER NOT NULL,
            status          VARCHAR(50) NOT NULL DEFAULT 'success',
            error_message   TEXT DEFAULT '',
            created_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_config_backups_device ON device_config_backups(device_id);")

        # Device Backup Schedules
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_backup_schedules (
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(255) NOT NULL,
            device_ids      TEXT NOT NULL,
            frequency       VARCHAR(50) NOT NULL,
            time            VARCHAR(50) DEFAULT '',
            day_of_week     INTEGER DEFAULT 0,
            is_active       INTEGER DEFAULT 1,
            last_run        VARCHAR(100) DEFAULT '',
            next_run        VARCHAR(100) NOT NULL,
            created_at      VARCHAR(100) NOT NULL
        );
        """)

        # Network History
        c.execute("""
        CREATE TABLE IF NOT EXISTS network_history (
            id              SERIAL PRIMARY KEY,
            arp_count       INTEGER NOT NULL,
            mac_count       INTEGER NOT NULL,
            fetched_at      VARCHAR(100) NOT NULL
        );
        """)

        # SNMP MIBs
        c.execute("""
        CREATE TABLE IF NOT EXISTS snmp_mibs (
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(255) NOT NULL UNIQUE,
            description     TEXT DEFAULT '',
            vendor          VARCHAR(100) DEFAULT 'all',
            is_active       INTEGER DEFAULT 1,
            created_at      VARCHAR(100) NOT NULL
        );
        """)

        # SNMP MIB Objects
        c.execute("""
        CREATE TABLE IF NOT EXISTS snmp_mib_objects (
            id              SERIAL PRIMARY KEY,
            mib_id          INTEGER NOT NULL,
            name            VARCHAR(255) NOT NULL,
            oid             VARCHAR(255) NOT NULL,
            syntax          VARCHAR(255) DEFAULT '',
            description     TEXT DEFAULT '',
            parent          VARCHAR(255) DEFAULT '',
            kind            VARCHAR(50) DEFAULT 'Single',
            is_unsigned     INTEGER DEFAULT 0,
            is_64bit        INTEGER DEFAULT 0,
            is_float        INTEGER DEFAULT 0,
            unit            VARCHAR(50) DEFAULT 'Custom',
            unit_custom     VARCHAR(100) DEFAULT '',
            indicator       VARCHAR(50) DEFAULT '',
            scale           REAL DEFAULT 1.0,
            scale_mode      VARCHAR(50) DEFAULT 'Divide',
            lookup          TEXT DEFAULT '',
            FOREIGN KEY (mib_id) REFERENCES snmp_mibs(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_snmp_mib_objects_mib ON snmp_mib_objects(mib_id);")

        # Device SNMP Objects
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_snmp_objects (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            mib_object_id   INTEGER NOT NULL,
            created_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
            FOREIGN KEY (mib_object_id) REFERENCES snmp_mib_objects(id) ON DELETE CASCADE,
            UNIQUE(device_id, mib_object_id)
        );
        """)

        # Network Anomalies
        c.execute("""
        CREATE TABLE IF NOT EXISTS network_anomalies (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            anomaly_type    VARCHAR(100) NOT NULL,
            severity        VARCHAR(50) NOT NULL,
            interface_name  VARCHAR(100) DEFAULT '',
            details         TEXT DEFAULT '',
            is_active       INTEGER DEFAULT 1,
            detected_at     VARCHAR(100) NOT NULL,
            resolved_at     VARCHAR(100),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_network_anomalies_device ON network_anomalies(device_id);")

        # Interface SNMP Stats
        c.execute("""
        CREATE TABLE IF NOT EXISTS interface_stats_latest (
            device_id       INTEGER NOT NULL,
            interface_name  VARCHAR(100) NOT NULL,
            in_broadcast    BIGINT DEFAULT 0,
            out_broadcast   BIGINT DEFAULT 0,
            in_multicast    BIGINT DEFAULT 0,
            out_multicast   BIGINT DEFAULT 0,
            in_unicast      BIGINT DEFAULT 0,
            out_unicast     BIGINT DEFAULT 0,
            oper_status     VARCHAR(50) DEFAULT 'unknown',
            stp_top_changes INTEGER DEFAULT 0,
            status_changes_history TEXT DEFAULT '[]',
            updated_at      VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # MAC Address History
        c.execute("""
        CREATE TABLE IF NOT EXISTS mac_history_tracking (
            mac_address     VARCHAR(100) PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            interface_name  VARCHAR(100) NOT NULL,
            vlan            VARCHAR(50) DEFAULT '',
            updated_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # Device Syslogs
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_syslogs (
            id              SERIAL PRIMARY KEY,
            device_id       INTEGER,
            sender_ip       VARCHAR(100) DEFAULT '',
            facility        INTEGER DEFAULT 1,
            severity        INTEGER DEFAULT 5,
            program         VARCHAR(255) DEFAULT '',
            message         TEXT NOT NULL,
            timestamp       VARCHAR(100) NOT NULL,
            raw_message     TEXT,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_syslogs_device ON device_syslogs(device_id);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_syslogs_time ON device_syslogs(timestamp);")

        # Create default admin user if none exists in PostgreSQL
        c.execute("SELECT COUNT(*) as cnt FROM users")
        row = c.fetchone()
        if row["cnt"] == 0:
            import bcrypt
            hashed = bcrypt.hashpw("netx@admin".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            c.execute(
                "INSERT INTO users (username, password, full_name, role, created_at) VALUES (%s, %s, %s, %s, %s)",
                ("admin", hashed, "Administrator", "admin", datetime.now().isoformat()),
            )

    else:
        # ─── SQLite DDL Schemas (Existing) ───

        # Device Groups
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_groups (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            parent_id   INTEGER,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES device_groups(id) ON DELETE SET NULL
        );
        """)

        # Device Credentials
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_credentials (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            username    TEXT NOT NULL,
            password    TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        """)

        # Audit Logs
        c.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER,
            username    TEXT NOT NULL,
            action      TEXT NOT NULL,
            target      TEXT NOT NULL,
            details     TEXT DEFAULT '',
            timestamp   TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """)

        # Devices
        c.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            ip          TEXT NOT NULL UNIQUE,
            protocol    TEXT NOT NULL DEFAULT 'ssh',
            port        INTEGER DEFAULT 22,
            username    TEXT NOT NULL DEFAULT '',
            password    TEXT NOT NULL DEFAULT '',
            device_type TEXT NOT NULL DEFAULT 'cisco_ios',
            description TEXT DEFAULT '',
            status      TEXT DEFAULT 'unknown',
            last_seen   TEXT,
            group_id    INTEGER,
            created_at  TEXT NOT NULL,
            custom_arp_cmd TEXT DEFAULT '',
            custom_lldp_cmd TEXT DEFAULT '',
            custom_cdp_cmd TEXT DEFAULT '',
            custom_routing_cmd TEXT DEFAULT '',
            snmp_version TEXT DEFAULT 'v2c',
            snmp_community TEXT DEFAULT 'public',
            os_version TEXT DEFAULT '',
            serial_number TEXT DEFAULT '',
            mac_address TEXT DEFAULT '',
            hardware_model TEXT DEFAULT '',
            credential_id INTEGER,
            custom_info_cmd TEXT DEFAULT '',
            raw_info TEXT DEFAULT '',
            device_role TEXT DEFAULT 'Access Switch',
            FOREIGN KEY (group_id) REFERENCES device_groups(id) ON DELETE SET NULL,
            FOREIGN KEY (credential_id) REFERENCES device_credentials(id) ON DELETE SET NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);")

        try:
            c.execute("ALTER TABLE device_groups ADD COLUMN parent_id INTEGER REFERENCES device_groups(id) ON DELETE SET NULL;")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE devices ADD COLUMN group_id INTEGER REFERENCES device_groups(id) ON DELETE SET NULL;")
        except sqlite3.OperationalError:
            pass
            
        try:
            c.execute("ALTER TABLE devices ADD COLUMN custom_arp_cmd TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN custom_lldp_cmd TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN custom_cdp_cmd TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN custom_routing_cmd TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE devices ADD COLUMN os_version TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN serial_number TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN mac_address TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN hardware_model TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE devices ADD COLUMN credential_id INTEGER REFERENCES device_credentials(id) ON DELETE SET NULL;")
            c.execute("ALTER TABLE devices ADD COLUMN custom_info_cmd TEXT DEFAULT '';")
            c.execute("ALTER TABLE devices ADD COLUMN raw_info TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE devices ADD COLUMN device_role TEXT DEFAULT 'Access Switch';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("UPDATE devices SET snmp_community = 'public' WHERE snmp_community IS NULL OR snmp_community = '';")
        except sqlite3.OperationalError:
            pass

        c.execute("CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id);")

        # ARP Cache
        c.execute("""
        CREATE TABLE IF NOT EXISTS arp_cache (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER NOT NULL,
            ip_address      TEXT NOT NULL,
            mac_address     TEXT NOT NULL,
            interface       TEXT DEFAULT '',
            entry_type      TEXT DEFAULT 'dynamic',
            age_minutes     INTEGER DEFAULT 0,
            mac_vendor      TEXT DEFAULT '',
            device_category TEXT DEFAULT 'unknown',
            device_hint     TEXT DEFAULT '',
            fetched_at      TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_arp_cache_device ON arp_cache(device_id);")

        # ARP History
        c.execute("""
        CREATE TABLE IF NOT EXISTS arp_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id   INTEGER NOT NULL,
            arp_count   INTEGER NOT NULL,
            fetched_at  TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # LLDP neighbors
        c.execute("""
        CREATE TABLE IF NOT EXISTS lldp_neighbors (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id         INTEGER NOT NULL,
            local_port        TEXT NOT NULL DEFAULT '',
            neighbor_name     TEXT DEFAULT '',
            neighbor_ip       TEXT DEFAULT '',
            neighbor_mac      TEXT DEFAULT '',
            neighbor_platform TEXT DEFAULT '',
            neighbor_port     TEXT DEFAULT '',
            neighbor_vendor   TEXT DEFAULT '',
            device_category   TEXT DEFAULT 'unknown',
            device_hint       TEXT DEFAULT '',
            fetched_at        TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_lldp_device ON lldp_neighbors(device_id);")

        # CDP Neighbors
        c.execute("""
        CREATE TABLE IF NOT EXISTS cdp_neighbors (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id         INTEGER NOT NULL,
            local_port        TEXT NOT NULL DEFAULT '',
            neighbor_name     TEXT DEFAULT '',
            neighbor_ip       TEXT DEFAULT '',
            neighbor_platform TEXT DEFAULT '',
            neighbor_port     TEXT DEFAULT '',
            fetched_at        TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_cdp_device ON cdp_neighbors(device_id);")

        # Routing Table
        c.execute("""
        CREATE TABLE IF NOT EXISTS routing_table (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id         INTEGER NOT NULL,
            destination       TEXT NOT NULL,
            gateway           TEXT DEFAULT '',
            interface         TEXT DEFAULT '',
            protocol          TEXT DEFAULT '',
            metric            TEXT DEFAULT '',
            fetched_at        TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_routing_device ON routing_table(device_id);")

        # MAC Addresses
        c.execute("""
        CREATE TABLE IF NOT EXISTS mac_addresses (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER NOT NULL,
            vlan            TEXT DEFAULT '',
            mac_address     TEXT NOT NULL,
            entry_type      TEXT DEFAULT 'dynamic',
            interface       TEXT NOT NULL,
            mac_vendor      TEXT DEFAULT '',
            fetched_at      TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_mac_addresses_device ON mac_addresses(device_id);")

        try:
            c.execute("ALTER TABLE mac_addresses ADD COLUMN mac_vendor TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE lldp_neighbors ADD COLUMN neighbor_vendor TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE lldp_neighbors ADD COLUMN device_category TEXT DEFAULT 'unknown';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE lldp_neighbors ADD COLUMN device_hint TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        try:
            c.execute("ALTER TABLE arp_cache ADD COLUMN mac_vendor TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE arp_cache ADD COLUMN device_category TEXT DEFAULT 'unknown';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE arp_cache ADD COLUMN device_hint TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

        # Topology Positions
        c.execute("""
        CREATE TABLE IF NOT EXISTS topology_positions (
            node_id TEXT PRIMARY KEY,
            x REAL NOT NULL,
            y REAL NOT NULL
        );
        """)

        # Users
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT NOT NULL UNIQUE,
            password    TEXT NOT NULL,
            full_name   TEXT DEFAULT '',
            role        TEXT NOT NULL DEFAULT 'user',
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL
        );
        """)

        # Create default admin user if none exists in SQLite
        c.execute("SELECT COUNT(*) as cnt FROM users")
        row = c.fetchone()
        if row["cnt"] == 0:
            import bcrypt
            hashed = bcrypt.hashpw("netx@admin".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            c.execute(
                "INSERT INTO users (username, password, full_name, role, created_at) VALUES (?,?,?,?,?)",
                ("admin", hashed, "Administrator", "admin", datetime.now().isoformat()),
            )

        # Device Config Backups
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_config_backups (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER NOT NULL,
            config_content  TEXT NOT NULL,
            version         INTEGER NOT NULL,
            status          TEXT NOT NULL DEFAULT 'success',
            error_message   TEXT DEFAULT '',
            created_at      TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_config_backups_device ON device_config_backups(device_id);")

        # Device Backup Schedules
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_backup_schedules (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            device_ids      TEXT NOT NULL,
            frequency       TEXT NOT NULL,
            time            TEXT DEFAULT '',
            day_of_week     INTEGER DEFAULT 0,
            is_active       INTEGER DEFAULT 1,
            last_run        TEXT DEFAULT '',
            next_run        TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );
        """)

        # Network History
        c.execute("""
        CREATE TABLE IF NOT EXISTS network_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            arp_count       INTEGER NOT NULL,
            mac_count       INTEGER NOT NULL,
            fetched_at      TEXT NOT NULL
        );
        """)

        # SNMP MIBs
        c.execute("""
        CREATE TABLE IF NOT EXISTS snmp_mibs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            description     TEXT DEFAULT '',
            vendor          TEXT DEFAULT 'all',
            is_active       INTEGER DEFAULT 1,
            created_at      TEXT NOT NULL
        );
        """)

        # SNMP MIB Objects
        c.execute("""
        CREATE TABLE IF NOT EXISTS snmp_mib_objects (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mib_id          INTEGER NOT NULL,
            name            TEXT NOT NULL,
            oid             TEXT NOT NULL,
            syntax          TEXT DEFAULT '',
            description     TEXT DEFAULT '',
            parent          TEXT DEFAULT '',
            kind            TEXT DEFAULT 'Single',
            is_unsigned     INTEGER DEFAULT 0,
            is_64bit        INTEGER DEFAULT 0,
            is_float        INTEGER DEFAULT 0,
            unit            TEXT DEFAULT 'Custom',
            unit_custom     TEXT DEFAULT '',
            indicator       TEXT DEFAULT '',
            scale           REAL DEFAULT 1.0,
            scale_mode      TEXT DEFAULT 'Divide',
            lookup          TEXT DEFAULT '',
            FOREIGN KEY (mib_id) REFERENCES snmp_mibs(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_snmp_mib_objects_mib ON snmp_mib_objects(mib_id);")

        for col, type_ in [
            ("parent", "TEXT DEFAULT ''"),
            ("kind", "TEXT DEFAULT 'Single'"),
            ("is_unsigned", "INTEGER DEFAULT 0"),
            ("is_64bit", "INTEGER DEFAULT 0"),
            ("is_float", "INTEGER DEFAULT 0"),
            ("unit", "TEXT DEFAULT 'Custom'"),
            ("unit_custom", "TEXT DEFAULT ''"),
            ("indicator", "TEXT DEFAULT ''"),
            ("scale", "REAL DEFAULT 1.0"),
            ("scale_mode", "TEXT DEFAULT 'Divide'"),
            ("lookup", "TEXT DEFAULT ''"),
        ]:
            try:
                c.execute(f"ALTER TABLE snmp_mib_objects ADD COLUMN {col} {type_};")
            except sqlite3.OperationalError:
                pass

        # Device SNMP Objects
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_snmp_objects (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER NOT NULL,
            mib_object_id   INTEGER NOT NULL,
            created_at      TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
            FOREIGN KEY (mib_object_id) REFERENCES snmp_mib_objects(id) ON DELETE CASCADE,
            UNIQUE(device_id, mib_object_id)
        );
        """)

        # Network Anomalies Table
        c.execute("""
        CREATE TABLE IF NOT EXISTS network_anomalies (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER NOT NULL,
            anomaly_type    TEXT NOT NULL,
            severity        TEXT NOT NULL,
            interface_name  TEXT DEFAULT '',
            details         TEXT DEFAULT '',
            is_active       INTEGER DEFAULT 1,
            detected_at     TEXT NOT NULL,
            resolved_at     TEXT,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_network_anomalies_device ON network_anomalies(device_id);")

        # Interface SNMP Stats
        c.execute("""
        CREATE TABLE IF NOT EXISTS interface_stats_latest (
            device_id       INTEGER NOT NULL,
            interface_name  TEXT NOT NULL,
            in_broadcast    INTEGER DEFAULT 0,
            out_broadcast   INTEGER DEFAULT 0,
            in_multicast    INTEGER DEFAULT 0,
            out_multicast   INTEGER DEFAULT 0,
            in_unicast      INTEGER DEFAULT 0,
            out_unicast     INTEGER DEFAULT 0,
            oper_status     TEXT DEFAULT 'unknown',
            stp_top_changes INTEGER DEFAULT 0,
            status_changes_history TEXT DEFAULT '[]',
            updated_at      TEXT NOT NULL,
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # MAC Address History
        c.execute("""
        CREATE TABLE IF NOT EXISTS mac_history_tracking (
            mac_address     TEXT PRIMARY KEY,
            device_id       INTEGER NOT NULL,
            interface_name  TEXT NOT NULL,
            vlan            TEXT DEFAULT '',
            updated_at      TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # Device Syslogs
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_syslogs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id       INTEGER,
            sender_ip       TEXT DEFAULT '',
            facility        INTEGER DEFAULT 1,
            severity        INTEGER DEFAULT 5,
            program         TEXT DEFAULT '',
            message         TEXT NOT NULL,
            timestamp       TEXT NOT NULL,
            raw_message     TEXT,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_syslogs_device ON device_syslogs(device_id);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_syslogs_time ON device_syslogs(timestamp);")

        try:
            c.execute("ALTER TABLE device_syslogs ADD COLUMN sender_ip TEXT DEFAULT '';")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    conn.close()


def get_device_credentials(device: dict) -> tuple[str, str]:
    """Returns (username, password_decrypted) for a device, resolving credential_id if set."""
    username = device.get("username") or ""
    password = decrypt_password(device.get("password") or "")
    
    cred_id = device.get("credential_id")
    if cred_id:
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT username, password FROM device_credentials WHERE id = ?", (cred_id,))
        row = c.fetchone()
        conn.close()
        if row:
            username = row["username"]
            password = decrypt_password(row["password"])
            
    return username, password


# Run at import time
init_db()

