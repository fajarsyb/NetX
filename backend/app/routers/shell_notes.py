import json
import secrets
import uuid
import zipfile
import io
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db_conn
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/shell-notes", tags=["shell-notes"])


# ─── Pydantic Models ────────────────────────────────────────────────────────

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


class FolderUpdate(BaseModel):
    name: str


class TemplateCreate(BaseModel):
    folder_id: Optional[int] = None
    title: str
    content: str = ""
    description: str = ""
    vendor_hint: str = ""
    variables: List[str] = []
    tags: List[str] = []


class TemplateUpdate(BaseModel):
    folder_id: Optional[int] = None
    title: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    vendor_hint: Optional[str] = None
    variables: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    is_favorite: Optional[int] = None


# ─── Helper ─────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().isoformat()


def _extract_variables(content: str) -> List[str]:
    """Extract {{variable}} placeholders from template content."""
    import re
    return list(set(re.findall(r"\{\{(\w+)\}\}", content)))


# ─── FOLDER ROUTES ───────────────────────────────────────────────────────────

@router.get("/folders")
def list_folders(current_user=Depends(get_current_user)):
    """Return all folders as a flat list (client builds tree)."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT f.id, f.name, f.parent_id, f.created_at,
               u.username as created_by_name
        FROM shell_notes_folders f
        LEFT JOIN users u ON f.created_by = u.id
        ORDER BY f.parent_id NULLS FIRST, f.name
    """)
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/folders")
def create_folder(body: FolderCreate, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    user_id = current_user.get("id") or current_user.get("sub")
    c.execute(
        "INSERT INTO shell_notes_folders (name, parent_id, created_by, created_at) VALUES (?, ?, ?, ?)",
        (body.name, body.parent_id, user_id, _now()),
    )
    conn.commit()
    folder_id = c.lastrowid
    conn.close()
    return {"id": folder_id, "name": body.name, "parent_id": body.parent_id}


@router.put("/folders/{folder_id}")
def update_folder(folder_id: int, body: FolderUpdate, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("UPDATE shell_notes_folders SET name = ? WHERE id = ?", (body.name, folder_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("DELETE FROM shell_notes_folders WHERE id = ?", (folder_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ─── TEMPLATE ROUTES ─────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates(
    folder_id: Optional[int] = None,
    favorites_only: bool = False,
    search: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    conn = get_db_conn()
    c = conn.cursor()

    wheres = []
    params = []

    if folder_id is not None:
        wheres.append("t.folder_id = ?")
        params.append(folder_id)
    if favorites_only:
        wheres.append("t.is_favorite = 1")
    if search:
        wheres.append("(t.title LIKE ? OR t.content LIKE ? OR t.description LIKE ?)")
        like = f"%{search}%"
        params += [like, like, like]

    where_clause = ("WHERE " + " AND ".join(wheres)) if wheres else ""

    c.execute(f"""
        SELECT t.id, t.folder_id, t.title, t.content, t.description,
               t.vendor_hint, t.is_favorite, t.is_shared, t.shared_token,
               t.variables, t.tags, t.created_at, t.updated_at,
               u.username as created_by_name
        FROM shell_notes_templates t
        LEFT JOIN users u ON t.created_by = u.id
        {where_clause}
        ORDER BY t.is_favorite DESC, t.title
    """, params if params else None)
    rows = c.fetchall()
    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        d["variables"] = json.loads(d.get("variables") or "[]")
        d["tags"] = json.loads(d.get("tags") or "[]")
        result.append(d)
    return result


@router.get("/templates/{template_id}")
def get_template(template_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT t.*, u.username as created_by_name
        FROM shell_notes_templates t
        LEFT JOIN users u ON t.created_by = u.id
        WHERE t.id = ?
    """, (template_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    d = dict(row)
    d["variables"] = json.loads(d.get("variables") or "[]")
    d["tags"] = json.loads(d.get("tags") or "[]")
    return d


@router.post("/templates")
def create_template(body: TemplateCreate, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    user_id = current_user.get("id") or current_user.get("sub")
    now = _now()

    # Auto-extract variables if none provided
    variables = body.variables if body.variables else _extract_variables(body.content)

    c.execute("""
        INSERT INTO shell_notes_templates
            (folder_id, title, content, description, vendor_hint,
             variables, tags, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        body.folder_id, body.title, body.content, body.description,
        body.vendor_hint, json.dumps(variables), json.dumps(body.tags),
        user_id, now, now,
    ))
    conn.commit()
    template_id = c.lastrowid
    conn.close()
    return {"id": template_id, "title": body.title, "variables": variables}


@router.put("/templates/{template_id}")
def update_template(template_id: int, body: TemplateUpdate, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()

    # Fetch current
    c.execute("SELECT * FROM shell_notes_templates WHERE id = ?", (template_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Template not found")

    r = dict(row)
    now = _now()
    new_content = body.content if body.content is not None else r["content"]
    variables = body.variables if body.variables is not None else _extract_variables(new_content)

    c.execute("""
        UPDATE shell_notes_templates SET
            folder_id   = ?,
            title       = ?,
            content     = ?,
            description = ?,
            vendor_hint = ?,
            variables   = ?,
            tags        = ?,
            is_favorite = ?,
            updated_at  = ?
        WHERE id = ?
    """, (
        body.folder_id if body.folder_id is not None else r["folder_id"],
        body.title if body.title is not None else r["title"],
        new_content,
        body.description if body.description is not None else r["description"],
        body.vendor_hint if body.vendor_hint is not None else r["vendor_hint"],
        json.dumps(variables),
        json.dumps(body.tags) if body.tags is not None else r["tags"],
        body.is_favorite if body.is_favorite is not None else r["is_favorite"],
        now,
        template_id,
    ))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("DELETE FROM shell_notes_templates WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/templates/{template_id}/duplicate")
def duplicate_template(template_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    user_id = current_user.get("id") or current_user.get("sub")
    c.execute("SELECT * FROM shell_notes_templates WHERE id = ?", (template_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Template not found")
    r = dict(row)
    now = _now()
    c.execute("""
        INSERT INTO shell_notes_templates
            (folder_id, title, content, description, vendor_hint,
             variables, tags, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        r["folder_id"], f"Copy of {r['title']}", r["content"],
        r["description"], r["vendor_hint"], r["variables"], r["tags"],
        user_id, now, now,
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return {"id": new_id, "title": f"Copy of {r['title']}"}


@router.post("/templates/{template_id}/favorite")
def toggle_favorite(template_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT is_favorite FROM shell_notes_templates WHERE id = ?", (template_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Template not found")
    new_val = 0 if row["is_favorite"] else 1
    c.execute("UPDATE shell_notes_templates SET is_favorite = ? WHERE id = ?", (new_val, template_id))
    conn.commit()
    conn.close()
    return {"is_favorite": new_val}


@router.post("/templates/{template_id}/share")
def share_template(template_id: int, current_user=Depends(get_current_user)):
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT shared_token FROM shell_notes_templates WHERE id = ?", (template_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Template not found")
    token = row["shared_token"] or secrets.token_hex(16)
    c.execute(
        "UPDATE shell_notes_templates SET is_shared = 1, shared_token = ? WHERE id = ?",
        (token, template_id),
    )
    conn.commit()
    conn.close()
    return {"shared_token": token}


@router.get("/shared/{token}")
def get_shared_template(token: str):
    """Public endpoint for viewing a shared template (no auth required)."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute(
        "SELECT * FROM shell_notes_templates WHERE shared_token = ? AND is_shared = 1",
        (token,),
    )
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Shared template not found or sharing disabled")
    d = dict(row)
    d["variables"] = json.loads(d.get("variables") or "[]")
    d["tags"] = json.loads(d.get("tags") or "[]")
    return d


# ─── IMPORT / EXPORT ─────────────────────────────────────────────────────────

@router.get("/export")
def export_all(current_user=Depends(get_current_user)):
    """Export all folders and templates as a JSON zip archive."""
    conn = get_db_conn()
    c = conn.cursor()

    c.execute("SELECT * FROM shell_notes_folders ORDER BY id")
    folders = [dict(r) for r in c.fetchall()]

    c.execute("SELECT * FROM shell_notes_templates ORDER BY id")
    templates = []
    for r in c.fetchall():
        d = dict(r)
        d["variables"] = json.loads(d.get("variables") or "[]")
        d["tags"] = json.loads(d.get("tags") or "[]")
        templates.append(d)

    conn.close()

    payload = json.dumps({"folders": folders, "templates": templates}, indent=2)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("shell_notes_export.json", payload)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=shell_notes_export.zip"},
    )


@router.post("/import")
def import_notes(file: UploadFile = File(...), current_user=Depends(get_current_user)):
    """Import folders and templates from a previously exported JSON zip."""
    user_id = current_user.get("id") or current_user.get("sub")
    content = file.file.read()
    try:
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf, "r") as zf:
            data = json.loads(zf.read("shell_notes_export.json"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid import file. Expected a valid shell_notes_export.zip.")

    conn = get_db_conn()
    c = conn.cursor()
    now = _now()

    # Import folders, track old_id -> new_id
    folder_id_map = {}
    for folder in data.get("folders", []):
        old_id = folder["id"]
        c.execute(
            "INSERT INTO shell_notes_folders (name, parent_id, created_by, created_at) VALUES (?, ?, ?, ?)",
            (folder["name"], None, user_id, now),
        )
        conn.commit()
        folder_id_map[old_id] = c.lastrowid

    # Fix parent_ids
    for folder in data.get("folders", []):
        if folder.get("parent_id") and folder["parent_id"] in folder_id_map:
            c.execute(
                "UPDATE shell_notes_folders SET parent_id = ? WHERE id = ?",
                (folder_id_map[folder["parent_id"]], folder_id_map[folder["id"]]),
            )
    conn.commit()

    # Import templates
    imported = 0
    for tmpl in data.get("templates", []):
        new_folder_id = folder_id_map.get(tmpl.get("folder_id")) if tmpl.get("folder_id") else None
        variables = tmpl.get("variables", [])
        if isinstance(variables, list):
            variables = json.dumps(variables)
        tags = tmpl.get("tags", [])
        if isinstance(tags, list):
            tags = json.dumps(tags)
        c.execute("""
            INSERT INTO shell_notes_templates
                (folder_id, title, content, description, vendor_hint,
                 variables, tags, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_folder_id, tmpl["title"], tmpl.get("content", ""),
            tmpl.get("description", ""), tmpl.get("vendor_hint", ""),
            variables, tags, user_id, now, now,
        ))
        imported += 1

    conn.commit()
    conn.close()
    return {"imported_folders": len(folder_id_map), "imported_templates": imported}
