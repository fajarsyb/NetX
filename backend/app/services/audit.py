from datetime import datetime
from app.database import get_db_conn

def log_audit(user_id: int, username: str, action: str, target: str, details: str = ""):
    conn = get_db_conn()
    c = conn.cursor()
    try:
        c.execute("""
            INSERT INTO audit_logs (user_id, username, action, target, details, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, username, action, target, details, datetime.now().isoformat()))
        conn.commit()
    except Exception as e:
        print(f"Error logging audit action: {e}")
    finally:
        conn.close()
