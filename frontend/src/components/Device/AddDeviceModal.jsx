import { useState, useEffect } from 'react'
import { X, Network, Eye, EyeOff, TestTube, Key, RefreshCw } from 'lucide-react'
import { devicesApi, groupsApi, credentialsApi, thresholdsApi } from '../../api/client'
import { useToast } from '../shared/ToastProvider'

const DEVICE_TYPES = [
  { value: 'cisco_ios',         label: 'Cisco IOS / IOS-XE' },
  { value: 'cisco_xe',          label: 'Cisco IOS-XE' },
  { value: 'cisco_nxos',        label: 'Cisco NX-OS' },
  { value: 'cisco_asa',         label: 'Cisco ASA' },
  { value: 'mikrotik_routeros', label: 'MikroTik RouterOS' },
  { value: 'juniper_junos',     label: 'Juniper JunOS' },
  { value: 'hp_procurve',       label: 'HP ProCurve / Aruba' },
  { value: 'hp_comware',        label: 'HP Comware (H3C)' },
  { value: 'ruckus_fastiron',   label: 'Ruckus ICX FastIron' },
  { value: 'huawei',            label: 'Huawei VRP' },
  { value: 'ruijie_os',         label: 'Ruijie OS' },
  { value: 'fortinet',          label: 'FortiGate' },
  { value: 'aruba_os',          label: 'Aruba OS' },
  { value: 'extreme_exos',      label: 'Extreme Networks EXOS' },
  { value: 'dell_os10',         label: 'Dell EMC OS10' },
  { value: 'paloalto_panos',    label: 'Palo Alto PAN-OS' },
  { value: 'allied_telesis',    label: 'Allied Telesis' },
  { value: 'vyos',              label: 'VyOS' },
]

const DEFAULT_PORTS = { ssh: 22, telnet: 23 }

const initial = {
  name: '', ip: '', protocol: 'ssh', port: 22,
  username: '', password: '', device_type: 'cisco_ios', description: '',
  group_id: '', credential_id: '', threshold_profile_id: '',
  custom_arp_cmd: '', custom_lldp_cmd: '', custom_cdp_cmd: '', custom_routing_cmd: '', custom_info_cmd: '',
  snmp_version: 'v2c', snmp_community: 'public', device_role: 'Access Switch',
  hardware_model: '', os_version: '', serial_number: '', mac_address: '',
  syslog_hostname: ''
}

const buildHierarchicalGroups = (groupsList) => {
  const map = {}
  const roots = []
  
  groupsList.forEach(g => {
    map[g.id] = { ...g, children: [] }
  })
  
  groupsList.forEach(g => {
    if (g.parent_id && map[g.parent_id]) {
      map[g.parent_id].children.push(map[g.id])
    } else {
      roots.push(map[g.id])
    }
  })
  
  const sortTree = (nodes) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    nodes.forEach(node => {
      if (node.children.length > 0) {
        sortTree(node.children)
      }
    })
  }
  sortTree(roots)
  
  const result = []
  const traverse = (node, depth = 0) => {
    result.push({
      id: node.id,
      name: node.name,
      depth: depth,
      displayName: '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└─ ' : '') + node.name
    })
    node.children.forEach(child => traverse(child, depth + 1))
  }
  
  roots.forEach(root => traverse(root, 0))
  return result
}

