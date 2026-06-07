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

    # Fetch device
    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        await websocket.send_text("\r\n[Error] Device not found.\r\n")
        await websocket.close()
        return

    device = dict(row)
    username, password = get_device_credentials(device)
    device["username"] = username

    if device.get("protocol", "ssh").lower() != "ssh":
        await websocket.send_text("\r\n[Error] Web CLI is currently only supported for SSH devices.\r\n")
        await websocket.close()
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
    except Exception as e:
        await websocket.send_text(f"\r\n[Error] SSH Connection failed: {e}\r\n")
        await websocket.close()
        return

    await websocket.send_text("Connected! Opening terminal...\r\n\r\n")

    try:
        # Open interactive shell
        channel = client.invoke_shell(term='xterm', width=100, height=30)
        channel.settimeout(0.0) # non-blocking

        # Start bidirectional forwarding
        task_out = asyncio.create_task(forward_out(channel, websocket))
        task_in = asyncio.create_task(forward_in(websocket, channel))

        await asyncio.gather(task_out, task_in)
    finally:
        client.close()
