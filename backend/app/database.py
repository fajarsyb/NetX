import os
import sqlite3
from datetime import datetime
from cryptography.fernet import Fernet

# ─── MONKEYPATCH PYSNMP ENGINE FOR FD LEAK PREVENTION ───────────────────────
try:
    from pysnmp.entity.engine import SnmpEngine as PySnmpEngine
    def _snmp_engine_del(self):
        try:
            if hasattr(self, "close_dispatcher"):
                self.close_dispatcher()
            elif hasattr(self, "closeDispatcher"):
                self.closeDispatcher()
        except Exception:
            pass

    PySnmpEngine.__del__ = _snmp_engine_del
except ImportError:
    pass

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
                    oper_status, stp_top_changes, status_changes_history, updated_at,
                    in_errors, out_errors, crc_errors, frame_errors, link_speed,
                    last_link_up_time, last_link_down_time, in_octets, out_octets
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    updated_at = EXCLUDED.updated_at,
                    in_errors = EXCLUDED.in_errors,
                    out_errors = EXCLUDED.out_errors,
                    crc_errors = EXCLUDED.crc_errors,
                    frame_errors = EXCLUDED.frame_errors,
                    link_speed = EXCLUDED.link_speed,
                    last_link_up_time = EXCLUDED.last_link_up_time,
                    last_link_down_time = EXCLUDED.last_link_down_time,
                    in_octets = EXCLUDED.in_octets,
                    out_octets = EXCLUDED.out_octets
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
                temp_c.execute("SAVEPOINT lastval_sp;")
                try:
                    temp_c.execute("SELECT lastval();")
                    self._lastrowid = temp_c.fetchone()[0]
                    temp_c.execute("RELEASE SAVEPOINT lastval_sp;")
                except Exception:
                    try:
                        temp_c.execute("ROLLBACK TO SAVEPOINT lastval_sp;")
                    except Exception:
                        pass
                    self._lastrowid = None
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
        self._closed = False

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
        if not self._closed:
            if PG_POOL is not None:
                try:
                    PG_POOL.putconn(self.real_conn)
                except Exception:
                    pass
            else:
                try:
                    self.real_conn.close()
                except Exception:
                    pass
            self._closed = True

    def __del__(self):
        self.close()

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
        self._closed = False

    def cursor(self, *args, **kwargs):
        real_cur = self.real_conn.cursor(*args, **kwargs)
        return SQLiteCursorWrapper(real_cur)

    def commit(self):
        return self.real_conn.commit()

    def rollback(self):
        return self.real_conn.rollback()

    def close(self):
        if not self._closed:
            try:
                self.real_conn.close()
            except Exception:
                pass
            self._closed = True

    def __del__(self):
        self.close()

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
        conn = sqlite3.connect(DB_PATH, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
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
            permissions TEXT DEFAULT NULL,
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
            in_errors       BIGINT DEFAULT 0,
            out_errors      BIGINT DEFAULT 0,
            crc_errors      BIGINT DEFAULT 0,
            frame_errors    BIGINT DEFAULT 0,
            link_speed      BIGINT DEFAULT 0,
            last_link_up_time VARCHAR(100) DEFAULT NULL,
            last_link_down_time VARCHAR(100) DEFAULT NULL,
            in_octets       BIGINT DEFAULT 0,
            out_octets      BIGINT DEFAULT 0,
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

        # Device Credential Compliance
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_credential_compliance (
            device_id       INTEGER PRIMARY KEY,
            status          VARCHAR(50) NOT NULL,
            working_defaults TEXT DEFAULT '[]',
            working_db_templates TEXT DEFAULT '[]',
            scanned_at      VARCHAR(100) NOT NULL,
            error_message   TEXT DEFAULT '',
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # Threshold Profiles
        c.execute("""
        CREATE TABLE IF NOT EXISTS threshold_profiles (
            id                            SERIAL PRIMARY KEY,
            name                          VARCHAR(255) NOT NULL UNIQUE,
            description                   TEXT DEFAULT '',
            broadcast_storm_warning       INTEGER DEFAULT 1000,
            broadcast_storm_critical      INTEGER DEFAULT 5000,
            multicast_storm_warning       INTEGER DEFAULT 1000,
            multicast_storm_critical      INTEGER DEFAULT 5000,
            unicast_storm_warning         INTEGER DEFAULT 80000,
            unicast_storm_critical        INTEGER DEFAULT 120000,
            port_flap_warning             INTEGER DEFAULT 3,
            port_flap_critical            INTEGER DEFAULT 6,
            port_flap_window              INTEGER DEFAULT 300,
            crc_error_rate                REAL DEFAULT 0.05,
            crc_error_delta               INTEGER DEFAULT 5,
            frame_error_rate              REAL DEFAULT 0.05,
            frame_error_delta             INTEGER DEFAULT 5,
            transmission_error_rate       REAL DEFAULT 0.1,
            transmission_error_delta      INTEGER DEFAULT 5,
            created_at                    VARCHAR(100) NOT NULL
        );
        """)

        # Syslog Patterns
        c.execute("""
        CREATE TABLE IF NOT EXISTS syslog_patterns (
            pattern_hash                  VARCHAR(64) PRIMARY KEY,
            template                      TEXT NOT NULL,
            program                       VARCHAR(255) DEFAULT '',
            severity                      INTEGER DEFAULT 5,
            is_blocked                    INTEGER DEFAULT 0,
            is_anomaly                    INTEGER DEFAULT 0,
            created_at                    VARCHAR(100) NOT NULL
        );
        """)

        # Shell Notes Folders (PostgreSQL)
        c.execute("""
        CREATE TABLE IF NOT EXISTS shell_notes_folders (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(255) NOT NULL,
            parent_id   INTEGER,
            created_by  INTEGER,
            created_at  VARCHAR(100) NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES shell_notes_folders(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        """)

        # Shell Notes Templates (PostgreSQL)
        c.execute("""
        CREATE TABLE IF NOT EXISTS shell_notes_templates (
            id              SERIAL PRIMARY KEY,
            folder_id       INTEGER,
            title           VARCHAR(255) NOT NULL,
            content         TEXT NOT NULL DEFAULT '',
            description     TEXT DEFAULT '',
            vendor_hint     VARCHAR(100) DEFAULT '',
            is_favorite     INTEGER DEFAULT 0,
            is_shared       INTEGER DEFAULT 0,
            shared_token    VARCHAR(64) DEFAULT NULL,
            variables       TEXT DEFAULT '[]',
            tags            TEXT DEFAULT '[]',
            created_by      INTEGER,
            created_at      VARCHAR(100) NOT NULL,
            updated_at      VARCHAR(100) NOT NULL,
            FOREIGN KEY (folder_id) REFERENCES shell_notes_folders(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        """)
        # Remote Backup Settings (PostgreSQL)
        c.execute("""
        CREATE TABLE IF NOT EXISTS remote_backup_settings (
            id              SERIAL PRIMARY KEY,
            protocol        VARCHAR(50) NOT NULL DEFAULT 'sftp',
            host            VARCHAR(255) NOT NULL,
            port            INTEGER NOT NULL DEFAULT 22,
            username        VARCHAR(255) NOT NULL,
            password        TEXT NOT NULL,
            path            VARCHAR(255) DEFAULT '',
            is_active       INTEGER DEFAULT 0,
            backup_db       INTEGER DEFAULT 0,
            backup_config   INTEGER DEFAULT 0
        );
        """)

        # ─── PostgreSQL L2 Analysis Tables ───
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_spanning_tree (
            device_id                INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
            stp_mode                 VARCHAR(100) DEFAULT 'unknown',
            root_bridge_id           VARCHAR(255) DEFAULT '',
            root_bridge_priority     INTEGER DEFAULT 0,
            bridge_id                VARCHAR(255) DEFAULT '',
            bridge_priority          INTEGER DEFAULT 0,
            root_path_cost           BIGINT DEFAULT 0,
            root_port                VARCHAR(100) DEFAULT '',
            topology_change_count    BIGINT DEFAULT 0,
            last_topology_change     VARCHAR(100) DEFAULT NULL,
            confidence_score         INTEGER DEFAULT 100,
            data_source              VARCHAR(100) DEFAULT 'Simulation',
            validation_status        TEXT DEFAULT 'Verified',
            fetched_at               VARCHAR(100) NOT NULL
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_stp_ports (
            device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            interface_name    VARCHAR(100) NOT NULL,
            port_role         VARCHAR(50) DEFAULT 'Disabled',
            port_state        VARCHAR(50) DEFAULT 'Disabled',
            cost              INTEGER DEFAULT 0,
            priority          INTEGER DEFAULT 128,
            edge_port         INTEGER DEFAULT 0,
            bpdu_guard        VARCHAR(50) DEFAULT 'Disabled',
            root_guard        VARCHAR(50) DEFAULT 'Disabled',
            loop_guard        VARCHAR(50) DEFAULT 'Disabled',
            bpdu_filter       VARCHAR(50) DEFAULT 'Disabled',
            portfast          VARCHAR(50) DEFAULT 'Disabled',
            fetched_at        VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, interface_name)
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_vlans (
            device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            vlan_id           INTEGER NOT NULL,
            name              VARCHAR(255) DEFAULT '',
            status            VARCHAR(50) DEFAULT 'active',
            ports             TEXT DEFAULT '',
            fetched_at        VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, vlan_id)
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_interfaces (
            device_id              INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            interface_name         VARCHAR(100) NOT NULL,
            description            TEXT DEFAULT '',
            port_type              VARCHAR(50) DEFAULT 'Access',
            oper_status            VARCHAR(50) DEFAULT 'down',
            admin_status           VARCHAR(50) DEFAULT 'down',
            speed                  VARCHAR(100) DEFAULT '',
            duplex                 VARCHAR(50) DEFAULT '',
            mtu                    INTEGER DEFAULT 1500,
            in_octets              BIGINT DEFAULT 0,
            out_octets             BIGINT DEFAULT 0,
            in_errors              BIGINT DEFAULT 0,
            out_errors             BIGINT DEFAULT 0,
            crc_errors             BIGINT DEFAULT 0,
            drops                  BIGINT DEFAULT 0,
            discards               BIGINT DEFAULT 0,
            broadcast_pps          REAL DEFAULT 0.0,
            multicast_pps          REAL DEFAULT 0.0,
            unknown_unicast_pps    REAL DEFAULT 0.0,
            port_flaps             INTEGER DEFAULT 0,
            mac_count              INTEGER DEFAULT 0,
            connected_device       TEXT DEFAULT '',
            vlan                   VARCHAR(50) DEFAULT '',
            native_vlan            VARCHAR(50) DEFAULT '',
            allowed_vlans          TEXT DEFAULT '',
            voice_vlan             VARCHAR(50) DEFAULT '',
            poe_status             VARCHAR(50) DEFAULT 'Disabled',
            poe_consumption        REAL DEFAULT 0.0,
            sfp_vendor             VARCHAR(255) DEFAULT '',
            sfp_model              VARCHAR(255) DEFAULT '',
            sfp_serial             VARCHAR(255) DEFAULT '',
            sfp_rx_power           REAL DEFAULT 0.0,
            sfp_tx_power           REAL DEFAULT 0.0,
            sfp_temp               REAL DEFAULT 0.0,
            sfp_voltage            REAL DEFAULT 0.0,
            sfp_bias_current       REAL DEFAULT 0.0,
            sfp_health             VARCHAR(50) DEFAULT 'Healthy',
            health_score           INTEGER DEFAULT 100,
            lifecycle_score        INTEGER DEFAULT 100,
            risk_score             INTEGER DEFAULT 0,
            recommendation_action  VARCHAR(255) DEFAULT '—',
            recommendation_text    TEXT DEFAULT 'Port beroperasi normal.',
            recommendation_code    VARCHAR(50) DEFAULT 'ok',
            visual_indicator       VARCHAR(50) DEFAULT 'green',
            is_uplink              INTEGER DEFAULT 0,
            uplink_type            VARCHAR(100) DEFAULT '',
            uplink_switch          VARCHAR(255) DEFAULT '',
            uplink_bandwidth       BIGINT DEFAULT 0,
            uplink_utilization     REAL DEFAULT 0.0,
            uplink_redundancy      VARCHAR(100) DEFAULT '',
            uplink_backup_link     VARCHAR(100) DEFAULT '',
            fetched_at             VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, interface_name)
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_port_security (
            device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            interface_name    VARCHAR(100) NOT NULL,
            sticky_mac         INTEGER DEFAULT 0,
            max_mac            INTEGER DEFAULT 1,
            current_mac        INTEGER DEFAULT 0,
            violation_mode     VARCHAR(50) DEFAULT 'Shutdown',
            violation_count    INTEGER DEFAULT 0,
            fetched_at         VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, interface_name)
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_macs (
            device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            interface_name    VARCHAR(100) NOT NULL,
            vlan              VARCHAR(50) DEFAULT '',
            mac_address       VARCHAR(100) NOT NULL,
            entry_type        VARCHAR(50) DEFAULT 'dynamic',
            mac_vendor        VARCHAR(255) DEFAULT '',
            first_seen        VARCHAR(100) NOT NULL,
            last_seen         VARCHAR(100) NOT NULL,
            PRIMARY KEY (device_id, interface_name, mac_address)
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_timeline (
            id                SERIAL PRIMARY KEY,
            device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            event_type        VARCHAR(100) NOT NULL,
            interface_name    VARCHAR(100) DEFAULT '',
            details           TEXT DEFAULT '',
            severity          VARCHAR(50) NOT NULL DEFAULT 'info',
            timestamp         VARCHAR(100) NOT NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_l2_timeline_device ON device_l2_timeline(device_id);")

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_port_lifecycle (
            device_id              INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            interface_name         VARCHAR(100) NOT NULL,
            first_seen             VARCHAR(100) NOT NULL,
            last_seen              VARCHAR(100) NOT NULL,
            last_link_up           VARCHAR(100) DEFAULT NULL,
            last_link_down         VARCHAR(100) DEFAULT NULL,
            total_active_time      BIGINT DEFAULT 0,
            total_inactive_time    BIGINT DEFAULT 0,
            link_event_count       INTEGER DEFAULT 0,
            last_traffic_activity  VARCHAR(100) DEFAULT NULL,
            avg_utilization        REAL DEFAULT 0.0,
            peak_utilization       REAL DEFAULT 0.0,
            mac_history            TEXT DEFAULT '[]',
            neighbor_history       TEXT DEFAULT '[]',
            vlan_history           TEXT DEFAULT '[]',
            classification         VARCHAR(100) DEFAULT 'Never Used',
            PRIMARY KEY (device_id, interface_name)
        );
        """)



        # Alter tables to add columns for PostgreSQL
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 100;")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN IF NOT EXISTS data_source VARCHAR(100) DEFAULT 'Simulation';")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'Verified';")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE devices ADD COLUMN IF NOT EXISTS threshold_profile_id INTEGER REFERENCES threshold_profiles(id) ON DELETE SET NULL;")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE device_syslogs ADD COLUMN IF NOT EXISTS pattern_hash VARCHAR(64) REFERENCES syslog_patterns(pattern_hash) ON DELETE SET NULL;")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE network_anomalies ADD COLUMN IF NOT EXISTS parent_anomaly_id INTEGER REFERENCES network_anomalies(id) ON DELETE SET NULL;")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT NULL;")
        except Exception:
            pass


        # Add new columns to interface_stats_latest for PG
        for col in ["last_link_up_time", "last_link_down_time"]:
            try:
                c.execute(f"ALTER TABLE interface_stats_latest ADD COLUMN IF NOT EXISTS {col} VARCHAR(100) DEFAULT NULL;")
            except Exception:
                pass
        for col in ["in_octets", "out_octets"]:
            try:
                c.execute(f"ALTER TABLE interface_stats_latest ADD COLUMN IF NOT EXISTS {col} BIGINT DEFAULT 0;")
            except Exception:
                pass

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
            permissions TEXT DEFAULT NULL,
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
            last_link_up_time TEXT DEFAULT NULL,
            last_link_down_time TEXT DEFAULT NULL,
            in_octets       BIGINT DEFAULT 0,
            out_octets      BIGINT DEFAULT 0,
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

        # Device Credential Compliance
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_credential_compliance (
            device_id       INTEGER PRIMARY KEY,
            status          TEXT NOT NULL,
            working_defaults TEXT DEFAULT '[]',
            working_db_templates TEXT DEFAULT '[]',
            scanned_at      TEXT NOT NULL,
            error_message   TEXT DEFAULT '',
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        # Add new columns to interface_stats_latest table for port health diagnostics
        for col in ["in_errors", "out_errors", "crc_errors", "frame_errors", "link_speed"]:
            try:
                c.execute(f"ALTER TABLE interface_stats_latest ADD COLUMN {col} BIGINT DEFAULT 0;")
            except Exception:
                pass

        # Add new columns for Port Utilization Analysis
        for col in ["last_link_up_time", "last_link_down_time"]:
            try:
                c.execute(f"ALTER TABLE interface_stats_latest ADD COLUMN {col} TEXT DEFAULT NULL;")
            except Exception:
                pass
        for col in ["in_octets", "out_octets"]:
            try:
                c.execute(f"ALTER TABLE interface_stats_latest ADD COLUMN {col} BIGINT DEFAULT 0;")
            except Exception:
                pass

        # Threshold Profiles
        c.execute("""
        CREATE TABLE IF NOT EXISTS threshold_profiles (
            id                            INTEGER PRIMARY KEY AUTOINCREMENT,
            name                          TEXT NOT NULL UNIQUE,
            description                   TEXT DEFAULT '',
            broadcast_storm_warning       INTEGER DEFAULT 1000,
            broadcast_storm_critical      INTEGER DEFAULT 5000,
            multicast_storm_warning       INTEGER DEFAULT 1000,
            multicast_storm_critical      INTEGER DEFAULT 5000,
            unicast_storm_warning         INTEGER DEFAULT 80000,
            unicast_storm_critical        INTEGER DEFAULT 120000,
            port_flap_warning             INTEGER DEFAULT 3,
            port_flap_critical            INTEGER DEFAULT 6,
            port_flap_window              INTEGER DEFAULT 300,
            crc_error_rate                REAL DEFAULT 0.05,
            crc_error_delta               INTEGER DEFAULT 5,
            frame_error_rate              REAL DEFAULT 0.05,
            frame_error_delta             INTEGER DEFAULT 5,
            transmission_error_rate       REAL DEFAULT 0.1,
            transmission_error_delta      INTEGER DEFAULT 5,
            created_at                    TEXT NOT NULL
        );
        """)

        # Syslog Patterns
        c.execute("""
        CREATE TABLE IF NOT EXISTS syslog_patterns (
            pattern_hash                  TEXT PRIMARY KEY,
            template                      TEXT NOT NULL,
            program                       TEXT DEFAULT '',
            severity                      INTEGER DEFAULT 5,
            is_blocked                    INTEGER DEFAULT 0,
            is_anomaly                    INTEGER DEFAULT 0,
            created_at                    TEXT NOT NULL
        );
        """)

        # Shell Notes Folders (SQLite)
        c.execute("""
        CREATE TABLE IF NOT EXISTS shell_notes_folders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            parent_id   INTEGER,
            created_by  INTEGER,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES shell_notes_folders(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        """)

        # Shell Notes Templates (SQLite)
        c.execute("""
        CREATE TABLE IF NOT EXISTS shell_notes_templates (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id       INTEGER,
            title           TEXT NOT NULL,
            content         TEXT NOT NULL DEFAULT '',
            description     TEXT DEFAULT '',
            vendor_hint     TEXT DEFAULT '',
            is_favorite     INTEGER DEFAULT 0,
            is_shared       INTEGER DEFAULT 0,
            shared_token    TEXT DEFAULT NULL,
            variables       TEXT DEFAULT '[]',
            tags            TEXT DEFAULT '[]',
            created_by      INTEGER,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            FOREIGN KEY (folder_id) REFERENCES shell_notes_folders(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_shell_notes_folder ON shell_notes_templates(folder_id);")
        c.execute("CREATE INDEX IF NOT EXISTS idx_shell_notes_user ON shell_notes_templates(created_by);")

        # Remote Backup Settings (SQLite)
        c.execute("""
        CREATE TABLE IF NOT EXISTS remote_backup_settings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            protocol        TEXT NOT NULL DEFAULT 'sftp',
            host            TEXT NOT NULL,
            port            INTEGER NOT NULL DEFAULT 22,
            username        TEXT NOT NULL,
            password        TEXT NOT NULL,
            path            TEXT DEFAULT '',
            is_active       INTEGER DEFAULT 0,
            backup_db       INTEGER DEFAULT 0,
            backup_config   INTEGER DEFAULT 0
        );
        """)

        # ─── SQLite L2 Analysis Tables ───
        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_spanning_tree (
            device_id                INTEGER PRIMARY KEY,
            stp_mode                 TEXT DEFAULT 'unknown',
            root_bridge_id           TEXT DEFAULT '',
            root_bridge_priority     INTEGER DEFAULT 0,
            bridge_id                TEXT DEFAULT '',
            bridge_priority          INTEGER DEFAULT 0,
            root_path_cost           BIGINT DEFAULT 0,
            root_port                TEXT DEFAULT '',
            topology_change_count    BIGINT DEFAULT 0,
            last_topology_change     TEXT DEFAULT NULL,
            confidence_score         INTEGER DEFAULT 100,
            data_source              TEXT DEFAULT 'Simulation',
            validation_status        TEXT DEFAULT 'Verified',
            fetched_at               TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_stp_ports (
            device_id         INTEGER NOT NULL,
            interface_name    TEXT NOT NULL,
            port_role         TEXT DEFAULT 'Disabled',
            port_state        TEXT DEFAULT 'Disabled',
            cost              INTEGER DEFAULT 0,
            priority          INTEGER DEFAULT 128,
            edge_port         INTEGER DEFAULT 0,
            bpdu_guard        TEXT DEFAULT 'Disabled',
            root_guard        TEXT DEFAULT 'Disabled',
            loop_guard        TEXT DEFAULT 'Disabled',
            bpdu_filter       TEXT DEFAULT 'Disabled',
            portfast          TEXT DEFAULT 'Disabled',
            fetched_at        TEXT NOT NULL,
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_vlans (
            device_id         INTEGER NOT NULL,
            vlan_id           INTEGER NOT NULL,
            name              TEXT DEFAULT '',
            status            TEXT DEFAULT 'active',
            ports             TEXT DEFAULT '',
            fetched_at        TEXT NOT NULL,
            PRIMARY KEY (device_id, vlan_id),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_interfaces (
            device_id              INTEGER NOT NULL,
            interface_name         TEXT NOT NULL,
            description            TEXT DEFAULT '',
            port_type              TEXT DEFAULT 'Access',
            oper_status            TEXT DEFAULT 'down',
            admin_status           TEXT DEFAULT 'down',
            speed                  TEXT DEFAULT '',
            duplex                 TEXT DEFAULT '',
            mtu                    INTEGER DEFAULT 1500,
            in_octets              BIGINT DEFAULT 0,
            out_octets             BIGINT DEFAULT 0,
            in_errors              BIGINT DEFAULT 0,
            out_errors             BIGINT DEFAULT 0,
            crc_errors             BIGINT DEFAULT 0,
            drops                  BIGINT DEFAULT 0,
            discards               BIGINT DEFAULT 0,
            broadcast_pps          REAL DEFAULT 0.0,
            multicast_pps          REAL DEFAULT 0.0,
            unknown_unicast_pps    REAL DEFAULT 0.0,
            port_flaps             INTEGER DEFAULT 0,
            mac_count              INTEGER DEFAULT 0,
            connected_device       TEXT DEFAULT '',
            vlan                   TEXT DEFAULT '',
            native_vlan            TEXT DEFAULT '',
            allowed_vlans          TEXT DEFAULT '',
            voice_vlan             TEXT DEFAULT '',
            poe_status             TEXT DEFAULT 'Disabled',
            poe_consumption        REAL DEFAULT 0.0,
            sfp_vendor             TEXT DEFAULT '',
            sfp_model              TEXT DEFAULT '',
            sfp_serial             TEXT DEFAULT '',
            sfp_rx_power           REAL DEFAULT 0.0,
            sfp_tx_power           REAL DEFAULT 0.0,
            sfp_temp               REAL DEFAULT 0.0,
            sfp_voltage            REAL DEFAULT 0.0,
            sfp_bias_current       REAL DEFAULT 0.0,
            sfp_health             TEXT DEFAULT 'Healthy',
            health_score           INTEGER DEFAULT 100,
            lifecycle_score        INTEGER DEFAULT 100,
            risk_score             INTEGER DEFAULT 0,
            recommendation_action  TEXT DEFAULT '—',
            recommendation_text    TEXT DEFAULT 'Port beroperasi normal.',
            recommendation_code    TEXT DEFAULT 'ok',
            visual_indicator       TEXT DEFAULT 'green',
            is_uplink              INTEGER DEFAULT 0,
            uplink_type            TEXT DEFAULT '',
            uplink_switch          TEXT DEFAULT '',
            uplink_bandwidth       BIGINT DEFAULT 0,
            uplink_utilization     REAL DEFAULT 0.0,
            uplink_redundancy      TEXT DEFAULT '',
            uplink_backup_link     TEXT DEFAULT '',
            fetched_at             TEXT NOT NULL,
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_port_security (
            device_id         INTEGER NOT NULL,
            interface_name    TEXT NOT NULL,
            sticky_mac         INTEGER DEFAULT 0,
            max_mac            INTEGER DEFAULT 1,
            current_mac        INTEGER DEFAULT 0,
            violation_mode     TEXT DEFAULT 'Shutdown',
            violation_count    INTEGER DEFAULT 0,
            fetched_at         TEXT NOT NULL,
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_macs (
            device_id         INTEGER NOT NULL,
            interface_name    TEXT NOT NULL,
            vlan              TEXT DEFAULT '',
            mac_address       TEXT NOT NULL,
            entry_type        TEXT DEFAULT 'dynamic',
            mac_vendor        TEXT DEFAULT '',
            first_seen        TEXT NOT NULL,
            last_seen         TEXT NOT NULL,
            PRIMARY KEY (device_id, interface_name, mac_address),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_timeline (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id         INTEGER NOT NULL,
            event_type        TEXT NOT NULL,
            interface_name    TEXT DEFAULT '',
            details           TEXT DEFAULT '',
            severity          TEXT NOT NULL DEFAULT 'info',
            timestamp         TEXT NOT NULL,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_device_l2_timeline_device ON device_l2_timeline(device_id);")

        c.execute("""
        CREATE TABLE IF NOT EXISTS device_l2_port_lifecycle (
            device_id              INTEGER NOT NULL,
            interface_name         TEXT NOT NULL,
            first_seen             TEXT NOT NULL,
            last_seen             TEXT NOT NULL,
            last_link_up           TEXT DEFAULT NULL,
            last_link_down         TEXT DEFAULT NULL,
            total_active_time      BIGINT DEFAULT 0,
            total_inactive_time    BIGINT DEFAULT 0,
            link_event_count       INTEGER DEFAULT 0,
            last_traffic_activity  TEXT DEFAULT NULL,
            avg_utilization        REAL DEFAULT 0.0,
            peak_utilization       REAL DEFAULT 0.0,
            mac_history            TEXT DEFAULT '[]',
            neighbor_history       TEXT DEFAULT '[]',
            vlan_history           TEXT DEFAULT '[]',
            classification         TEXT DEFAULT 'Never Used',
            PRIMARY KEY (device_id, interface_name),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
        """)


        # Alter tables to add columns for SQLite
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN confidence_score INTEGER DEFAULT 100;")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN data_source TEXT DEFAULT 'Simulation';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE device_l2_spanning_tree ADD COLUMN validation_status TEXT DEFAULT 'Verified';")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE devices ADD COLUMN threshold_profile_id INTEGER REFERENCES threshold_profiles(id) ON DELETE SET NULL;")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE device_syslogs ADD COLUMN pattern_hash TEXT REFERENCES syslog_patterns(pattern_hash) ON DELETE SET NULL;")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE network_anomalies ADD COLUMN parent_anomaly_id INTEGER REFERENCES network_anomalies(id) ON DELETE SET NULL;")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL;")
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


# Do not run at import time to prevent concurrent DDL conflicts in multi-worker setups.
# init_db()