export default function AddDeviceModal({ onClose, onSuccess, editDevice = null }) {
  const [form, setForm]       = useState(editDevice ? {
    ...editDevice,
    password: '',  // Don't prefill password for edit
    group_id: editDevice.group_id || '',
    credential_id: editDevice.credential_id || '',
    threshold_profile_id: editDevice.threshold_profile_id || '',
    device_role: editDevice.device_role || 'Access Switch',
    hardware_model: editDevice.hardware_model || '',
    os_version: editDevice.os_version || '',
    serial_number: editDevice.serial_number || '',
    mac_address: editDevice.mac_address || '',
    syslog_hostname: editDevice.syslog_hostname || ''
  } : initial)
  const [showPass, setShowPass]   = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [groups, setGroups]       = useState([])
  const [credentials, setCredentials] = useState([])
  const [saveAsCredential, setSaveAsCredential] = useState(false)
  const [newCredentialName, setNewCredentialName] = useState('')
  const [thresholdProfiles, setThresholdProfiles] = useState([])
  const [testing, setTesting]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [serialPorts, setSerialPorts] = useState([])
  const toast = useToast()

  useEffect(() => {
    groupsApi.list().then(r => setGroups(r.data)).catch(() => {})
    credentialsApi.list().then(r => setCredentials(r.data)).catch(() => {})
    thresholdsApi.list().then(r => setThresholdProfiles(r.data)).catch(() => {})
    devicesApi.getSerialPorts().then(r => setSerialPorts(r.data)).catch(() => {})
  }, [])

  const set = (k, v) => {
    setForm(f => {
      const updated = { ...f, [k]: v }
      // Auto-set port when protocol changes
      if (k === 'protocol') {
        if (v === 'serial') {
          updated.port = 9600
          if (serialPorts.length > 0) {
            updated.ip = serialPorts[0].port
          } else {
            updated.ip = ''
          }
        } else {
          updated.port = DEFAULT_PORTS[v] || 22
          updated.ip = ''
        }
      }
      return updated
    })
    setTestResult(null)
  }

  const handleTest = async () => {
    if (!form.ip) {
      toast.error(form.protocol === 'serial' ? 'Isi Serial Port terlebih dahulu.' : 'Isi IP Address terlebih dahulu.')
      return
    }
    if (form.protocol !== 'serial' && !form.credential_id && !form.username) {
      toast.error('Isi username terlebih dahulu.')
      return
    }
    if (form.protocol !== 'serial' && !form.credential_id && !form.password && !editDevice) {
      toast.error('Isi password terlebih dahulu.')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const payload = { 
        ...form, 
        group_id: form.group_id ? parseInt(form.group_id) : null,
        credential_id: form.credential_id ? parseInt(form.credential_id) : null
      }
      const res = await devicesApi.testConnectionRaw(payload)
      setTestResult(res.data)
    } catch (e) {
      setTestResult({ success: false, message: e.response?.data?.detail || 'Test gagal.' })
    }
    setTesting(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name || !form.ip || !form.device_type) {
      toast.error('Harap isi semua field yang diperlukan.')
      return
    }
    if (form.protocol !== 'serial' && !form.credential_id && !form.username) {
      toast.error('Harap isi username.')
      return
    }
    if (form.protocol !== 'serial' && !form.credential_id && !form.password && !editDevice) {
      toast.error('Harap isi password.')
      return
    }
    setSaving(true)
    
    try {
      let finalForm = { ...form }
      
      // If saving as new credential template first
      if (!form.credential_id && saveAsCredential && newCredentialName) {
        const credRes = await credentialsApi.create({
          name: newCredentialName,
          username: form.username,
          password: form.password
        })
        if (credRes.data && credRes.data.id) {
          finalForm.credential_id = credRes.data.id
          finalForm.password = '' // Clear device table password since it's saved in credential
        }
      }
      
      const payload = { 
        ...finalForm, 
        group_id: finalForm.group_id ? parseInt(finalForm.group_id) : null,
        credential_id: finalForm.credential_id ? parseInt(finalForm.credential_id) : null,
        threshold_profile_id: finalForm.threshold_profile_id ? parseInt(finalForm.threshold_profile_id) : null
      }
      
      if (editDevice) {
        await devicesApi.update(editDevice.id, payload)
        toast.success('Device berhasil diupdate!')
      } else {
        await devicesApi.create(payload)
        toast.success('Device berhasil ditambahkan!')
      }
      onSuccess?.()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menyimpan device.')
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-slide">
        <div className="modal-header">
          <div className="modal-title">
            <Network size={18} />
            {editDevice ? 'Edit Device' : 'Tambah Device Baru'}
          </div>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nama Device *</label>
                <input className="form-control" placeholder="SW-Core-01" value={form.name}
                  onChange={e => set('name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">{form.protocol === 'serial' ? 'Serial Port *' : 'IP Address *'}</label>
                {form.protocol === 'serial' ? (
                  <div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select 
                        className="form-control"
                        value={form.ip === 'custom' || (!serialPorts.some(p => p.port === form.ip) && form.ip !== '') ? 'custom' : form.ip}
                        onChange={e => set('ip', e.target.value)}
                        required
                        style={{ flexGrow: 1 }}
                      >
                        <option value="">-- Pilih Serial Port --</option>
                        {serialPorts.map(p => (
                          <option key={p.port} value={p.port}>{p.port} ({p.description})</option>
                        ))}
                        <option value="custom">Input Manual...</option>
                      </select>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          devicesApi.getSerialPorts()
                            .then(r => {
                              setSerialPorts(r.data || []);
                              if (r.data && r.data.length > 0 && (!form.ip || !r.data.some(p => p.port === form.ip))) {
                                set('ip', r.data[0].port);
                              }
                            })
                            .catch(() => {});
                        }}
                        title="Re-scan / Deteksi Ulang Port Serial"
                        style={{ padding: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '38px', width: '38px' }}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>

                    {(form.ip === 'custom' || (!serialPorts.some(p => p.port === form.ip) && form.ip !== '')) && (
                      <div style={{ marginTop: '8px' }}>
                        <input 
                          className="form-control" 
                          placeholder="/dev/ttyUSB0 atau COM3" 
                          value={form.ip === 'custom' ? '' : form.ip}
                          onChange={e => set('ip', e.target.value)} 
                          required 
                          style={{ width: '100%' }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <input className="form-control" placeholder="192.168.1.1" value={form.ip}
                    onChange={e => set('ip', e.target.value)} required />
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Device Type *</label>
              <select className="form-control" value={form.device_type}
                onChange={e => set('device_type', e.target.value)}>
                {DEVICE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Kategori / Role Perangkat *</label>
              <select className="form-control" value={form.device_role}
                onChange={e => set('device_role', e.target.value)}>
                <option value="Access Switch">Access Switch</option>
                <option value="Distribution Switch">Distribution Switch</option>
                <option value="CoreSwitch">CoreSwitch</option>
                <option value="Firewall">Firewall</option>
                <option value="Router">Router</option>
                <option value="Server">Server</option>
                <option value="Network Controller">Network Controller</option>
                <option value="Access Point">Access Point</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Protokol *</label>
                <select className="form-control" value={form.protocol}
                  onChange={e => set('protocol', e.target.value)}>
                  <option value="ssh">SSH</option>
                  <option value="telnet">Telnet</option>
                  <option value="serial">Serial Console</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{form.protocol === 'serial' ? 'Baud Rate *' : 'Port *'}</label>
                {form.protocol === 'serial' ? (
                  <select 
                    className="form-control" 
                    value={form.port} 
                    onChange={e => set('port', parseInt(e.target.value))}
                    required
                  >
                    <option value={9600}>9600</option>
                    <option value={115200}>115200</option>
                    <option value={38400}>38400</option>
                    <option value={57600}>57600</option>
                    <option value={19200}>19200</option>
                    <option value={4800}>4800</option>
                  </select>
                ) : (
                  <input className="form-control" type="number" min="1" max="65535"
                    value={form.port} onChange={e => set('port', parseInt(e.target.value))} required />
                )}
              </div>
            </div>

            {form.protocol !== 'serial' && (
              <>
                <div className="form-group">
                  <label className="form-label">Kredensial Tersimpan (Opsional)</label>
                  <select 
                    className="form-control" 
                    value={form.credential_id || ''}
                    onChange={e => {
                      const val = e.target.value;
                      set('credential_id', val ? parseInt(val) : '');
                      if (val) {
                        const selected = credentials.find(c => c.id === parseInt(val));
                        if (selected) {
                          set('username', selected.username);
                          set('password', '');
                        }
                      } else {
                        set('username', '');
                        set('password', '');
                      }
                    }}
                  >
                    <option value="">(Input Manual / Buat Kredensial Baru)</option>
                    {credentials.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Username *</label>
                    <input className="form-control" placeholder="admin" value={form.username}
                      onChange={e => set('username', e.target.value)} required={!form.credential_id} disabled={!!form.credential_id} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password *</label>
                    <div style={{ position:'relative' }}>
                      <input
                        className="form-control"
                        type={showPass ? 'text' : 'password'}
                        placeholder={form.credential_id ? '(Menggunakan Kredensial Tersimpan)' : (editDevice ? '(kosong = tidak berubah)' : '••••••••')}
                        value={form.password}
                        onChange={e => set('password', e.target.value)}
                        required={!editDevice && !form.credential_id}
                        disabled={!!form.credential_id}
                        style={{ paddingRight: '36px' }}
                      />
                      {!form.credential_id && (
                        <button type="button"
                          onClick={() => setShowPass(s => !s)}
                          style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}
                        >
                          {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {!form.credential_id && (
                  <div style={{ padding: '10px 14px', background: 'var(--bg-card-2)', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input 
                        type="checkbox" 
                        checked={saveAsCredential} 
                        onChange={e => setSaveAsCredential(e.target.checked)} 
                      />
                      <span>Simpan kredensial ini sebagai template</span>
                    </label>
                    
                    {saveAsCredential && (
                      <div className="form-group" style={{ marginTop: '10px', marginBottom: '0' }}>
                        <label className="form-label" style={{ fontSize: '12px' }}>Nama Template Kredensial *</label>
                        <input 
                          className="form-control" 
                          placeholder="Template Kredensial Cisco Switch" 
                          value={newCredentialName}
                          onChange={e => setNewCredentialName(e.target.value)} 
                          required={saveAsCredential}
                        />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Deskripsi (opsional)</label>
                <input className="form-control" placeholder="Core switch lantai 1..."
                  value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Group</label>
                <select className="form-control" value={form.group_id || ''}
                  onChange={e => set('group_id', e.target.value)}>
                  <option value="">(Tanpa Group)</option>
                  {buildHierarchicalGroups(groups).map(g => (
                    <option key={g.id} value={g.id}>
                      {g.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Profil Threshold Anomali</label>
              <select className="form-control" value={form.threshold_profile_id || ''}
                onChange={e => {
                  const val = e.target.value;
                  set('threshold_profile_id', val ? parseInt(val) : '');
                }}>
                <option value="">(Default Sistem / Global)</option>
                {thresholdProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Custom Device Details Section */}
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
                Kustomisasi Detail Perangkat (Opsional / Manual)
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Model Perangkat</label>
                  <input className="form-control" placeholder="ICX7150-C12"
                    value={form.hardware_model || ''} onChange={e => set('hardware_model', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Versi OS</label>
                  <input className="form-control" placeholder="08.0.90d"
                    value={form.os_version || ''} onChange={e => set('os_version', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Serial Number</label>
                  <input className="form-control" placeholder="BHL1234567"
                    value={form.serial_number || ''} onChange={e => set('serial_number', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">MAC Address</label>
                  <input className="form-control" placeholder="00:11:22:33:44:55"
                    value={form.mac_address || ''} onChange={e => set('mac_address', e.target.value)} />
                </div>
              </div>
              <div className="form-group mt-3">
                <label className="form-label">Syslog Hostname / Alias (Pencocokan Syslog Header)</label>
                <input className="form-control" placeholder="Contoh: AT48-LT-9A, DS-HERRITAGE-4650"
                  value={form.syslog_hostname || ''} onChange={e => set('syslog_hostname', e.target.value)} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                  Isi jika nama host yang dikirim via syslog berbeda dengan Nama Device di atas (penting jika berada di balik Docker NAT).
                </span>
              </div>
            </div>
            <div className="form-group mt-2">
              <button 
                type="button" 
                className="btn btn-ghost" 
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <span>Advanced Settings (Custom Commands & SNMP)</span>
                <span>{showAdvanced ? '▲' : '▼'}</span>
              </button>
            </div>

            {showAdvanced && (
              <div className="animate-slide" style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div className="form-row mb-3">
                  <div className="form-group">
                    <label className="form-label">SNMP Version</label>
                    <select className="form-control" value={form.snmp_version} onChange={e => set('snmp_version', e.target.value)}>
                      <option value="v1">v1</option>
                      <option value="v2c">v2c</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">SNMP Community</label>
                    <input className="form-control" placeholder="public" type="text"
                      value={form.snmp_community} onChange={e => set('snmp_community', e.target.value)} />
                  </div>
                </div>
                <hr style={{ borderColor: 'var(--border)', margin: '10px 0' }} />
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Custom ARP Command</label>
                    <input className="form-control" placeholder="show ip arp"
                      value={form.custom_arp_cmd || ''} onChange={e => set('custom_arp_cmd', e.target.value)} />
                    <label className="form-label mt-3">Custom CDP Command</label>
                    <input className="form-control" placeholder="show cdp neighbors detail"
                      value={form.custom_cdp_cmd || ''} onChange={e => set('custom_cdp_cmd', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Custom LLDP Command</label>
                    <input className="form-control" placeholder="show lldp neighbors detail"
                      value={form.custom_lldp_cmd || ''} onChange={e => set('custom_lldp_cmd', e.target.value)} />
                    <label className="form-label mt-3">Custom Routing Command</label>
                    <input className="form-control" placeholder="show ip route"
                      value={form.custom_routing_cmd || ''} onChange={e => set('custom_routing_cmd', e.target.value)} />
                  </div>
                </div>
                <div className="form-group mt-3">
                  <label className="form-label">Custom Info/Version Command</label>
                  <input className="form-control" placeholder="show version / show chassis hardware"
                    value={form.custom_info_cmd || ''} onChange={e => set('custom_info_cmd', e.target.value)} />
                </div>
              </div>
            )}

            {testResult && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: `1px solid ${testResult.success ? 'var(--success)' : 'var(--danger)'}`,
                background: testResult.success ? 'var(--success-glow)' : 'var(--danger-glow)',
                color: testResult.success ? 'var(--success)' : 'var(--danger)',
                fontSize: '12px',
                fontFamily: 'JetBrains Mono, monospace',
                marginTop: '4px',
              }}>
                {testResult.success ? '✓ ' : '✗ '}{testResult.message}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Batal</button>
            <button type="button" className="btn btn-ghost" onClick={handleTest} disabled={testing}>
              {testing ? <><span className="loading-spinner" style={{width:14,height:14}} /> Testing...</> : <><TestTube size={14} /> Test Koneksi</>}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="loading-spinner" style={{width:14,height:14}} /> Menyimpan...</> : (editDevice ? 'Update Device' : 'Tambah Device')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
