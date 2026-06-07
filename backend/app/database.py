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


# ─── DATABASE CONNECTION ────────────────────────────────────────────────────
def get_db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


# ─── SCHEMA INITIALIZATION ──────────────────────────────────────────────────
def init_db():
    conn = get_db_conn()
    c = conn.cursor()

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

    # Devices — no seed data, user inputs everything
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

    # Add new columns to existing device_groups table if not exists
    try:
        c.execute("ALTER TABLE device_groups ADD COLUMN parent_id INTEGER REFERENCES device_groups(id) ON DELETE SET NULL;")
    except sqlite3.OperationalError:
        pass

    # Add new columns to existing devices table if not exists
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

    # Update existing empty/null snmp_community to 'public'
    try:
        c.execute("UPDATE devices SET snmp_community = 'public' WHERE snmp_community IS NULL OR snmp_community = '';")
    except sqlite3.OperationalError:
        pass

    c.execute("CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id);")


    # ARP cache — enriched with OUI vendor data
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

    # ARP history — for trending charts
    c.execute("""
    CREATE TABLE IF NOT EXISTS arp_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id   INTEGER NOT NULL,
        arp_count   INTEGER NOT NULL,
        fetched_at  TEXT NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    """)

    # LLDP neighbor cache — enriched with OUI vendor data
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

    # CDP neighbor cache
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

    # Routing table
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

    # MAC addresses cache
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

    # Add mac_vendor column to existing mac_addresses table if not exists
    try:
        c.execute("ALTER TABLE mac_addresses ADD COLUMN mac_vendor TEXT DEFAULT '';")
    except sqlite3.OperationalError:
        pass

    # Add new columns to existing lldp_neighbors table if not exists
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

    # Add new columns to existing arp_cache table if not exists
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

    # Users — login accounts for NetX
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

    # Create default admin if no users exist
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
        device_ids      TEXT NOT NULL, -- comma separated IDs, or 'all'
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
        vendor          TEXT DEFAULT 'all', -- matches device_type or 'all'
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

    # Add new columns to existing snmp_mib_objects table if not exists
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

    # Device SNMP Objects Association Table
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

    # Interface SNMP Stats Table (for delta/rate comparison)
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

    # MAC Address History/Movement tracking
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

    # Device Syslogs Table
    c.execute("""
    CREATE TABLE IF NOT EXISTS device_syslogs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id       INTEGER,
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

