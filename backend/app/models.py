from pydantic import BaseModel, Field
from typing import Optional


class DeviceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    ip: str = Field(..., min_length=7)
    protocol: str = Field(default="ssh")
    port: int = Field(default=22, ge=1, le=65535)
    username: Optional[str] = ""
    password: Optional[str] = ""
    device_type: str = Field(..., min_length=1)
    description: str = Field(default="")
    group_id: Optional[int] = None
    credential_id: Optional[int] = None
    custom_arp_cmd: Optional[str] = ""
    custom_lldp_cmd: Optional[str] = ""
    custom_cdp_cmd: Optional[str] = ""
    custom_routing_cmd: Optional[str] = ""
    custom_info_cmd: Optional[str] = ""
    snmp_version: Optional[str] = "v2c"
    snmp_community: Optional[str] = "public"
    device_role: Optional[str] = "Access Switch"
    hardware_model: Optional[str] = ""
    os_version: Optional[str] = ""
    serial_number: Optional[str] = ""
    mac_address: Optional[str] = ""
    threshold_profile_id: Optional[int] = None
    syslog_hostname: Optional[str] = None


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip: Optional[str] = None
    protocol: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    device_type: Optional[str] = None
    description: Optional[str] = None
    group_id: Optional[int] = None
    credential_id: Optional[int] = None
    custom_arp_cmd: Optional[str] = None
    custom_lldp_cmd: Optional[str] = None
    custom_cdp_cmd: Optional[str] = None
    custom_routing_cmd: Optional[str] = None
    custom_info_cmd: Optional[str] = None
    snmp_version: Optional[str] = None
    snmp_community: Optional[str] = None
    device_role: Optional[str] = None
    hardware_model: Optional[str] = None
    os_version: Optional[str] = None
    serial_number: Optional[str] = None
    mac_address: Optional[str] = None
    threshold_profile_id: Optional[int] = None
    syslog_hostname: Optional[str] = None

class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="")
    parent_id: Optional[int] = None

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None

class ThresholdProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = ""
    broadcast_storm_warning: Optional[int] = 1000
    broadcast_storm_critical: Optional[int] = 5000
    multicast_storm_warning: Optional[int] = 1000
    multicast_storm_critical: Optional[int] = 5000
    unicast_storm_warning: Optional[int] = 80000
    unicast_storm_critical: Optional[int] = 120000
    port_flap_warning: Optional[int] = 3
    port_flap_critical: Optional[int] = 6
    port_flap_window: Optional[int] = 300
    crc_error_rate: Optional[float] = 0.05
    crc_error_delta: Optional[int] = 5
    frame_error_rate: Optional[float] = 0.05
    frame_error_delta: Optional[int] = 5
    transmission_error_rate: Optional[float] = 0.1
    transmission_error_delta: Optional[int] = 5

class ThresholdProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    broadcast_storm_warning: Optional[int] = None
    broadcast_storm_critical: Optional[int] = None
    multicast_storm_warning: Optional[int] = None
    multicast_storm_critical: Optional[int] = None
    unicast_storm_warning: Optional[int] = None
    unicast_storm_critical: Optional[int] = None
    port_flap_warning: Optional[int] = None
    port_flap_critical: Optional[int] = None
    port_flap_window: Optional[int] = None
    crc_error_rate: Optional[float] = None
    crc_error_delta: Optional[int] = None
    frame_error_rate: Optional[float] = None
    frame_error_delta: Optional[int] = None
    transmission_error_rate: Optional[float] = None
    transmission_error_delta: Optional[int] = None
