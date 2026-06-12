import asyncio
import logging
import json
import random
import re
from datetime import datetime, timedelta
from app.database import get_db_conn, get_device_credentials
from app.services.oui_lookup import lookup_vendor
from app.routers.snmp import is_physical_interface
from app.core.drivers import driver_manager
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine, get_cmd, next_cmd, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity
)

logger = logging.getLogger("netx.services.l2_service")

# Helper to normalize MAC Address
def normalize_mac(mac: str) -> str:
    if not mac:
        return ""
    clean = re.sub(r"[:\-\.\s]", "", mac).upper()
    if len(clean) != 12:
        return mac.upper()
    return ":".join(clean[i:i+2] for i in range(0, 12, 2))

# Helper to parse duration string
def parse_duration(seconds: float) -> str:
    if seconds is None or seconds < 0:
        return "—"
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)
    
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0 or not parts:
        parts.append(f"{minutes}m")
    return " ".join(parts)

# Helper to normalize interface names for comparison/correlation
def normalize_interface_name(name: str) -> str:
    if not name:
        return ""
    s = name.lower().replace(" ", "").replace("-", "").replace("_", "").strip()
    s = s.replace("gigabitethernet", "gi")
    s = s.replace("fastethernet", "fa")
    s = s.replace("ethernet", "eth")
    s = s.replace("tengigabitethernet", "te")
    s = s.replace("ten-gigabitethernet", "te")
    s = s.replace("fortygigabitethernet", "fo")
    s = s.replace("hundredgigabitethernet", "hu")
    s = s.replace("port-channel", "po")
    s = s.replace("portchannel", "po")
    s = s.replace("management", "mgmt")
    return s

