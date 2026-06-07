from fastapi import APIRouter, Query, Depends
from app.services.auth import require_operator_or_admin
from app.database import get_db_conn
from typing import Optional, List
from pydantic import BaseModel

class Position(BaseModel):
    node_id: str
    x: float
    y: float

router = APIRouter(prefix="/api/topology", tags=["topology"])

@router.get("")
async def get_topology(group_id: Optional[int] = Query(None)):
    """
    Builds a network topology graph from managed devices and their LLDP/CDP neighbors.
    Returns: { "nodes": [...], "edges": [...] }
    """
    conn = get_db_conn()
    c = conn.cursor()

    # 1. Fetch managed devices
    device_query = """
        SELECT id, name, ip, device_type, status 
        FROM devices
    """
    params = []
    if group_id:
        device_query += " WHERE group_id = ?"
        params.append(group_id)
        
    c.execute(device_query, params)
    devices = [dict(r) for r in c.fetchall()]

    # Map IP to managed device ID for quick correlation
    managed_ips = {d["ip"]: d["id"] for d in devices}
    managed_ids = {d["id"]: d for d in devices}

    nodes = []
    edges = []
    edge_set = set() # To prevent duplicate edges A->B and B->A

    def add_edge(source_id, target_id, label, method):
        # Sort IDs to avoid A->B and B->A duplicates if they both see each other
        link_id = f"{min(source_id, target_id)}_{max(source_id, target_id)}_{method}"
        if link_id not in edge_set:
            edge_set.add(link_id)
            edges.append({
                "id": link_id,
                "from": source_id,
                "to": target_id,
                "label": label,
                "method": method
            })

    # 2. Fetch Saved Positions
    c.execute("SELECT node_id, x, y FROM topology_positions")
    positions = {row["node_id"]: {"x": row["x"], "y": row["y"]} for row in c.fetchall()}

    # Add Managed Nodes
    for d in devices:
        node_id = f"managed_{d['id']}"
        node_data = {
            "id": node_id,
            "label": d["name"],
            "title": f"IP: {d['ip']}<br>Type: {d['device_type']}<br>Status: {d['status']}",
            "group": "managed",
            "shape": "box",
            "device_id": d["id"],
            "ip": d["ip"],
            "status": d["status"],
            "device_type": d["device_type"]
        }
        if node_id in positions:
            node_data["x"] = positions[node_id]["x"]
            node_data["y"] = positions[node_id]["y"]
        nodes.append(node_data)

    # Fetch LLDP Neighbors
    if group_id:
        c.execute("""
            SELECT l.device_id, l.neighbor_ip, l.neighbor_name, l.local_port, l.neighbor_port 
            FROM lldp_neighbors l
            JOIN devices d ON l.device_id = d.id
            WHERE d.group_id = ?
        """, (group_id,))
    else:
        c.execute("SELECT device_id, neighbor_ip, neighbor_name, local_port, neighbor_port FROM lldp_neighbors")
    
    lldp_rows = c.fetchall()

    # Fetch CDP Neighbors
    if group_id:
        c.execute("""
            SELECT c.device_id, c.neighbor_ip, c.neighbor_name, c.local_port, c.neighbor_port 
            FROM cdp_neighbors c
            JOIN devices d ON c.device_id = d.id
            WHERE d.group_id = ?
        """, (group_id,))
    else:
        c.execute("SELECT device_id, neighbor_ip, neighbor_name, local_port, neighbor_port FROM cdp_neighbors")

    cdp_rows = c.fetchall()
    
    conn.close()

    unmanaged_counter = 1
    unmanaged_ip_map = {} # Map IP -> unmanaged node ID

    def process_neighbors(rows, method):
        nonlocal unmanaged_counter
        for r in rows:
            dev_id = r["device_id"]
            n_ip = r["neighbor_ip"]
            n_name = r["neighbor_name"]
            
            if not n_ip:
                continue # Skip if no IP

            source_node_id = f"managed_{dev_id}"
            
            # Check if neighbor is a managed device
            if n_ip in managed_ips:
                target_node_id = f"managed_{managed_ips[n_ip]}"
                # Only add if it's not the same device
                if source_node_id != target_node_id:
                    add_edge(source_node_id, target_node_id, f"{r['local_port']} ↔ {r['neighbor_port']}", method)
            else:
                # Unmanaged Device
                if n_ip not in unmanaged_ip_map:
                    target_node_id = f"unmanaged_{unmanaged_counter}"
                    unmanaged_ip_map[n_ip] = target_node_id
                    node_data = {
                        "id": target_node_id,
                        "label": n_name or n_ip,
                        "title": f"IP: {n_ip}<br>Unmanaged Neighbor",
                        "group": "unmanaged",
                        "shape": "ellipse",
                        "ip": n_ip
                    }
                    if target_node_id in positions:
                        node_data["x"] = positions[target_node_id]["x"]
                        node_data["y"] = positions[target_node_id]["y"]
                    nodes.append(node_data)
                    unmanaged_counter += 1
                else:
                    target_node_id = unmanaged_ip_map[n_ip]
                
                add_edge(source_node_id, target_node_id, f"{r['local_port']}", method)

    process_neighbors(lldp_rows, "LLDP")
    process_neighbors(cdp_rows, "CDP")

    return {
        "nodes": nodes,
        "edges": edges
    }

@router.post("/positions")
async def save_positions(positions: List[Position], user: dict = Depends(require_operator_or_admin)):
    """
    Saves x,y coordinates for nodes.
    """
    conn = get_db_conn()
    c = conn.cursor()
    
    for p in positions:
        c.execute("""
            INSERT INTO topology_positions (node_id, x, y)
            VALUES (?, ?, ?)
            ON CONFLICT(node_id) DO UPDATE SET x=excluded.x, y=excluded.y
        """, (p.node_id, p.x, p.y))
        
    conn.commit()
    conn.close()
    return {"success": True, "message": "Positions saved successfully"}
