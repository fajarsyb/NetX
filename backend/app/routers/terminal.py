import asyncio
import paramiko
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.auth import decode_token
from app.database import get_db_conn, decrypt_password, get_device_credentials

logger = logging.getLogger("netx.terminal")
router = APIRouter(prefix="/api/terminal", tags=["terminal"])

async def forward_out(channel: paramiko.Channel, websocket: WebSocket):
    """Read from paramiko channel and send to websocket."""
    try:
        while True:
            # Non-blocking read check
            if channel.recv_ready():
                data = channel.recv(4096)
                if not data:
                    break
                await websocket.send_text(data.decode("utf-8", errors="replace"))
            else:
                await asyncio.sleep(0.01)
                if channel.exit_status_ready():
                    break
    except Exception as e:
        logger.error(f"Error forwarding out: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

async def forward_in(websocket: WebSocket, channel: paramiko.Channel):
    """Read from websocket and write to paramiko channel."""
    try:
        while True:
            data = await websocket.receive_text()
            channel.send(data.encode("utf-8"))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Error forwarding in: {e}")
    finally:
        channel.close()

# Global tracker for active user sessions
active_ssh_sessions = {}
ssh_sessions_lock = asyncio.Lock()

@router.websocket("/ws/{device_id}")
async def websocket_terminal(websocket: WebSocket, device_id: int, token: str):
    await websocket.accept()

    # Authenticate via token query param
    try:
        user_payload = decode_token(token)
    except Exception:
        await websocket.send_text("\r\n[Error] Invalid or expired token.\r\n")
        await websocket.close()
        return

    user_id = int(user_payload.get("sub", 0))
    if not user_id:
        await websocket.send_text("\r\n[Error] Token tidak valid.\r\n")
        await websocket.close()
        return

    # Fetch user details & permissions
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, role, is_active, permissions FROM users WHERE id = ?", (user_id,))
    user_row = c.fetchone()
    conn.close()

    if not user_row or not user_row["is_active"]:
        await websocket.send_text("\r\n[Error] Akun tidak aktif atau tidak ditemukan.\r\n")
        await websocket.close()
        return

    # Parse permissions
    import json
    perms = None
    perms_str = user_row.get("permissions")
    if perms_str:
        try:
            perms = json.loads(perms_str)
        except Exception:
            pass

    if not perms:
        # Default fallback by role
        role = user_row["role"]
        if role in ("admin", "operator"):
            perms = {
                "allow_ssh": True,
                "groups": ["*"]
            }
        else:
            perms = {
                "allow_ssh": False,
                "groups": ["*"]
            }

    if not perms.get("allow_ssh", False):
        await websocket.send_text("\r\n[Error] Akses SSH Ditolak: Anda tidak memiliki izin untuk mengakses terminal.\r\n")
        await websocket.close()
        return

    # Apply 8 connections concurrency limit
    async with ssh_sessions_lock:
        user_conns = active_ssh_sessions.setdefault(user_id, set())
        if len(user_conns) >= 8:
            await websocket.send_text("\r\n[Error] Koneksi Ditolak: Anda telah mencapai batas maksimal 8 sesi SSH aktif.\r\n")
            await websocket.close()
            return
        session_id = id(websocket)
        user_conns.add(session_id)

    client = None
    try:
        # Fetch device
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
        row = c.fetchone()
        conn.close()

        if not row:
            await websocket.send_text("\r\n[Error] Perangkat tidak ditemukan.\r\n")
            return

        device = dict(row)

        # Apply group-based access control
        allowed_groups = perms.get("groups", ["*"])
        if "*" not in allowed_groups:
            conn = get_db_conn()
            c = conn.cursor()
            c.execute("""
                SELECT dg.name as group_name
                FROM devices d
                LEFT JOIN device_groups dg ON d.group_id = dg.id
                WHERE d.id = ?
            """, (device_id,))
            dg_row = c.fetchone()
            conn.close()
            dev_group = (dg_row["group_name"] or "Ungrouped") if dg_row else "Ungrouped"
            
            if dev_group not in allowed_groups:
                await websocket.send_text("\r\n[Error] Akses Ditolak: Anda tidak diizinkan mengakses perangkat di grup ini.\r\n")
                return

        username, password = get_device_credentials(device)
        device["username"] = username

        if device.get("protocol", "ssh").lower() != "ssh":
            await websocket.send_text("\r\n[Error] Web CLI saat ini hanya didukung untuk perangkat protokol SSH.\r\n")
            return

        await websocket.send_text(f"Connecting to {device['ip']} via SSH...\r\n")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            # Run connect in background thread so we don't block the event loop
            await asyncio.to_thread(
                client.connect,
                hostname=device["ip"],
                port=device.get("port", 22) or 22,
                username=device.get("username", ""),
                password=password,
                look_for_keys=False,
                allow_agent=False,
                timeout=15,
            )

            await websocket.send_text("Connected! Opening terminal...\r\n\r\n")

            # Open interactive shell
            channel = client.invoke_shell(term='xterm', width=100, height=30)
            channel.settimeout(0.0) # non-blocking

            # Start bidirectional forwarding
            task_out = asyncio.create_task(forward_out(channel, websocket))
            task_in = asyncio.create_task(forward_in(websocket, channel))

            await asyncio.gather(task_out, task_in)
        except paramiko.ssh_exception.AuthenticationException:
            err_msg = "Authentication failed: Username atau password salah."
            logger.warning(f"SSH Auth failed for device {device['name']} ({device['ip']})")
            await websocket.send_text(f"\r\n[Error] SSH Connection failed: {err_msg}\r\n")
        except paramiko.ssh_exception.SSHException as ssh_err:
            err_msg = f"Protokol/Negosiasi SSH gagal: {ssh_err}"
            logger.warning(f"SSH negotiation failed for device {device['name']} ({device['ip']}): {ssh_err}")
            await websocket.send_text(f"\r\n[Error] SSH Connection failed: {err_msg}\r\n")
        except Exception as e:
            err_msg = f"Koneksi gagal / unreachable: {e}"
            logger.warning(f"SSH Connection to {device['name']} ({device['ip']}) failed: {e}")
            await websocket.send_text(f"\r\n[Error] SSH Connection failed: {err_msg}\r\n")
            
    finally:
        # Always remove session lock
        async with ssh_sessions_lock:
            if user_id in active_ssh_sessions:
                active_ssh_sessions[user_id].discard(session_id)
                if not active_ssh_sessions[user_id]:
                    del active_ssh_sessions[user_id]
        if client:
            client.close()
        try:
            await asyncio.sleep(0.2)  # Give client xterm time to receive final messages
            await websocket.close()
        except Exception:
            pass