class L2AnalysisService:
    @staticmethod
    async def refresh_device_l2_data(device_id: int, user: dict = None) -> dict:
        """Runs the complete Layer 2 analysis sync for a device."""
        logger.info(f"Starting L2 Analysis Sync for device {device_id}")
        
        conn = get_db_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
        dev_row = c.fetchone()
        conn.close()
        
        if not dev_row:
            raise ValueError("Perangkat tidak ditemukan.")
        
        device = dict(dev_row)
        now = datetime.now()
        now_iso = now.isoformat()
        
        # 1. Try real SNMP & CLI Sync
        l2_data = None
        if device.get("status") == "online" and device.get("snmp_community"):
            try:
                l2_data = await L2AnalysisService._gather_live_data(device)
            except Exception as e:
                logger.warning(f"Failed to gather live L2 data for {device['name']}: {e}")
        
        # 2. Fallback to Simulation Mode (Offline/Demo Mode)
        if not l2_data:
            logger.info(f"Falling back to realistic L2 simulation for {device['name']} ({device['device_type']})")
            l2_data = await L2AnalysisService._generate_simulated_data(device)
            
        # 3. Save to Database
        await L2AnalysisService._save_l2_data(device_id, l2_data, now_iso)
        
        # 4. Trigger AI Recommendations & Loop Detection Correlator
        await L2AnalysisService._correlate_and_recommend(device_id, l2_data, now_iso)
        
        return {"success": True, "device_id": device_id, "scores": l2_data["scores"]}

    @staticmethod
    async def _gather_live_data(device: dict) -> dict:
        """Gathers L2 metrics using SNMP and correlates with CLI status."""
        ip = device["ip"]
        community = device["snmp_community"]
        version = device["snmp_version"] or "v2c"
        mp_model = 1 if version == "v2c" else 0
        device_type = device.get("device_type", "cisco_ios")
        
        # Load driver
        driver = driver_manager.get_driver(device_type)
        
        snmp_engine = SnmpEngine()
        
        # Collected elements
        stp_info = {}
        vlans = []
        interfaces = []
        macs = []
        port_security = []
        
        snmp_success = False
        cli_success = False
        
        # 1. SNMP Gathering
        try:
            # Query standard OIDs
            descrs = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.2', snmp_engine)
            if descrs:
                snmp_success = True
                types = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.3', snmp_engine)
                admin_statuses = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.7', snmp_engine)
                oper_statuses = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.8', snmp_engine)
                speeds = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.5', snmp_engine)
                high_speeds = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.15', snmp_engine)
                phys_addrs = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.6', snmp_engine)
                aliases = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.18', snmp_engine)
                mtus = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.2.2.1.4', snmp_engine)
                ifnames = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.31.1.1.1.1', snmp_engine) or {}
                
                # STP
                stp_proto = await L2AnalysisService._get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.1.0', snmp_engine)
                stp_modes = {"1": "unknown", "2": "decSpanningTree", "3": "pvst", "4": "rstp", "5": "mstp"}
                stp_mode = stp_modes.get(stp_proto, "rstp")
                
                root_bridge = await L2AnalysisService._get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.5.0', snmp_engine)
                root_cost = await L2AnalysisService._get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.6.0', snmp_engine)
                root_port_idx = await L2AnalysisService._get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.7.0', snmp_engine)
                bridge_id = await L2AnalysisService._get_scalar_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.3.0', snmp_engine)
                
                # Bridge MIB Port mappings
                base_port_ifindexes = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.1.4.1.2', snmp_engine)
                stp_port_states = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.2.15.1.3', snmp_engine)
                
                # VLANs
                vlan_names = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.7.1.4.3.1.1', snmp_engine)
                pvid_mappings = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.7.1.4.5.1.1', snmp_engine)
                
                # MACs
                mac_ports = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.4.3.1.2', snmp_engine)
                
                # Build mapping: bridge port -> ifName
                bridge_port_to_ifname = {}
                ifindex_to_ifname = {}
                for idx, if_descr in descrs.items():
                    ifindex_to_ifname[idx] = ifnames.get(idx, if_descr)
                
                for bp_idx, if_idx_str in base_port_ifindexes.items():
                    try:
                        if_idx = int(if_idx_str)
                        if if_idx in ifindex_to_ifname:
                            bridge_port_to_ifname[bp_idx] = ifindex_to_ifname[if_idx]
                    except:
                        pass
                
                # Filter physical interfaces
                phys_indexes = []
                for idx, name in descrs.items():
                    name_to_check = ifnames.get(idx, name)
                    if driver.is_physical_interface(name_to_check):
                        phys_indexes.append(idx)
                        
                for idx in phys_indexes:
                    ifname = ifnames.get(idx, descrs[idx])
                    descr_str = descrs.get(idx, "")
                    alias_str = aliases.get(idx, "")
                    description = alias_str or (descr_str if descr_str != ifname else "")
                    
                    admin_status = "up" if admin_statuses.get(idx) == "1" else "down"
                    oper_status = "up" if oper_statuses.get(idx) == "1" else "down"
                    
                    speed_bps = 0
                    try:
                        h_val = int(high_speeds.get(idx, 0))
                        if h_val > 0:
                            speed_bps = h_val * 1000000
                        else:
                            speed_bps = int(speeds.get(idx, 0))
                    except:
                        pass
                    
                    speed_str = "Auto/Unknown"
                    if speed_bps >= 1000000000:
                        speed_str = f"{speed_bps / 1000000000:.0f} Gbps"
                    elif speed_bps > 0:
                        speed_str = f"{speed_bps / 1000000:.0f} Mbps"
                    
                    # Resolved VLAN
                    pvid = pvid_mappings.get(idx, "1")
                    
                    interfaces.append({
                        "interface_name": ifname,
                        "description": description,
                        "port_type": "Access", # defaults, trunk will override
                        "oper_status": oper_status,
                        "admin_status": admin_status,
                        "speed": speed_str,
                        "duplex": "Full" if oper_status == "up" else "Auto",
                        "mtu": int(mtus.get(idx, 1500)),
                        "in_octets": 0,
                        "out_octets": 0,
                        "in_errors": 0,
                        "out_errors": 0,
                        "crc_errors": 0,
                        "drops": 0,
                        "discards": 0,
                        "broadcast_pps": 0.0,
                        "multicast_pps": 0.0,
                        "unknown_unicast_pps": 0.0,
                        "port_flaps": 0,
                        "mac_count": 0,
                        "connected_device": "—",
                        "vlan": pvid,
                        "native_vlan": "",
                        "allowed_vlans": "",
                        "voice_vlan": "",
                        "poe_status": "Disabled",
                        "poe_consumption": 0.0,
                        "sfp_vendor": "",
                        "sfp_model": "",
                        "sfp_serial": "",
                        "sfp_rx_power": 0.0,
                        "sfp_tx_power": 0.0,
                        "sfp_temp": 0.0,
                        "sfp_voltage": 0.0,
                        "sfp_bias_current": 0.0,
                        "sfp_health": "Healthy",
                        "health_score": 100,
                        "lifecycle_score": 100,
                        "risk_score": 0,
                        "recommendation_action": "—",
                        "recommendation_text": "Port beroperasi normal.",
                        "recommendation_code": "ok",
                        "visual_indicator": "green",
                        "is_uplink": 0,
                        "uplink_type": "",
                        "uplink_switch": "",
                        "uplink_bandwidth": 0,
                        "uplink_utilization": 0.0,
                        "uplink_redundancy": "",
                        "uplink_backup_link": ""
                    })
                
                # STP info ports
                stp_ports = []
                for bp_idx, state_val in stp_port_states.items():
                    if bp_idx in bridge_port_to_ifname:
                        ifname = bridge_port_to_ifname[bp_idx]
                        if driver.is_physical_interface(ifname):
                            # Mapping states (1=disabled, 2=blocking, etc.)
                            state_map = {"1": "Disabled", "2": "Blocking", "3": "Listening", "4": "Learning", "5": "Forwarding"}
                            stp_ports.append({
                                "interface_name": ifname,
                                "port_role": "Designated",
                                "port_state": state_map.get(state_val, "Disabled"),
                                "cost": 2000,
                                "priority": 128,
                                "edge_port": 0,
                                "bpdu_guard": "Disabled",
                                "root_guard": "Disabled",
                                "loop_guard": "Disabled",
                                "bpdu_filter": "Disabled",
                                "portfast": "Disabled"
                            })
                
                # Resolve Root Port Name
                root_port_name = "—"
                if root_port_idx and root_port_idx in bridge_port_to_ifname:
                    root_port_name = bridge_port_to_ifname[root_port_idx]
                
                stp_info = {
                    "stp_mode": stp_mode,
                    "root_bridge": normalize_mac(root_bridge) if root_bridge else "—",
                    "root_bridge_priority": 32768,
                    "bridge_id": normalize_mac(bridge_id) if bridge_id else "—",
                    "bridge_priority": 32768,
                    "root_path_cost": int(root_cost) if root_cost and root_cost.isdigit() else 0,
                    "root_port": root_port_name,
                    "topology_change_count": 0,
                    "last_topology_change": None,
                    "ports": stp_ports
                }
                
                for vid, vname in vlan_names.items():
                    vlans.append({
                        "vlan_id": vid,
                        "name": vname,
                        "status": "active",
                        "ports": ""
                    })
                    
                # Populate MAC Table from SNMP
                # dot1dTpFdbAddress maps hex bytes
                fdb_addrs = await L2AnalysisService._walk_oid(ip, community, mp_model, '1.3.6.1.2.1.17.4.3.1.1', snmp_engine)
                for f_idx, raw_mac in fdb_addrs.items():
                    bp_idx_str = mac_ports.get(f_idx)
                    if bp_idx_str and bp_idx_str in bridge_port_to_ifname:
                        ifname = bridge_port_to_ifname[bp_idx_str]
                        if driver.is_physical_interface(ifname):
                            norm_mac_addr = normalize_mac(raw_mac)
                            macs.append({
                                "interface_name": ifname,
                                "vlan": "1", # Bridge MIB default
                                "mac_address": norm_mac_addr,
                                "entry_type": "dynamic",
                                "mac_vendor": lookup_vendor(norm_mac_addr),
                                "first_seen": datetime.now().isoformat(),
                                "last_seen": datetime.now().isoformat()
                            })
        except Exception as snmp_err:
            logger.warning(f"SNMP gathering failed for device {device['name']}: {snmp_err}")
            
        finally:
            try:
                snmp_engine.close_dispatcher()
            except Exception:
                pass

        # Fallback to mac_addresses table if SNMP FDB returned no MACs
        if not macs:
            logger.info(f"SNMP FDB table empty or failed. Falling back to DB mac_addresses cache for device {device['id']}")
            try:
                conn = get_db_conn()
                c = conn.cursor()
                c.execute("""
                    SELECT interface, vlan, mac_address, entry_type, mac_vendor, fetched_at 
                    FROM mac_addresses 
                    WHERE device_id = ?
                """, (device["id"],))
                db_macs = [dict(r) for r in c.fetchall()]
                conn.close()
                seen_macs = set()
                for row in db_macs:
                    ifname = row["interface"]
                    mac_addr = row["mac_address"]
                    key = (ifname, mac_addr)
                    if key in seen_macs:
                        continue
                    seen_macs.add(key)
                    macs.append({
                        "interface_name": ifname,
                        "vlan": row["vlan"] or "1",
                        "mac_address": mac_addr,
                        "entry_type": row["entry_type"] or "dynamic",
                        "mac_vendor": row["mac_vendor"] or "Unknown",
                        "first_seen": row["fetched_at"],
                        "last_seen": row["fetched_at"]
                    })
            except Exception as db_err:
                logger.error(f"Fallback to mac_addresses database table failed for device {device['id']}: {db_err}")

        # 2. CLI status correlation if credentials present
        cli_interfaces = []
        cli_vlans = []
        cli_trunks = []
        username, password = get_device_credentials(device)
        if username and password:
            from app.services.connector import connect_and_run
            
            # A. Port Status
            try:
                cmd = getattr(driver, "port_status_command", "show interface status")
                cli_output = await connect_and_run(device, password, cmd)
                if cli_output and not cli_output.startswith("ERROR:"):
                    cli_success = True
                    cli_interfaces = driver.parse_show_interface_status(cli_output)
            except Exception as cli_exc:
                logger.warning(f"CLI status gathering failed for device {device['name']}: {cli_exc}")
                
            # B. VLAN Discovery (1-4096)
            try:
                vlan_cmd = getattr(driver, "vlan_command", None)
                if vlan_cmd:
                    vlan_output = await connect_and_run(device, password, vlan_cmd)
                    if vlan_output and not vlan_output.startswith("ERROR:"):
                        cli_vlans = driver.parse_vlans(vlan_output)
            except Exception as vlan_exc:
                logger.warning(f"CLI VLAN gathering failed for device {device['name']}: {vlan_exc}")
                
            # C. Trunk Discovery
            try:
                trunk_cmd = getattr(driver, "trunk_command", None)
                if trunk_cmd:
                    trunk_output = await connect_and_run(device, password, trunk_cmd)
                    if trunk_output and not trunk_output.startswith("ERROR:"):
                        cli_trunks = driver.parse_trunks(trunk_output)
            except Exception as trunk_exc:
                logger.warning(f"CLI Trunk gathering failed for device {device['name']}: {trunk_exc}")

        # 3. Correlation & Validation logic
        confidence_score = 100
        validation_notes = []
        data_source = "Simulation"
        validation_status = "Verified"
        
        cli_trunks_map = {normalize_interface_name(t["interface_name"]): t for t in cli_trunks}
        
        if snmp_success:
            if cli_success:
                data_source = "SNMP & CLI (Correlated)"
                mismatches = 0
                
                # Map interface lists using normalized interface names
                snmp_ports = {normalize_interface_name(inf["interface_name"]): inf for inf in interfaces}
                cli_ports = {normalize_interface_name(inf["name"]): inf for inf in cli_interfaces}
                
                for name, cli_port in cli_ports.items():
                    if name in snmp_ports:
                        snmp_port = snmp_ports[name]
                        if cli_port["status"] != snmp_port["oper_status"]:
                            mismatches += 1
                            validation_notes.append(f"Port status mismatch on {cli_port['name']}: CLI shows '{cli_port['status']}', SNMP shows '{snmp_port['oper_status']}'")
                        snmp_port["duplex"] = cli_port.get("duplex", snmp_port["duplex"])
                    else:
                        mismatches += 1
                        validation_notes.append(f"Port '{cli_port['name']}' exists in CLI interface list, but is missing from SNMP tables.")
                        
                confidence_score = max(10, 100 - mismatches * 5)
                validation_status = "Verified" if mismatches == 0 else f"Warning: {mismatches} mismatches detected"
            else:
                data_source = "SNMP"
                confidence_score = 85
                validation_status = "Unverified: CLI connection failed or credentials not mapped."
                
            # Merge CLI trunks and VLAN info into SNMP interfaces
            snmp_ports = {normalize_interface_name(inf["interface_name"]): inf for inf in interfaces}
            cli_ports = {normalize_interface_name(inf["name"]): inf for inf in cli_interfaces} if cli_success else {}
            
            for name, snmp_port in snmp_ports.items():
                if name in cli_trunks_map and cli_trunks_map[name].get("port_type") == "Trunk":
                    t_info = cli_trunks_map[name]
                    snmp_port["port_type"] = "Trunk"
                    snmp_port["native_vlan"] = t_info.get("native_vlan", "1")
                    snmp_port["allowed_vlans"] = t_info.get("allowed_vlans", "")
                    snmp_port["vlan"] = "trunk"
                else:
                    cli_port = cli_ports.get(name)
                    if cli_port:
                        vlan_val = cli_port.get("vlan", "1")
                        if vlan_val and vlan_val.isdigit():
                            snmp_port["vlan"] = vlan_val
                            snmp_port["port_type"] = "Access"
                            snmp_port["native_vlan"] = ""
                            snmp_port["allowed_vlans"] = ""
            
        elif cli_success:
            data_source = "CLI"
            confidence_score = 80
            validation_status = "Unverified: SNMP connection failed or not configured."
            
            # Convert CLI ports format to L2 interfaces
            for cp in cli_interfaces:
                name_norm = normalize_interface_name(cp["name"])
                
                is_trunk = name_norm in cli_trunks_map
                t_info = cli_trunks_map.get(name_norm, {})
                
                port_type = "Trunk" if is_trunk else "Access"
                native_vlan = t_info.get("native_vlan", "1") if is_trunk else ""
                allowed_vlans = t_info.get("allowed_vlans", "") if is_trunk else ""
                vlan_val = "trunk" if is_trunk else cp.get("vlan", "1")
                
                interfaces.append({
                    "interface_name": cp["name"],
                    "description": "",
                    "port_type": port_type,
                    "oper_status": cp["status"],
                    "admin_status": cp["admin_status"],
                    "speed": cp["speed"],
                    "duplex": cp["duplex"],
                    "mtu": 1500,
                    "in_octets": 0,
                    "out_octets": 0,
                    "in_errors": 0,
                    "out_errors": 0,
                    "crc_errors": 0,
                    "drops": 0,
                    "discards": 0,
                    "broadcast_pps": 0.0,
                    "multicast_pps": 0.0,
                    "unknown_unicast_pps": 0.0,
                    "port_flaps": 0,
                    "mac_count": 0,
                    "connected_device": "—",
                    "vlan": vlan_val,
                    "native_vlan": native_vlan,
                    "allowed_vlans": allowed_vlans,
                    "voice_vlan": "",
                    "poe_status": "Disabled",
                    "poe_consumption": 0.0,
                    "sfp_vendor": "",
                    "sfp_model": "",
                    "sfp_serial": "",
                    "sfp_rx_power": 0.0,
                    "sfp_tx_power": 0.0,
                    "sfp_temp": 0.0,
                    "sfp_voltage": 0.0,
                    "sfp_bias_current": 0.0,
                    "sfp_health": "Healthy",
                    "health_score": 100,
                    "lifecycle_score": 100,
                    "risk_score": 0,
                    "recommendation_action": "—",
                    "recommendation_text": "Port beroperasi normal.",
                    "recommendation_code": "ok",
                    "visual_indicator": "green",
                    "is_uplink": 0,
                    "uplink_type": "",
                    "uplink_switch": "",
                    "uplink_bandwidth": 0,
                    "uplink_utilization": 0.0,
                    "uplink_redundancy": "",
                    "uplink_backup_link": ""
                })
        else:
            return None # Fallback to simulation
            
        if cli_vlans:
            if not vlans:
                vlans = cli_vlans
            else:
                snmp_vlans_map = {v["vlan_id"]: v for v in vlans}
                for cv in cli_vlans:
                    vid = cv["vlan_id"]
                    if vid in snmp_vlans_map:
                        snmp_vlans_map[vid]["name"] = cv["name"] or snmp_vlans_map[vid]["name"]
                        snmp_vlans_map[vid]["status"] = cv["status"] or snmp_vlans_map[vid]["status"]
                        snmp_vlans_map[vid]["ports"] = cv["ports"] or snmp_vlans_map[vid]["ports"]
                    else:
                        vlans.append(cv)
            
        scores = {
            "port": 100,
            "stp": 100,
            "l2": 100,
            "sfp": 100,
            "loop_risk": 0,
            "broadcast_risk": 0,
            "confidence_score": confidence_score,
            "data_source": data_source,
            "validation_status": validation_status
        }
        
        # Calculate overall health scores
        if interfaces:
            port_health_avg = int(sum(p["health_score"] for p in interfaces) / len(interfaces))
            scores["port"] = port_health_avg
            scores["l2"] = port_health_avg
            
        # Ensure STP info has all required keys with safe defaults
        default_stp = {
            "stp_mode": "unknown",
            "root_bridge": "—",
            "root_bridge_priority": 32768,
            "bridge_id": "—",
            "bridge_priority": 32768,
            "root_path_cost": 0,
            "root_port": "—",
            "topology_change_count": 0,
            "last_topology_change": None,
            "ports": []
        }
        if stp_info:
            for k, v in default_stp.items():
                stp_info.setdefault(k, v)
        else:
            stp_info = default_stp

        return {
            "stp": stp_info,
            "vlans": vlans,
            "interfaces": interfaces,
            "macs": macs,
            "port_security": port_security,
            "scores": scores
        }

    @staticmethod
    async def _generate_simulated_data(device: dict) -> dict:
        """Generates realistic Layer 2 metrics based on vendor platform & device role."""
        vendor = device.get("device_type", "cisco_ios").split("_")[0].lower()
        role = device.get("device_role") or "Access Switch"
        model = device.get("hardware_model") or "C2960"
        
        now = datetime.now()
        now_iso = now.isoformat()
        
        # Decide port count
        port_count = 24
        if "48" in model or "52" in model:
            port_count = 48
            
        # Determine port naming prefix
        port_prefix = "GigabitEthernet0/"
        if vendor == "juniper":
            port_prefix = "ge-0/0/"
        elif vendor == "huawei":
            port_prefix = "GigabitEthernet0/0/"
        elif vendor == "allied_telesis":
            port_prefix = "port1.0."
        elif vendor in ("aruba", "ruckus"):
            port_prefix = "GigabitEthernet1/1/"
        elif vendor == "mikrotik":
            port_prefix = "ether"
            
        interfaces = []
        stp_ports = []
        macs = []
        port_security = []
        
        # Determine STP Root Bridge properties
        is_root_bridge = (role == "Core Switch")
        root_mac = "00:1A:E2:B0:11:00"
        device_mac = "00:1A:E2:B0:11:00" if is_root_bridge else f"00:1A:E2:B0:{random.randint(10,99)}:00"
        
        # Determine VLAN structure
        vlan_list = [
            {"vlan_id": 1, "name": "default", "status": "active", "ports": ""},
            {"vlan_id": 10, "name": "Data_LAN", "status": "active", "ports": ""},
            {"vlan_id": 20, "name": "VoIP_Voice", "status": "active", "ports": ""},
            {"vlan_id": 99, "name": "Management", "status": "active", "ports": ""}
        ]
        
        # Identify uplink ports
        uplink_indices = [port_count - 1, port_count]
        
        for i in range(1, port_count + 1):
            ifname = f"{port_prefix}{i}"
            is_uplink = i in uplink_indices
            
            admin_status = "up"
            if not is_uplink and i in (7, 13, 19):
                admin_status = "down"
                
            oper_status = "down"
            if admin_status == "up":
                if is_uplink:
                    oper_status = "up"
                elif i in (1, 2, 3, 5, 8, 10, 11, 14, 15, 22):
                    oper_status = "up"
            
            broadcast_pps = 0.0
            multicast_pps = 0.0
            unicast_pps = 0.0
            in_errors = 0
            crc_errors = 0
            drops = 0
            
            rx_util = 0.0
            tx_util = 0.0
            
            if i == 2 and oper_status == "up":
                crc_errors = random.randint(15, 80)
                in_errors = crc_errors + random.randint(5, 20)
                
            if i == 5 and oper_status == "up":
                broadcast_pps = random.randint(3200, 5500)
                multicast_pps = random.randint(100, 300)
                
            if oper_status == "up":
                if broadcast_pps == 0:
                    broadcast_pps = round(random.uniform(0.5, 15.0), 2)
                    multicast_pps = round(random.uniform(1.2, 25.0), 2)
                unicast_pps = round(random.uniform(50.0, 800.0), 2)
                rx_util = round(random.uniform(0.1, 12.0), 2) if not is_uplink else round(random.uniform(25.0, 65.0), 2)
                tx_util = round(random.uniform(0.1, 8.0), 2) if not is_uplink else round(random.uniform(15.0, 48.0), 2)
                
            sfp_vendor = ""
            sfp_model = ""
            sfp_serial = ""
            sfp_rx_power = 0.0
            sfp_tx_power = 0.0
            sfp_temp = 0.0
            sfp_voltage = 0.0
            sfp_bias_current = 0.0
            sfp_health = "Healthy"
            
            if is_uplink or i == 22:
                sfp_vendor = "FINISAR CORP."
                sfp_model = "FTLX8571D3BCL"
                sfp_serial = f"FI{random.randint(100000, 999999)}"
                sfp_rx_power = round(random.uniform(-5.5, -2.5), 2)
                sfp_tx_power = round(random.uniform(-3.5, -1.2), 2)
                sfp_temp = round(random.uniform(32.0, 45.0), 1)
                sfp_voltage = round(random.uniform(3.25, 3.35), 2)
                sfp_bias_current = round(random.uniform(5.5, 7.8), 2)
                
                if i == 22:
                    sfp_rx_power = -22.4
                    sfp_health = "Critical"
                    
            poe_status = "Disabled"
            poe_consumption = 0.0
            if not is_uplink and i <= 12 and oper_status == "up":
                if i in (1, 3, 8):
                    poe_status = "Delivering"
                    poe_consumption = round(random.uniform(3.8, 12.5), 1)
                    
            port_type = "Access"
            vlan = "10"
            allowed_vlans = ""
            native_vlan = ""
            voice_vlan = ""
            
            if is_uplink:
                port_type = "Trunk"
                vlan = "trunk"
                allowed_vlans = "1,10,20,99"
                native_vlan = "1"
                if device["id"] % 3 == 0:
                    native_vlan = "99"
            else:
                if i == 1:
                    vlan = "1"
                elif i == 8:
                    vlan = "20"
                elif i == 11:
                    vlan = "99"
                elif i == 10:
                    vlan = "10"
                    voice_vlan = "20"
                    
            sticky_mac = 0
            max_mac = 1
            current_mac = 0
            violation_mode = "Shutdown"
            violation_count = 0
            
            if not is_uplink and i in (3, 8):
                sticky_mac = 1
                max_mac = 2
                current_mac = 1
                if i == 8:
                    current_mac = 3
                    violation_count = 12
                    violation_mode = "Protect"
            
            connected_device = "—"
            if is_uplink:
                connected_device = f"Core-Switch-A ({port_prefix}{i})"
            elif i == 1:
                connected_device = "LLDP: Router-Edge-Gateway (192.168.1.254)"
            elif i == 3:
                connected_device = "CDP: AP-Floor2-Office (10.99.1.5)"
            elif i == 10:
                connected_device = "Host: IP-Phone (Yealink)"
                
            mac_count = 0
            if oper_status == "up":
                if is_uplink:
                    mac_count = random.randint(12, 45)
                    for m_idx in range(mac_count):
                        mac_addr = f"00:50:56:AB:{random.randint(10,99)}:{random.randint(10,99)}"
                        macs.append({
                            "interface_name": ifname,
                            "vlan": str(random.choice([1, 10, 20])),
                            "mac_address": mac_addr,
                            "entry_type": "dynamic",
                            "mac_vendor": "VMware, Inc.",
                            "first_seen": (now - timedelta(hours=3)).isoformat(),
                            "last_seen": now_iso
                        })
                else:
                    mac_count = 1
                    host_mac = f"00:E0:4C:D1:{random.randint(10,99)}:{random.randint(10,99)}"
                    macs.append({
                        "interface_name": ifname,
                        "vlan": vlan,
                        "mac_address": host_mac,
                        "entry_type": "dynamic",
                        "mac_vendor": "Realtek Semiconductor Corp.",
                        "first_seen": (now - timedelta(days=2)).isoformat(),
                        "last_seen": now_iso
                    })
                    
            if (i in (5, 15)) and oper_status == "up":
                flap_mac = "00:25:90:3F:8A:11"
                macs.append({
                    "interface_name": ifname,
                    "vlan": "10",
                    "mac_address": flap_mac,
                    "entry_type": "dynamic",
                    "mac_vendor": "Super Micro Computer, Inc.",
                    "first_seen": (now - timedelta(minutes=10)).isoformat(),
                    "last_seen": now_iso
                })
                mac_count += 1
                
            port_health = 100
            recommendation_action = "—"
            recommendation_text = "Port beroperasi normal."
            recommendation_code = "ok"
            visual_indicator = "green"
            
            if admin_status == "down":
                port_health = 100
                visual_indicator = "yellow"
                recommendation_action = "Monitor"
                recommendation_text = "Port dinonaktifkan secara administratif."
                recommendation_code = "admin_down"
            elif oper_status == "down":
                port_health = 100
                visual_indicator = "yellow"
                recommendation_action = "Safe to Disable"
                recommendation_text = "Port tidak aktif. Matikan secara administratif demi keamanan."
                recommendation_code = "safe_to_disable"
            else:
                if crc_errors > 0:
                    port_health = max(30, 100 - crc_errors * 2)
                    visual_indicator = "red" if port_health < 50 else "orange"
                    recommendation_action = "Check Cable"
                    recommendation_text = f"Deteksi {crc_errors} CRC errors. Periksa kabel LAN atau ganti konektor RJ45."
                    recommendation_code = "check_cable"
                elif broadcast_pps > 3000:
                    port_health = 45
                    visual_indicator = "red"
                    recommendation_action = "Check Loop"
                    recommendation_text = f"Trafik Broadcast sangat tinggi ({int(broadcast_pps)} pps). Kemungkinan Loop Layer 2."
                    recommendation_code = "check_loop"
                elif sfp_health == "Critical":
                    port_health = 50
                    visual_indicator = "red"
                    recommendation_action = "Replace SFP"
                    recommendation_text = f"Optical power level sangat rendah ({sfp_rx_power} dBm). Harap ganti modul SFP."
                    recommendation_code = "replace_sfp"
                elif violation_count > 0:
                    port_health = 60
                    visual_indicator = "orange"
                    recommendation_action = "Investigate"
                    recommendation_text = f"Deteksi {violation_count} security violations. MAC table overflow / unauthorized device."
                    recommendation_code = "investigate"
                    
            lifecycle_score = 100 - random.randint(0, 15)
            risk_score = 100 - port_health
            
            uplink_type = ""
            uplink_switch = ""
            uplink_bandwidth = 0
            uplink_utilization = 0.0
            uplink_redundancy = ""
            uplink_backup_link = ""
            
            if is_uplink:
                uplink_type = "Core Link"
                uplink_switch = "Core-Switch-A"
                uplink_bandwidth = 10000000000
                uplink_utilization = round(max(rx_util, tx_util), 2)
                uplink_redundancy = "LACP Active"
                uplink_backup_link = f"{port_prefix}{port_count}" if i == (port_count - 1) else f"{port_prefix}{port_count - 1}"
                
            interfaces.append({
                "interface_name": ifname,
                "description": f"Port #{i} L2 Access" if not is_uplink else f"Uplink Core-Trunk-{i}",
                "port_type": port_type,
                "oper_status": oper_status,
                "admin_status": admin_status,
                "speed": "1 Gbps" if not is_uplink else "10 Gbps",
                "duplex": "Full" if oper_status == "up" else "Auto",
                "mtu": 1500,
                "in_octets": int(rx_util * 1000000),
                "out_octets": int(tx_util * 1000000),
                "in_errors": in_errors,
                "out_errors": 0,
                "crc_errors": crc_errors,
                "drops": drops,
                "discards": 0,
                "broadcast_pps": broadcast_pps,
                "multicast_pps": multicast_pps,
                "unknown_unicast_pps": unicast_pps,
                "port_flaps": 1 if i == 5 else 0,
                "mac_count": mac_count,
                "connected_device": connected_device,
                "vlan": vlan,
                "native_vlan": native_vlan,
                "allowed_vlans": allowed_vlans,
                "voice_vlan": voice_vlan,
                "poe_status": poe_status,
                "poe_consumption": poe_consumption,
                "sfp_vendor": sfp_vendor,
                "sfp_model": sfp_model,
                "sfp_serial": sfp_serial,
                "sfp_rx_power": sfp_rx_power,
                "sfp_tx_power": sfp_tx_power,
                "sfp_temp": sfp_temp,
                "sfp_voltage": sfp_voltage,
                "sfp_bias_current": sfp_bias_current,
                "sfp_health": sfp_health,
                "health_score": port_health,
                "lifecycle_score": lifecycle_score,
                "risk_score": risk_score,
                "recommendation_action": recommendation_action,
                "recommendation_text": recommendation_text,
                "recommendation_code": recommendation_code,
                "visual_indicator": visual_indicator,
                "is_uplink": 1 if is_uplink else 0,
                "uplink_type": uplink_type,
                "uplink_switch": uplink_switch,
                "uplink_bandwidth": uplink_bandwidth,
                "uplink_utilization": uplink_utilization,
                "uplink_redundancy": uplink_redundancy,
                "uplink_backup_link": uplink_backup_link
            })
            
            stp_role = "Designated" if is_root_bridge else "Alternate"
            stp_state = "Forwarding"
            
            if is_uplink:
                stp_role = "Root" if not is_root_bridge else "Designated"
                stp_state = "Forwarding"
            elif i == 15:
                stp_role = "Alternate"
                stp_state = "Blocking"
                
            stp_ports.append({
                "interface_name": ifname,
                "port_role": stp_role,
                "port_state": stp_state,
                "cost": 20000 if not is_uplink else 2000,
                "priority": 128,
                "edge_port": 1 if (not is_uplink and oper_status == "up" and i != 15) else 0,
                "bpdu_guard": "Enabled" if not is_uplink else "Disabled",
                "root_guard": "Disabled",
                "loop_guard": "Disabled" if not is_uplink else "Enabled",
                "bpdu_filter": "Disabled",
                "portfast": "Enabled" if not is_uplink else "Disabled"
            })
            
            if sticky_mac > 0:
                port_security.append({
                    "interface_name": ifname,
                    "sticky_mac": sticky_mac,
                    "max_mac": max_mac,
                    "current_mac": current_mac,
                    "violation_mode": violation_mode,
                    "violation_count": violation_count
                })
                
        stp_info = {
            "stp_mode": "mstp" if vendor == "juniper" else "rapid-pvst",
            "root_bridge": root_mac,
            "root_bridge_priority": 4096,
            "bridge_id": device_mac,
            "bridge_priority": 32768 if not is_root_bridge else 4096,
            "root_path_cost": 0 if is_root_bridge else 2000,
            "root_port": "—" if is_root_bridge else f"{port_prefix}{port_count - 1}",
            "topology_change_count": random.randint(14, 280),
            "last_topology_change": (now - timedelta(minutes=4)).isoformat(),
            "ports": stp_ports
        }
        
        port_health_avg = int(sum(p["health_score"] for p in interfaces) / len(interfaces))
        stp_health = 100
        if any(p["port_state"] == "Blocking" for p in stp_ports):
            stp_health = 90
            
        loop_risk = 0
        broadcast_risk = 0
        
        if any(p["broadcast_pps"] > 3000 for p in interfaces):
            loop_risk = 85
            broadcast_risk = 90
            stp_health = 45
            
        sfp_health_val = 100
        if any(p["sfp_health"] == "Critical" for p in interfaces):
            sfp_health_val = 50
            
        l2_health_score = int((port_health_avg * 0.4) + (stp_health * 0.3) + ((100 - loop_risk) * 0.3))
        
        scores = {
            "port": port_health_avg,
            "stp": stp_health,
            "l2": l2_health_score,
            "sfp": sfp_health_val,
            "loop_risk": loop_risk,
            "broadcast_risk": broadcast_risk,
            "confidence_score": 100,
            "data_source": "Simulation",
            "validation_status": "Verified"
        }
        
        return {
            "stp": stp_info,
            "vlans": vlan_list,
            "interfaces": interfaces,
            "macs": macs,
            "port_security": port_security,
            "scores": scores
        }

    @staticmethod
    async def _save_l2_data(device_id: int, data: dict, now_iso: str):
        """Saves L2 extracted information to the SQLite/PostgreSQL database."""
        conn = get_db_conn()
        c = conn.cursor()
        
        try:
            # 1. Spanning Tree DDL
            stp = data.get("stp", {})
            c.execute("DELETE FROM device_l2_spanning_tree WHERE device_id = ?", (device_id,))
            c.execute("""
                INSERT INTO device_l2_spanning_tree (
                    device_id, stp_mode, root_bridge_id, root_bridge_priority,
                    bridge_id, bridge_priority, root_path_cost, root_port,
                    topology_change_count, last_topology_change,
                    confidence_score, data_source, validation_status, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                device_id, stp.get("stp_mode", "unknown"), stp.get("root_bridge", "—"), stp.get("root_bridge_priority", 32768),
                stp.get("bridge_id", "—"), stp.get("bridge_priority", 32768), stp.get("root_path_cost", 0), stp.get("root_port", "—"),
                stp.get("topology_change_count", 0), stp.get("last_topology_change"),
                data.get("scores", {}).get("confidence_score", 100),
                data.get("scores", {}).get("data_source", "Simulation"),
                data.get("scores", {}).get("validation_status", "Verified"),
                now_iso
            ))
            
            # 2. STP Ports DDL
            c.execute("DELETE FROM device_l2_stp_ports WHERE device_id = ?", (device_id,))
            for sp in stp["ports"]:
                c.execute("""
                    INSERT INTO device_l2_stp_ports (
                        device_id, interface_name, port_role, port_state, cost,
                        priority, edge_port, bpdu_guard, root_guard, loop_guard,
                        bpdu_filter, portfast, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    device_id, sp["interface_name"], sp["port_role"], sp["port_state"], sp["cost"],
                    sp["priority"], sp["edge_port"], sp["bpdu_guard"], sp["root_guard"], sp["loop_guard"],
                    sp["bpdu_filter"], sp["portfast"], now_iso
                ))
                
            # 3. VLANs DDL
            c.execute("DELETE FROM device_l2_vlans WHERE device_id = ?", (device_id,))
            for vl in data["vlans"]:
                c.execute("""
                    INSERT INTO device_l2_vlans (
                        device_id, vlan_id, name, status, ports, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    device_id, vl["vlan_id"], vl["name"], vl["status"], vl["ports"], now_iso
                ))
                
            # 4. Save Port Lifecycle Analysis & Update recommendations
            now = datetime.fromisoformat(now_iso)
            c.execute("SELECT * FROM device_l2_port_lifecycle WHERE device_id = ?", (device_id,))
            existing_lifecycle = {r["interface_name"]: dict(r) for r in c.fetchall()}
            
            for inf in data["interfaces"]:
                ifname = inf["interface_name"]
                oper_status = inf["oper_status"]
                
                speed_mbps = 1000
                if "10 Gbps" in inf.get("speed", ""):
                    speed_mbps = 10000
                elif "100 Gbps" in inf.get("speed", ""):
                    speed_mbps = 100000
                elif "100 Mbps" in inf.get("speed", ""):
                    speed_mbps = 100
                elif "10 Mbps" in inf.get("speed", ""):
                    speed_mbps = 10
                
                speed_bps = speed_mbps * 1000000
                rx_oct = inf.get("in_octets", 0)
                tx_oct = inf.get("out_octets", 0)
                rx_util = (rx_oct * 8) / speed_bps * 100 if speed_bps > 0 else 0
                tx_util = (tx_oct * 8) / speed_bps * 100 if speed_bps > 0 else 0
                current_util = round(max(rx_util, tx_util), 2)
                if current_util > 100.0:
                    current_util = 100.0
                
                # Current mac list
                current_macs = [mc["mac_address"] for mc in data.get("macs", []) if mc["interface_name"] == ifname]
                # Current neighbors
                current_neighbors = []
                if inf.get("connected_device") and inf["connected_device"] != "—":
                    current_neighbors.append(inf["connected_device"])
                # Current VLAN
                current_vlan = inf.get("vlan", "")
                
                if ifname not in existing_lifecycle:
                    first_seen = now_iso
                    last_seen = now_iso
                    last_link_up = now_iso if oper_status == "up" else None
                    last_link_down = now_iso if oper_status == "down" else None
                    total_active_time = 0
                    total_inactive_time = 0
                    link_event_count = 0
                    last_traffic_activity = now_iso if oper_status == "up" else None
                    avg_utilization = current_util
                    peak_utilization = current_util
                    mac_history = json.dumps(list(set(current_macs)))
                    neighbor_history = json.dumps(current_neighbors)
                    vlan_history = json.dumps([current_vlan] if current_vlan else [])
                    classification = "Active" if oper_status == "up" else "Never Used"
                else:
                    el = existing_lifecycle[ifname]
                    first_seen = el["first_seen"]
                    last_seen = now_iso
                    
                    delta_seconds = 60
                    if el.get("last_seen"):
                        try:
                            prev_time = datetime.fromisoformat(el["last_seen"])
                            delta_seconds = int((now - prev_time).total_seconds())
                            if delta_seconds <= 0:
                                delta_seconds = 60
                        except Exception:
                            pass
                            
                    total_active_time = (el["total_active_time"] or 0)
                    total_inactive_time = (el["total_inactive_time"] or 0)
                    link_event_count = (el["link_event_count"] or 0)
                    last_link_up = el["last_link_up"]
                    last_link_down = el["last_link_down"]
                    last_traffic_activity = el["last_traffic_activity"]
                    
                    # Look up previous state
                    c.execute("SELECT oper_status FROM device_l2_interfaces WHERE device_id = ? AND interface_name = ?", (device_id, ifname))
                    prev_row = c.fetchone()
                    prev_status = prev_row["oper_status"] if prev_row else None
                    
                    if prev_status and oper_status != prev_status:
                        link_event_count += 1
                        if oper_status == "up":
                            last_link_up = now_iso
                        else:
                            last_link_down = now_iso
                            
                    if oper_status == "up":
                        total_active_time += delta_seconds
                        last_traffic_activity = now_iso
                    else:
                        total_inactive_time += delta_seconds
                        
                    avg_utilization = round(((el["avg_utilization"] or 0) * 0.9) + (current_util * 0.1), 2)
                    peak_utilization = max(el["peak_utilization"] or 0, current_util)
                    
                    # Merge histories
                    try:
                        mac_list = json.loads(el["mac_history"] or "[]")
                    except Exception:
                        mac_list = []
                    for m in current_macs:
                        if m not in mac_list:
                            mac_list.append(m)
                    mac_history = json.dumps(mac_list[:15])
                    
                    try:
                        neigh_list = json.loads(el["neighbor_history"] or "[]")
                    except Exception:
                        neigh_list = []
                    for n in current_neighbors:
                        if n not in neigh_list:
                            neigh_list.append(n)
                    neighbor_history = json.dumps(neigh_list[:10])
                    
                    try:
                        vl_list = json.loads(el["vlan_history"] or "[]")
                    except Exception:
                        vl_list = []
                    if current_vlan and current_vlan not in vl_list:
                        vl_list.append(current_vlan)
                    vlan_history = json.dumps(vl_list[:10])
                    
                    if oper_status == "up":
                        classification = "Active"
                    else:
                        if not last_link_up:
                            classification = "Never Used"
                        else:
                            try:
                                link_up_time = datetime.fromisoformat(last_link_up)
                                days_inactive = (now - link_up_time).days
                                if days_inactive >= 90:
                                    classification = "Inactive >90 Days"
                                elif days_inactive >= 60:
                                    classification = "Inactive >60 Days"
                                elif days_inactive >= 30:
                                    classification = "Inactive >30 Days"
                                else:
                                    classification = "Unused"
                            except Exception:
                                classification = "Unused"
                                
                # classification override recommendations
                rec_action = inf["recommendation_action"]
                rec_text = inf["recommendation_text"]
                rec_code = inf["recommendation_code"]
                vis = inf["visual_indicator"]
                
                if classification == "Never Used":
                    rec_action = "Safe to Disable"
                    rec_text = "Port ini belum pernah digunakan sejak pertama kali dideteksi. Matikan secara administratif demi keamanan."
                    rec_code = "never_used"
                    vis = "yellow"
                elif classification in ("Inactive >90 Days", "Inactive >60 Days"):
                    rec_action = "Safe to Disable"
                    rec_text = f"Port ini tidak aktif selama lebih dari {30 if '30' in classification else (60 if '60' in classification else 90)} hari. Disarankan untuk mematikannya demi menghemat kapasitas port switch."
                    rec_code = "inactive_long"
                    vis = "yellow"
                elif classification == "Inactive >30 Days":
                    rec_action = "Candidate for Reuse"
                    rec_text = "Port ini tidak aktif selama lebih dari 30 hari dan dapat dialokasikan kembali untuk perangkat lain."
                    rec_code = "candidate_reuse"
                    vis = "yellow"
                
                # Update in DB
                c.execute("DELETE FROM device_l2_port_lifecycle WHERE device_id = ? AND interface_name = ?", (device_id, ifname))
                c.execute("""
                    INSERT INTO device_l2_port_lifecycle (
                        device_id, interface_name, first_seen, last_seen,
                        last_link_up, last_link_down, total_active_time, total_inactive_time,
                        link_event_count, last_traffic_activity, avg_utilization, peak_utilization,
                        mac_history, neighbor_history, vlan_history, classification
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    device_id, ifname, first_seen, last_seen,
                    last_link_up, last_link_down, total_active_time, total_inactive_time,
                    link_event_count, last_traffic_activity, avg_utilization, peak_utilization,
                    mac_history, neighbor_history, vlan_history, classification
                ))
                
                # Propagate to interfaces table values
                inf["recommendation_action"] = rec_action
                inf["recommendation_text"] = rec_text
                inf["recommendation_code"] = rec_code
                inf["visual_indicator"] = vis
                
            # 5. Interfaces DDL
            c.execute("DELETE FROM device_l2_interfaces WHERE device_id = ?", (device_id,))
            for inf in data["interfaces"]:
                c.execute("""
                    INSERT INTO device_l2_interfaces (
                        device_id, interface_name, description, port_type, oper_status,
                        admin_status, speed, duplex, mtu, in_octets, out_octets,
                        in_errors, out_errors, crc_errors, drops, discards,
                        broadcast_pps, multicast_pps, unknown_unicast_pps, port_flaps,
                        mac_count, connected_device, vlan, native_vlan, allowed_vlans,
                        voice_vlan, poe_status, poe_consumption, sfp_vendor, sfp_model,
                        sfp_serial, sfp_rx_power, sfp_tx_power, sfp_temp, sfp_voltage,
                        sfp_bias_current, sfp_health, health_score, lifecycle_score,
                        risk_score, recommendation_action, recommendation_text,
                        recommendation_code, visual_indicator, is_uplink, uplink_type,
                        uplink_switch, uplink_bandwidth, uplink_utilization,
                        uplink_redundancy, uplink_backup_link, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    device_id, inf["interface_name"], inf["description"], inf["port_type"], inf["oper_status"],
                    inf["admin_status"], inf["speed"], inf["duplex"], inf["mtu"], inf["in_octets"], inf["out_octets"],
                    inf["in_errors"], inf["out_errors"], inf["crc_errors"], inf["drops"], inf["discards"],
                    inf["broadcast_pps"], inf["multicast_pps"], inf["unknown_unicast_pps"], inf["port_flaps"],
                    inf["mac_count"], inf["connected_device"], inf["vlan"], inf["native_vlan"], inf["allowed_vlans"],
                    inf["voice_vlan"], inf["poe_status"], inf["poe_consumption"], inf["sfp_vendor"], inf["sfp_model"],
                    inf["sfp_serial"], inf["sfp_rx_power"], inf["sfp_tx_power"], inf["sfp_temp"], inf["sfp_voltage"],
                    inf["sfp_bias_current"], inf["sfp_health"], inf["health_score"], inf["lifecycle_score"],
                    inf["risk_score"], inf["recommendation_action"], inf["recommendation_text"],
                    inf["recommendation_code"], inf["visual_indicator"], inf["is_uplink"], inf["uplink_type"],
                    inf["uplink_switch"], inf["uplink_bandwidth"], inf["uplink_utilization"],
                    inf["uplink_redundancy"], inf["uplink_backup_link"], now_iso
                ))
                
            # 6. Port Security DDL
            c.execute("DELETE FROM device_l2_port_security WHERE device_id = ?", (device_id,))
            for ps in data["port_security"]:
                c.execute("""
                    INSERT INTO device_l2_port_security (
                        device_id, interface_name, sticky_mac, max_mac,
                        current_mac, violation_mode, violation_count, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    device_id, ps["interface_name"], ps["sticky_mac"], ps["max_mac"],
                    ps["current_mac"], ps["violation_mode"], ps["violation_count"], now_iso
                ))
                
            # 7. MAC Table DDL
            c.execute("DELETE FROM device_l2_macs WHERE device_id = ?", (device_id,))
            seen_macs = set()
            for mc in data["macs"]:
                key = (mc["interface_name"], mc["mac_address"])
                if key in seen_macs:
                    continue
                seen_macs.add(key)
                
                c.execute("""
                    INSERT INTO device_l2_macs (
                        device_id, interface_name, vlan, mac_address,
                        entry_type, mac_vendor, first_seen, last_seen
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    device_id, mc["interface_name"], mc["vlan"], mc["mac_address"],
                    mc["entry_type"], mc["mac_vendor"], mc["first_seen"], mc["last_seen"]
                ))
                
            conn.commit()
            
        except Exception as e:
            logger.error(f"Failed to save L2 data for device {device_id}: {e}")
            conn.rollback()
            raise e
        finally:
            conn.close()

    @staticmethod
    async def _correlate_and_recommend(device_id: int, data: dict, now_iso: str):
        """Automates Layer 2 Event Correlation, Loop Detection, and Timeline Logging."""
        conn = get_db_conn()
        c = conn.cursor()
        
        try:
            # 1. Loop Detection logic
            loop_prob = data["scores"]["loop_risk"]
            if loop_prob > 50:
                c.execute("""
                    INSERT INTO device_l2_timeline (device_id, event_type, interface_name, details, severity, timestamp)
                    VALUES (?, 'loop_detected', 'Global', ?, 'critical', ?)
                """, (
                    device_id,
                    f"Kemungkinan Loop Layer 2 terdeteksi (Indeks Risiko: {loop_prob}%). Korelasi: anomali status flapping, badai broadcast pps, dan perpindahan MAC address.",
                    now_iso
                ))
                
            # 2. Port Up / Down timeline changes
            c.execute("SELECT interface_name, oper_status FROM device_l2_interfaces WHERE device_id = ? AND fetched_at < ?", (device_id, now_iso))
            prev_states = {r["interface_name"]: r["oper_status"] for r in c.fetchall()}
            
            for inf in data["interfaces"]:
                ifname = inf["interface_name"]
                curr_status = inf["oper_status"]
                prev_status = prev_states.get(ifname)
                
                if prev_status and curr_status != prev_status:
                    event_type = "port_up" if curr_status == "up" else "port_down"
                    severity = "info" if curr_status == "up" else "warning"
                    c.execute("""
                        INSERT INTO device_l2_timeline (device_id, event_type, interface_name, details, severity, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        device_id, event_type, ifname,
                        f"Interface {ifname} berubah status operasional dari {prev_status} menjadi {curr_status}.",
                        severity, now_iso
                    ))
                    
            # 3. SFP warning timeline logging
            for inf in data["interfaces"]:
                if inf["sfp_health"] in ("Warning", "Critical"):
                    c.execute("""
                        INSERT INTO device_l2_timeline (device_id, event_type, interface_name, details, severity, timestamp)
                        VALUES (?, 'sfp_alarm', ?, ?, ?, ?)
                    """, (
                        device_id, inf["interface_name"],
                        f"Transceiver SFP alarm: {inf['sfp_health']}. RX Power: {inf['sfp_rx_power']} dBm, Suhu: {inf['sfp_temp']} C.",
                        "critical" if inf["sfp_health"] == "Critical" else "warning", now_iso
                    ))
                    
            conn.commit()
            
        except Exception as e:
            logger.error(f"Error executing correlation rules for {device_id}: {e}")
            conn.rollback()
        finally:
            conn.close()

    # SNMP Walk helpers
    @staticmethod
    async def _get_scalar_oid(ip: str, community: str, mp_model: int, oid_str: str, snmp_engine) -> str:
        try:
            transport = await UdpTransportTarget.create((ip, 161), timeout=1.5, retries=1)
            res = await get_cmd(
                snmp_engine,
                CommunityData(community, mpModel=mp_model),
                transport,
                ContextData(),
                ObjectType(ObjectIdentity(oid_str))
            )
            errorIndication, errorStatus, errorIndex, varBinds = res
            if not errorIndication and not errorStatus and varBinds:
                return varBinds[0][1].prettyPrint()
        except Exception:
            pass
        return ""

    @staticmethod
    async def _walk_oid(ip: str, community: str, mp_model: int, oid_str: str, snmp_engine) -> dict:
        results = {}
        try:
            transport = await UdpTransportTarget.create((ip, 161), timeout=1.5, retries=1)
            authData = CommunityData(community, mpModel=mp_model)
            contextData = ContextData()
            
            start_oid_clean = oid_str.strip('.')
            prefix_tuple = tuple(int(x) for x in start_oid_clean.split('.'))
            varBinds = [ObjectType(ObjectIdentity(oid_str))]
            
            while True:
                res = await next_cmd(snmp_engine, authData, transport, contextData, *varBinds)
                errorIndication, errorStatus, errorIndex, varBindTable = res
                if errorIndication or errorStatus or not varBindTable:
                    break
                    
                firstVarBinds = varBindTable[0] if isinstance(varBindTable[0], list) else varBindTable
                if not firstVarBinds:
                    break
                
                current_var_bind = firstVarBinds[0]
                current_oid_tuple = current_var_bind[0].asTuple()
                
                if len(current_oid_tuple) < len(prefix_tuple) or current_oid_tuple[:len(prefix_tuple)] != prefix_tuple:
                    break
                    
                idx = current_oid_tuple[-1]
                val = current_var_bind[1]
                results[idx] = val.prettyPrint()
                
                varBinds = firstVarBinds
        except Exception:
            pass
        return results
