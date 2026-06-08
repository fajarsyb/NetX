from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from app.database import get_db_conn
from app.models import ThresholdProfileCreate, ThresholdProfileUpdate
from app.services.auth import get_current_user, require_operator_or_admin
from app.services.audit import log_audit

router = APIRouter(prefix="/api/thresholds", tags=["thresholds"])

@router.get("")
async def list_profiles(current_user: dict = Depends(get_current_user)):
    """List all threshold profiles."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM threshold_profiles 
        ORDER BY name COLLATE NOCASE
    """)
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

@router.get("/{profile_id}")
async def get_profile(profile_id: int, current_user: dict = Depends(get_current_user)):
    """Get a specific threshold profile."""
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM threshold_profiles WHERE id = ?", (profile_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Profil threshold tidak ditemukan.")
    return dict(row)

@router.post("")
async def create_profile(
    profile: ThresholdProfileCreate,
    user: dict = Depends(require_operator_or_admin)
):
    """Create a new threshold profile."""
    conn = get_db_conn()
    c = conn.cursor()
    
    # Check uniqueness of name
    c.execute("SELECT id FROM threshold_profiles WHERE name = ?", (profile.name,))
    if c.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Profil threshold dengan nama tersebut sudah ada.")
        
    now = datetime.now().isoformat()
    try:
        c.execute("""
            INSERT INTO threshold_profiles (
                name, description, broadcast_storm_warning, broadcast_storm_critical,
                multicast_storm_warning, multicast_storm_critical,
                unicast_storm_warning, unicast_storm_critical,
                port_flap_warning, port_flap_critical, port_flap_window,
                crc_error_rate, crc_error_delta, frame_error_rate, frame_error_delta,
                transmission_error_rate, transmission_error_delta, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            profile.name, profile.description, profile.broadcast_storm_warning, profile.broadcast_storm_critical,
            profile.multicast_storm_warning, profile.multicast_storm_critical,
            profile.unicast_storm_warning, profile.unicast_storm_critical,
            profile.port_flap_warning, profile.port_flap_critical, profile.port_flap_window,
            profile.crc_error_rate, profile.crc_error_delta, profile.frame_error_rate, profile.frame_error_delta,
            profile.transmission_error_rate, profile.transmission_error_delta, now
        ))
        conn.commit()
        profile_id = c.lastrowid
        
        log_audit(user["id"], user["username"], "CREATE_THRESHOLD_PROFILE", f"thresholds/{profile_id}", f"Created profile: {profile.name}")
        return {"success": True, "profile_id": profile_id, "message": "Profil threshold berhasil dibuat."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.put("/{profile_id}")
async def update_profile(
    profile_id: int,
    profile: ThresholdProfileUpdate,
    user: dict = Depends(require_operator_or_admin)
):
    """Update an existing threshold profile."""
    conn = get_db_conn()
    c = conn.cursor()
    
    c.execute("SELECT * FROM threshold_profiles WHERE id = ?", (profile_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Profil threshold tidak ditemukan.")
        
    old_profile = dict(row)
    
    # Check name uniqueness if changed
    if profile.name is not None and profile.name != old_profile["name"]:
        c.execute("SELECT id FROM threshold_profiles WHERE name = ? AND id != ?", (profile.name, profile_id))
        if c.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="Profil threshold dengan nama tersebut sudah ada.")
            
    # Prepare dynamic update fields
    update_fields = []
    params = []
    
    for field, val in profile.dict(exclude_unset=True).items():
        update_fields.append(f"{field} = ?")
        params.append(val)
        
    if not update_fields:
        conn.close()
        return {"success": True, "message": "Tidak ada perubahan."}
        
    params.append(profile_id)
    query = f"UPDATE threshold_profiles SET {', '.join(update_fields)} WHERE id = ?"
    
    try:
        c.execute(query, params)
        conn.commit()
        
        log_audit(user["id"], user["username"], "UPDATE_THRESHOLD_PROFILE", f"thresholds/{profile_id}", f"Updated profile: {profile.name or old_profile['name']}")
        return {"success": True, "message": "Profil threshold berhasil diperbarui."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.delete("/{profile_id}")
async def delete_profile(
    profile_id: int,
    user: dict = Depends(require_operator_or_admin)
):
    """Delete a threshold profile."""
    conn = get_db_conn()
    c = conn.cursor()
    
    c.execute("SELECT name FROM threshold_profiles WHERE id = ?", (profile_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Profil threshold tidak ditemukan.")
        
    profile_name = row["name"]
    
    # Check if profile is currently assigned to any devices
    c.execute("SELECT COUNT(*) as cnt FROM devices WHERE threshold_profile_id = ?", (profile_id,))
    assigned_count = c.fetchone()["cnt"]
    if assigned_count > 0:
        conn.close()
        raise HTTPException(
            status_code=400, 
            detail=f"Profil threshold tidak dapat dihapus karena sedang digunakan oleh {assigned_count} perangkat."
        )
        
    try:
        c.execute("DELETE FROM threshold_profiles WHERE id = ?", (profile_id,))
        conn.commit()
        
        log_audit(user["id"], user["username"], "DELETE_THRESHOLD_PROFILE", f"thresholds/{profile_id}", f"Deleted profile: {profile_name}")
        return {"success": True, "message": "Profil threshold berhasil dihapus."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
