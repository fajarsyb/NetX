"""
JWT Authentication Service for NetX.

- Password hashing via passlib/bcrypt
- JWT access tokens via python-jose
- FastAPI dependency: get_current_user, require_admin
"""

import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
import bcrypt

from app.database import get_db_conn

# ─── CONFIG ─────────────────────────────────────────────────────────────────
TOKEN_EXPIRE_HOURS = 8
ALGORITHM = "HS256"
KEY_PATH = os.path.join("data", "jwt_secret.key")
SECRET_KEY_PATH = os.path.join("data", "jwt_secret.key")

os.makedirs("data", exist_ok=True)


def _get_or_create_jwt_secret() -> str:
    if os.path.exists(SECRET_KEY_PATH):
        with open(SECRET_KEY_PATH, "r") as f:
            return f.read().strip()
    secret = secrets.token_hex(64)
    with open(SECRET_KEY_PATH, "w") as f:
        f.write(secret)
    return secret


JWT_SECRET = _get_or_create_jwt_secret()

# ─── PASSWORD HASHING ────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(plain.encode('utf-8'), salt)
    return hashed_bytes.decode('utf-8')

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))
    except ValueError:
        return False


# ─── JWT TOKENS ──────────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_hours: int = TOKEN_EXPIRE_HOURS) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=expires_hours)
    payload["iat"] = datetime.utcnow()
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid atau sudah kedaluwarsa.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ─── FASTAPI DEPENDENCIES ────────────────────────────────────────────────────
security = HTTPBearer()


import json

def get_user_permissions(user: dict) -> dict:
    """Resolve permissions for a user, using custom permissions JSON or falling back to role defaults."""
    perms_str = user.get("permissions")
    if perms_str:
        try:
            perms = json.loads(perms_str)
            if isinstance(perms, dict):
                return perms
        except Exception:
            pass

    # Fallback default permissions based on role
    role = user.get("role", "viewer")
    if role == "admin":
        return {
            "menus": ["dashboard", "topology", "investigation", "anomalies", "syslog", "groups", "devices", "audit_logs", "settings", "terminal"],
            "features": ["add_device", "edit_device", "delete_device", "manage_groups", "manage_credentials", "backup_db", "postgresql_config", "threshold_profiles", "snmp_tester", "mibs", "device_backup", "system_settings"],
            "groups": ["*"],
            "allow_ssh": True
        }
    elif role == "operator":
        return {
            "menus": ["dashboard", "topology", "investigation", "anomalies", "syslog", "groups", "devices", "settings", "terminal"],
            "features": ["add_device", "edit_device", "threshold_profiles", "snmp_tester", "mibs", "device_backup", "system_settings"],
            "groups": ["*"],
            "allow_ssh": True
        }
    else: # viewer / fallback
        return {
            "menus": ["dashboard", "topology", "anomalies", "syslog"],
            "features": [],
            "groups": ["*"],
            "allow_ssh": False
        }


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Dependency: validate token and return user dict with resolved permissions."""
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token tidak valid.")

    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        "SELECT id, username, full_name, role, is_active, permissions FROM users WHERE id = ?",
        (int(user_id),),
    )
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="User tidak ditemukan.")
    user = dict(row)
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan.")
    
    # Enrich user dict with parsed permissions
    user["permissions"] = get_user_permissions(user)
    return user


def require_operator_or_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: ensure user is admin, operator, or legacy user role."""
    if current_user["role"] not in ("admin", "operator", "user"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hanya administrator atau operator yang diizinkan melakukan tindakan ini."
        )
    return current_user


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency: ensure current user is admin."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hanya admin yang diizinkan.")
    return current_user


def require_permission(menu: Optional[str] = None, feature: Optional[str] = None):
    """Dependency factory: check if current user has the specified menu or feature permission."""
    def dependency(current_user: dict = Depends(get_current_user)) -> dict:
        perms = current_user.get("permissions") or {}
        
        # If user is admin (role-wise), bypass check for ease of admin operations
        if current_user.get("role") == "admin":
            return current_user
            
        if menu and menu not in perms.get("menus", []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Akses Ditolak: Anda tidak memiliki akses ke menu '{menu}'."
            )
            
        if feature and feature not in perms.get("features", []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Akses Ditolak: Anda tidak memiliki izin untuk tindakan '{feature}'."
            )
            
        return current_user
    return dependency
