from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from app.core.rate_limit import RateLimiter
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database import get_db_conn
from app.services.auth import (
    hash_password, verify_password,
    create_access_token,
    get_current_user, require_admin,
)
from app.services.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


from typing import Dict, Any

# ─── SCHEMAS ─────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    username:  str
    password:  str
    full_name: str  = ""
    role:      str  = "user"
    permissions: Optional[Dict[str, Any]] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role:      Optional[str] = None
    is_active: Optional[int] = None
    permissions: Optional[Dict[str, Any]] = None

class PasswordChange(BaseModel):
    current_password: str
    new_password:     str


# ─── LOGIN ────────────────────────────────────────────────────────────────────
@router.post("/login", dependencies=[Depends(RateLimiter(limit=10, window=60, name="login"))])
async def login(form: OAuth2PasswordRequestForm = Depends()):
    """Return JWT access token. Uses standard OAuth2 form (username + password)."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE username = ?", (form.username,))
    row = c.fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="Username atau password salah.")
    user = dict(row)

    if not verify_password(form.password, user["password"]):
        raise HTTPException(status_code=401, detail="Username atau password salah.")

    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan. Hubungi administrator.")

    import json
    perms_str = user.get("permissions")
    perms = None
    if perms_str:
        try:
            perms = json.loads(perms_str)
        except Exception:
            pass

    token = create_access_token({"sub": str(user["id"]), "role": user["role"]})
    log_audit(user["id"], user["username"], "LOGIN", "Authentication", f"User logged in successfully.")
    return {
        "access_token": token,
        "token_type":   "bearer",
        "user": {
            "id":        user["id"],
            "username":  user["username"],
            "full_name": user["full_name"],
            "role":      user["role"],
            "permissions": perms
        },
    }


# ─── CURRENT USER ─────────────────────────────────────────────────────────────
@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    """Return info about the currently logged-in user."""
    return current_user


# ─── CHANGE OWN PASSWORD ──────────────────────────────────────────────────────
@router.post("/change-password", dependencies=[Depends(RateLimiter(limit=5, window=60, name="change-password"))])
async def change_password(
    body: PasswordChange,
    current_user: dict = Depends(get_current_user),
):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT password FROM users WHERE id = ?", (current_user["id"],))
    row = c.fetchone()

    if not row or not verify_password(body.current_password, row["password"]):
        conn.close()
        raise HTTPException(status_code=400, detail="Password lama tidak sesuai.")

    if len(body.new_password) < 6:
        conn.close()
        raise HTTPException(status_code=400, detail="Password baru minimal 6 karakter.")

    c.execute(
        "UPDATE users SET password = ? WHERE id = ?",
        (hash_password(body.new_password), current_user["id"]),
    )
    conn.commit()
    conn.close()
    log_audit(current_user["id"], current_user["username"], "CHANGE_PASSWORD", f"users/{current_user['id']}", "Changed own password.")
    return {"success": True, "message": "Password berhasil diubah."}


# ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────
@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id, username, full_name, role, is_active, permissions, created_at
        FROM users ORDER BY id
    """)
    raw_rows = [dict(r) for r in c.fetchall()]
    conn.close()

    import json
    rows = []
    for row in raw_rows:
        perms_str = row.pop("permissions", None)
        perms = None
        if perms_str:
            try:
                perms = json.loads(perms_str)
            except Exception:
                pass
        row["permissions"] = perms
        rows.append(row)
    return rows


@router.post("/users")
async def create_user(body: UserCreate, admin: dict = Depends(require_admin)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter.")
    if body.role not in ("admin", "operator", "viewer"):
        raise HTTPException(status_code=400, detail="Role harus 'admin', 'operator', atau 'viewer'.")

    import json
    perms_json = json.dumps(body.permissions) if body.permissions is not None else None

    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users (username, password, full_name, role, permissions, created_at) VALUES (?,?,?,?,?,?)",
            (body.username, hash_password(body.password), body.full_name, body.role, perms_json, datetime.now().isoformat()),
        )
        conn.commit()
        uid = c.lastrowid
        conn.close()
        log_audit(admin["id"], admin["username"], "CREATE_USER", f"users/{uid}", f"Created user '{body.username}' with role '{body.role}'.")
        return {"success": True, "user_id": uid, "message": f"User '{body.username}' berhasil dibuat."}
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=409, detail=f"Username '{body.username}' sudah digunakan.")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{user_id}")
async def update_user(user_id: int, body: UserUpdate, admin: dict = Depends(require_admin)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="User tidak ditemukan.")

    updates = body.dict(exclude_none=True)
    if not updates:
        conn.close()
        return {"success": True, "message": "Tidak ada perubahan."}

    if "role" in updates and updates["role"] not in ("admin", "operator", "viewer"):
        conn.close()
        raise HTTPException(status_code=400, detail="Role harus 'admin', 'operator', atau 'viewer'.")

    if "permissions" in updates:
        import json
        updates["permissions"] = json.dumps(updates["permissions"]) if updates["permissions"] else None

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [user_id]
    c.execute(f"UPDATE users SET {set_clause} WHERE id = ?", vals)
    conn.commit()
    conn.close()
    log_audit(admin["id"], admin["username"], "UPDATE_USER", f"users/{user_id}", f"Updated user fields: {', '.join(updates.keys())}.")
    return {"success": True, "message": "User berhasil diupdate."}


@router.put("/users/{user_id}/reset-password", dependencies=[Depends(RateLimiter(limit=5, window=60, name="reset-password"))])
async def reset_password(user_id: int, body: dict, admin: dict = Depends(require_admin)):
    """Admin reset password for any user."""
    new_pass = body.get("new_password", "")
    if len(new_pass) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter.")

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE id = ?", (user_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="User tidak ditemukan.")

    c.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(new_pass), user_id))
    conn.commit()
    conn.close()
    log_audit(admin["id"], admin["username"], "RESET_PASSWORD", f"users/{user_id}", "Admin reset user password.")
    return {"success": True, "message": "Password berhasil direset."}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    # Prevent self-deletion
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri.")

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    affected = c.rowcount
    conn.close()

    if affected == 0:
        raise HTTPException(status_code=404, detail="User tidak ditemukan.")
    log_audit(admin["id"], admin["username"], "DELETE_USER", f"users/{user_id}", f"Deleted user ID {user_id}.")
    return {"success": True, "message": "User berhasil dihapus."}
