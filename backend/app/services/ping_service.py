import re
import sys
import asyncio
import logging

logger = logging.getLogger("netx.ping")

def parse_ping_output(output: str, platform: str) -> dict:
    rtt_ms = None
    loss_pct = 100
    reachable = False
    
    # Normalize output to lower case
    out_lower = output.lower()
    
    # Try finding packet stats
    sent, received = None, None
    
    # Windows: "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)"
    m_win_packets = re.search(r"packets:\s+sent\s*=\s*(\d+),\s*received\s*=\s*(\d+)", out_lower)
    if m_win_packets:
        sent = int(m_win_packets.group(1))
        received = int(m_win_packets.group(2))
    else:
        # Linux: "4 packets transmitted, 4 received, 0% packet loss"
        m_lin_packets = re.search(r"(\d+)\s+packets\s+transmitted,\s*(\d+)\s+(?:packets\s+)?received", out_lower)
        if m_lin_packets:
            sent = int(m_lin_packets.group(1))
            received = int(m_lin_packets.group(2))

    if sent is not None and received is not None and sent > 0:
        loss_pct = int(((sent - received) / sent) * 100)
    else:
        # Fallback to direct search for loss percentage
        m_loss = re.search(r"(\d+)%\s*(?:packet\s*)?loss", out_lower)
        if m_loss:
            loss_pct = int(m_loss.group(1))
            
    # Calculate reachable
    if loss_pct < 100:
        reachable = True

    # Try finding average RTT
    # Windows: "Minimum = 0ms, Maximum = 0ms, Average = 2ms" or "Average = 2.5ms"
    # Linux: "rtt min/avg/max/mdev = 0.032/0.034/0.037/0.005 ms"
    if "average =" in out_lower:
        m_avg = re.search(r"average\s*=\s*([\d\.]+)\s*ms", out_lower)
        if m_avg:
            try:
                rtt_ms = float(m_avg.group(1))
            except ValueError:
                pass
    elif "min/avg/max" in out_lower:
        m_avg = re.search(r"min/avg/max/(?:mdev|stddev)\s*=\s*[\d\.]+/([\d\.]+)/[\d\.]+/[\d\.]+", out_lower)
        if m_avg:
            try:
                rtt_ms = float(m_avg.group(1))
            except ValueError:
                pass
                
    # Fallback to average RTT if still None and loss_pct < 100
    if rtt_ms is None and loss_pct < 100:
        # Try extracting times from reply lines: e.g. "time=2ms" or "time=0.032 ms"
        times = []
        for line in out_lower.splitlines():
            m_time = re.search(r"time[=<]([\d\.]+)\s*ms", line)
            if not m_time:
                m_time = re.search(r"time=([\d\.]+)", line)
            if m_time:
                try:
                    times.append(float(m_time.group(1)))
                except ValueError:
                    pass
        if times:
            rtt_ms = sum(times) / len(times)
            
    return {
        "rtt_ms": round(rtt_ms, 2) if rtt_ms is not None else None,
        "loss_pct": loss_pct,
        "reachable": reachable
    }

async def ping_device(ip: str, count: int = 4, timeout: int = 5) -> dict:
    # Determine the ping arguments based on OS
    if sys.platform.startswith("win"):
        # Windows ping: -n for count, -w for timeout in milliseconds
        cmd = ["ping", "-n", str(count), "-w", str(timeout * 1000), ip]
    else:
        # Linux / MacOS ping: -c for count, -W for timeout in seconds
        cmd = ["ping", "-c", str(count), "-W", str(timeout), ip]
        
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        stdout_str = stdout.decode("utf-8", errors="ignore")
        stderr_str = stderr.decode("utf-8", errors="ignore")
        
        # If exit code is not 0 and stdout is empty, it failed
        if proc.returncode != 0 and not stdout_str:
            logger.warning(f"Ping failed for {ip}: exit code {proc.returncode}, stderr: {stderr_str}")
            return {"rtt_ms": None, "loss_pct": 100, "reachable": False}
            
        res = parse_ping_output(stdout_str, sys.platform)
        return res
    except Exception as e:
        logger.error(f"Error executing ping to {ip}: {e}")
        return {"rtt_ms": None, "loss_pct": 100, "reachable": False}
