import asyncio
import paramiko
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from app.services.auth import decode_token
from app.database import get_db_conn, decrypt_password, get_device_credentials

logger = logging.getLogger("netx.terminal")
router = APIRouter(prefix="/api/terminal", tags=["terminal"])

@router.get("/serial-ports")
def list_serial_ports():
    import serial.tools.list_ports
    try:
        ports = serial.tools.list_ports.comports()
        result = []
        for p in ports:
            desc = (p.description or "").lower()
            mfg = (p.manufacturer or "").lower()
            hwid = (p.hwid or "").lower()
            device = (p.device or "").lower()
            
            # Common keywords indicating a USB-to-Serial / console adapter
            keywords = [
                "usb", "ftdi", "prolific", "ch340", "ch341", 
                "cp210", "silicon labs", "ft232", "console", 
                "pl2303", "moxa", "qinheng", "arduino"
            ]
            
            is_likely = False
            for kw in keywords:
                if kw in desc or kw in mfg or kw in hwid or kw in device:
                    is_likely = True
                    break
            
            # Check for Linux/macOS USB-to-Serial virtual device files
            if "ttyusb" in device or "ttyacm" in device or "cu.usb" in device or "tty.usb" in device:
                is_likely = True
                
            result.append({
                "port": p.device,
                "description": p.description or p.device,
                "manufacturer": p.manufacturer or "",
                "hwid": p.hwid or "",
                "vid": p.vid,
                "pid": p.pid,
                "is_likely_console": is_likely
            })
        return result
    except Exception as e:
        logger.error(f"Error listing serial ports: {e}")
        return []


