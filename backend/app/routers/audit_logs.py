from fastapi import APIRouter, Depends, Query
from app.database import get_db_conn
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])

@router.get("")
async def get_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    username: str = None,
    action: str = None,
    search: str = None,
    user: dict = Depends(get_current_user)
):
    conn = get_db_conn()
    c = conn.cursor()
    
    where_clauses = []
    params = []
    
    if username:
        where_clauses.append("username = ?")
        params.append(username)
    if action:
        where_clauses.append("action = ?")
        params.append(action)
    if search:
        where_clauses.append("(action LIKE ? OR username LIKE ? OR target LIKE ? OR details LIKE ?)")
        search_param = f"%{search}%"
        params.extend([search_param] * 4)
        
    where_str = ""
    if where_clauses:
        where_str = "WHERE " + " AND ".join(where_clauses)
        
    # Count total
    c.execute(f"SELECT COUNT(*) FROM audit_logs {where_str}", params)
    total = c.fetchone()[0]
    
    # Fetch rows
    offset = (page - 1) * limit
    c.execute(f"""
        SELECT id, user_id, username, action, target, details, timestamp
        FROM audit_logs
        {where_str}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    """, params + [limit, offset])
    
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "logs": rows
    }
