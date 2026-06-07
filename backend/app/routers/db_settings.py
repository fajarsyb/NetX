"""
Database Settings Router
Manages PostgreSQL connection configuration and migration readiness.
"""
import os
import json
import sqlite3
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/db-settings", tags=["database-settings"])

# Paths
BACKEND_DIR = Path(__file__).parent.parent.parent
ENV_PATH = BACKEND_DIR / ".env"
DATA_DIR = BACKEND_DIR / "data"
SQLITE_DB_PATH = DATA_DIR / "netx.db"


class PostgresConfig(BaseModel):
    host: str = "localhost"
    port: int = 5432
    database: str = "netx"
    username: str = "postgres"
    password: str = ""
    ssl_mode: str = "prefer"


class TestResult(BaseModel):
    success: bool
    message: str
    details: Optional[dict] = None


def _read_env_file() -> dict:
    """Read key=value pairs from .env file."""
    config = {}
    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    config[key.strip()] = value.strip()
    return config


def _write_env_file(config: dict):
    """Write key=value pairs to .env file, preserving comments and non-DB keys."""
    existing_lines = []
    db_keys = {"DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_MODE", "DB_ENGINE"}

    if ENV_PATH.exists():
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    if key in db_keys:
                        continue  # Skip old DB keys, we'll re-write them
                existing_lines.append(line.rstrip("\n"))

    # Add DB config lines
    db_lines = [
        "",
        "# ─── PostgreSQL Database Configuration ───",
        f"DB_ENGINE={config.get('DB_ENGINE', 'sqlite')}",
        f"DB_HOST={config.get('DB_HOST', 'localhost')}",
        f"DB_PORT={config.get('DB_PORT', '5432')}",
        f"DB_NAME={config.get('DB_NAME', 'netx')}",
        f"DB_USER={config.get('DB_USER', 'postgres')}",
        f"DB_PASSWORD={config.get('DB_PASSWORD', '')}",
        f"DB_SSL_MODE={config.get('DB_SSL_MODE', 'prefer')}",
    ]

    with open(ENV_PATH, "w", encoding="utf-8") as f:
        for line in existing_lines:
            f.write(line + "\n")
        for line in db_lines:
            f.write(line + "\n")


def _get_sqlite_stats() -> dict:
    """Get stats about the current SQLite database."""
    stats = {"exists": False, "size_mb": 0, "tables": {}}
    if not SQLITE_DB_PATH.exists():
        return stats

    stats["exists"] = True
    stats["size_mb"] = round(os.path.getsize(SQLITE_DB_PATH) / (1024 * 1024), 2)

    try:
        conn = sqlite3.connect(str(SQLITE_DB_PATH))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [row["name"] for row in cursor.fetchall()]

        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) as cnt FROM [{table}]")
                row = cursor.fetchone()
                stats["tables"][table] = row["cnt"] if row else 0
            except Exception:
                stats["tables"][table] = -1

        conn.close()
    except Exception:
        pass

    return stats


@router.get("/current")
def get_current_config():
    """Get current database configuration and status."""
    env_config = _read_env_file()
    sqlite_stats = _get_sqlite_stats()

    current_engine = env_config.get("DB_ENGINE", "sqlite")

    pg_config = {
        "host": env_config.get("DB_HOST", "localhost"),
        "port": int(env_config.get("DB_PORT", "5432")),
        "database": env_config.get("DB_NAME", "netx"),
        "username": env_config.get("DB_USER", "postgres"),
        "password": env_config.get("DB_PASSWORD", ""),
        "ssl_mode": env_config.get("DB_SSL_MODE", "prefer"),
    }

    return {
        "current_engine": current_engine,
        "pg_config": pg_config,
        "sqlite_stats": sqlite_stats,
        "env_file_exists": ENV_PATH.exists(),
        "migration_ready": current_engine == "postgresql",
    }


@router.post("/save")
def save_config(config: PostgresConfig):
    """Save PostgreSQL configuration to .env file."""
    try:
        env_data = {
            "DB_ENGINE": "sqlite",  # Don't switch engine automatically
            "DB_HOST": config.host,
            "DB_PORT": str(config.port),
            "DB_NAME": config.database,
            "DB_USER": config.username,
            "DB_PASSWORD": config.password,
            "DB_SSL_MODE": config.ssl_mode,
        }
        _write_env_file(env_data)
        return {"success": True, "message": "Konfigurasi PostgreSQL berhasil disimpan ke file .env"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan konfigurasi: {str(e)}")


@router.post("/test-connection")
def test_connection(config: PostgresConfig):
    """Test PostgreSQL connection without switching the active database."""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=config.host,
            port=config.port,
            dbname=config.database,
            user=config.username,
            password=config.password,
            sslmode=config.ssl_mode,
            connect_timeout=5,
        )
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        cursor.execute("SELECT current_database(), current_user;")
        db_info = cursor.fetchone()
        conn.close()

        return {
            "success": True,
            "message": "Koneksi ke PostgreSQL berhasil!",
            "details": {
                "version": version,
                "database": db_info[0],
                "user": db_info[1],
            }
        }
    except ImportError:
        return {
            "success": False,
            "message": "Library psycopg2 belum terinstal. Jalankan: pip install psycopg2-binary",
            "details": {"error_type": "missing_dependency"}
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Koneksi gagal: {str(e)}",
            "details": {"error_type": "connection_error", "error": str(e)}
        }


@router.post("/activate-postgresql")
def activate_postgresql(config: PostgresConfig):
    """Switch the active database engine to PostgreSQL (requires restart)."""
    # First test the connection
    test = test_connection(config)
    if not test.get("success"):
        raise HTTPException(
            status_code=400,
            detail=f"Tidak dapat beralih ke PostgreSQL: {test.get('message')}"
        )

    try:
        env_data = {
            "DB_ENGINE": "postgresql",
            "DB_HOST": config.host,
            "DB_PORT": str(config.port),
            "DB_NAME": config.database,
            "DB_USER": config.username,
            "DB_PASSWORD": config.password,
            "DB_SSL_MODE": config.ssl_mode,
        }
        _write_env_file(env_data)
        return {
            "success": True,
            "message": "Database engine diubah ke PostgreSQL. Restart server untuk menerapkan perubahan.",
            "requires_restart": True,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/revert-sqlite")
def revert_to_sqlite():
    """Revert back to SQLite engine."""
    try:
        env_config = _read_env_file()
        env_config["DB_ENGINE"] = "sqlite"
        _write_env_file(env_config)
        return {
            "success": True,
            "message": "Database engine dikembalikan ke SQLite. Restart server untuk menerapkan.",
            "requires_restart": True,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sqlite-tables")
def get_sqlite_tables():
    """Get detailed SQLite table information for migration preview."""
    stats = _get_sqlite_stats()
    if not stats["exists"]:
        return {"tables": [], "total_records": 0}

    total = sum(v for v in stats["tables"].values() if v >= 0)
    tables_list = [
        {"name": name, "record_count": count}
        for name, count in sorted(stats["tables"].items())
    ]

    return {
        "tables": tables_list,
        "total_records": total,
        "db_size_mb": stats["size_mb"],
    }