async def forward_serial_out(ser, websocket):
    """Read from serial port and send to websocket."""
    try:
        while True:
            # Check if bytes are available on the serial port
            if ser.in_waiting > 0:
                data = ser.read(4096)
                if not data:
                    break
                await websocket.send_text(data.decode("utf-8", errors="replace"))
            else:
                await asyncio.sleep(0.01)
    except Exception as e:
        logger.error(f"Error in forward_serial_out: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

async def forward_serial_in(websocket, ser):
    """Read from websocket and write to serial port."""
    try:
        while True:
            data = await websocket.receive_text()
            ser.write(data.encode("utf-8"))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Error in forward_serial_in: {e}")
    finally:
        try:
            ser.close()
        except Exception:
            pass

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

# Global tracker for active serial port sessions
active_serial_sessions = {}
serial_sessions_lock = asyncio.Lock()

@router.websocket("/ws/serial/direct")
async def websocket_direct_serial(
    websocket: WebSocket,
    token: str = Query(...),
    port: str = Query(...),
    baudrate: int = Query(9600)
):
    await websocket.accept()

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

    conn = get_db_conn()
    c = conn.cursor()
    c.execute("SELECT id, role, is_active, permissions FROM users WHERE id = ?", (user_id,))
    user_row = c.fetchone()
    conn.close()

    if not user_row or not user_row["is_active"]:
        await websocket.send_text("\r\n[Error] Akun tidak aktif atau tidak ditemukan.\r\n")
        await websocket.close()
        return

    import json
    perms = None
    perms_str = user_row.get("permissions")
    if perms_str:
        try:
            perms = json.loads(perms_str)
        except Exception:
            pass

    if not perms:
        role = user_row["role"]
        if role in ("admin", "operator"):
            perms = {"allow_ssh": True}
        else:
            perms = {"allow_ssh": False}

    if not perms.get("allow_ssh", False):
        await websocket.send_text("\r\n[Error] Akses Ditolak: Anda tidak memiliki izin untuk mengakses terminal.\r\n")
        await websocket.close()
        return

    async with ssh_sessions_lock:
        user_conns = active_ssh_sessions.setdefault(user_id, set())
        if len(user_conns) >= 8:
            await websocket.send_text("\r\n[Error] Koneksi Ditolak: Anda telah mencapai batas maksimal 8 sesi SSH aktif.\r\n")
            await websocket.close()
            return
        session_id = id(websocket)
        user_conns.add(session_id)

    try:
        await websocket.send_text(f"Connecting to Direct Serial Port {port} @ {baudrate} baud...\r\n")

        # Check and close previous active session on this port
        async with serial_sessions_lock:
            if port in active_serial_sessions:
                old_ws, old_ser = active_serial_sessions[port]
                try:
                    await old_ws.send_text("\r\n[System] Sesi ditutup karena port ini diambil alih oleh koneksi baru.\r\n")
                    await old_ws.close()
                except Exception:
                    pass
                try:
                    old_ser.close()
                except Exception:
                    pass
                # A brief pause to let the operating system release the port
                await asyncio.sleep(0.5)

        try:
            import serial
            ser = await asyncio.to_thread(
                serial.Serial,
                port=port,
                baudrate=baudrate,
                timeout=0.1
            )

            # Register current session
            async with serial_sessions_lock:
                active_serial_sessions[port] = (websocket, ser)

            await websocket.send_text("Connected to direct serial port! Console ready.\r\n\r\n")
            task_out = asyncio.create_task(forward_serial_out(ser, websocket))
            task_in = asyncio.create_task(forward_serial_in(websocket, ser))
            try:
                await asyncio.gather(task_out, task_in)
            finally:
                for t in (task_out, task_in):
                    if not t.done():
                        t.cancel()
            return
        except Exception as e:
            err_str = str(e)
            tip = ""
            if "permission denied" in err_str.lower() or "permissionerror" in err_str.lower() or "errno 13" in err_str.lower():
                tip = " (Tip: Pastikan user Anda terdaftar dalam group 'dialout' atau 'uucp', atau jika menggunakan Docker, pastikan kontainer dijalankan dengan opsi privileged=true dan volume /dev terpeta)."
            err_msg = f"Gagal membuka direct serial port {port}: {e}{tip}"
            logger.error(err_msg)
            await websocket.send_text(f"\r\n[Error] {err_msg}\r\n")
            return
    finally:
        # Deregister direct serial session if matches
        async with serial_sessions_lock:
            if port in active_serial_sessions and active_serial_sessions[port][0] == websocket:
                del active_serial_sessions[port]

        async with ssh_sessions_lock:
            if user_id in active_ssh_sessions:
                active_ssh_sessions[user_id].discard(session_id)
                if not active_ssh_sessions[user_id]:
                    del active_ssh_sessions[user_id]
        try:
            await websocket.close()
        except Exception:
            pass

@router.websocket("/ws/{device_id}")
async def websocket_terminal(
    websocket: WebSocket,
    device_id: int,
    token: str = Query(...)
):
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

        protocol = device.get("protocol", "ssh").lower()
        if protocol not in ("ssh", "serial"):
            await websocket.send_text("\r\n[Error] Web CLI saat ini hanya didukung untuk protokol SSH dan Serial.\r\n")
            return

        if protocol == "serial":
            port_name = device["ip"]
            baud_rate = device.get("port", 9600) or 9600
            await websocket.send_text(f"Connecting to Serial Port {port_name} @ {baud_rate} baud...\r\n")

            # Check and close previous active session on this port
            async with serial_sessions_lock:
                if port_name in active_serial_sessions:
                    old_ws, old_ser = active_serial_sessions[port_name]
                    try:
                        await old_ws.send_text("\r\n[System] Sesi ditutup karena port ini diambil alih oleh koneksi baru.\r\n")
                        await old_ws.close()
                    except Exception:
                        pass
                    try:
                        old_ser.close()
                    except Exception:
                        pass
                    # A brief pause to let the operating system release the port
                    await asyncio.sleep(0.5)

            try:
                import serial
                ser = await asyncio.to_thread(
                    serial.Serial,
                    port=port_name,
                    baudrate=baud_rate,
                    timeout=0.1
                )

                # Register current session
                async with serial_sessions_lock:
                    active_serial_sessions[port_name] = (websocket, ser)

                await websocket.send_text("Connected to serial port! Console ready.\r\n\r\n")
                task_out = asyncio.create_task(forward_serial_out(ser, websocket))
                task_in = asyncio.create_task(forward_serial_in(websocket, ser))
                try:
                    await asyncio.gather(task_out, task_in)
                finally:
                    for t in (task_out, task_in):
                        if not t.done():
                            t.cancel()
                return
            except Exception as e:
                err_str = str(e)
                tip = ""
                if "permission denied" in err_str.lower() or "permissionerror" in err_str.lower() or "errno 13" in err_str.lower():
                    tip = " (Tip: Pastikan user Anda terdaftar dalam group 'dialout' atau 'uucp', atau jika menggunakan Docker, pastikan kontainer dijalankan dengan opsi privileged=true dan volume /dev terpeta)."
                err_msg = f"Gagal membuka serial port {port_name}: {e}{tip}"
                logger.error(err_msg)
                await websocket.send_text(f"\r\n[Error] {err_msg}\r\n")
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
            try:
                await asyncio.gather(task_out, task_in)
            finally:
                for t in (task_out, task_in):
                    if not t.done():
                        t.cancel()
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
        # Deregister serial session if it was a serial connection
        try:
            if 'device' in locals() and device.get("protocol") == "serial":
                port_name = device.get("ip")
                if port_name:
                    async with serial_sessions_lock:
                        if port_name in active_serial_sessions and active_serial_sessions[port_name][0] == websocket:
                            del active_serial_sessions[port_name]
        except Exception:
            pass

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
