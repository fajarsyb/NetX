import { useState, useEffect, useRef } from 'react'
import { Shield, ShieldAlert, ShieldCheck, ShieldAlert as ShieldWarning, RefreshCw, Search, AlertOctagon, Terminal, Play, HelpCircle } from 'lucide-react'
import { credentialsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

const DEVICE_TYPES = [
  { value: 'ruijie_os', label: 'Ruijie OS' },
  { value: 'allied_telesis', label: 'Allied Telesis (AW+)' },
  { value: 'cisco_ios', label: 'Cisco IOS' },
  { value: 'cisco_xe', label: 'Cisco IOS-XE' },
  { value: 'cisco_nxos', label: 'Cisco NX-OS' },
  { value: 'cisco_asa', label: 'Cisco ASA' },
  { value: 'mikrotik_routeros', label: 'MikroTik RouterOS' },
  { value: 'juniper_junos', label: 'Juniper Junos' },
  { value: 'hp_procurve', label: 'HP ProCurve' },
  { value: 'hp_comware', label: 'HP Comware' },
  { value: 'ruckus_fastiron', label: 'Ruckus FastIron' },
  { value: 'huawei', label: 'Huawei VRP' },
  { value: 'fortinet', label: 'FortiOS (Fortinet)' },
  { value: 'aruba_os', label: 'ArubaOS' },
  { value: 'extreme_exos', label: 'ExtremeXOS' },
  { value: 'dell_os10', label: 'Dell OS10' },
  { value: 'paloalto_panos', label: 'Palo Alto PAN-OS' },
  { value: 'vyos', label: 'VyOS' }
]

export default function CredentialScan() {
  const [activeTab, setActiveTab] = useState('inventory') // 'inventory' | 'custom'
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [scanLogs, setScanLogs] = useState([])
  const [progress, setProgress] = useState(0)

  // Custom Target Form States
  const [customIp, setCustomIp] = useState('')
  const [customProtocol, setCustomProtocol] = useState('ssh')
  const [customPort, setCustomPort] = useState('')
  const [customDeviceType, setCustomDeviceType] = useState('ruijie_os')
  const [customScanning, setCustomScanning] = useState(false)
  const [customScanLogs, setCustomScanLogs] = useState([])
  const [customResult, setCustomResult] = useState(null)
  
  const toast = useToast()
  const logEndRef = useRef(null)
  const customLogEndRef = useRef(null)

  const fetchCompliance = async () => {
    setLoading(true)
    try {
      const res = await credentialsApi.getCompliance()
      setRecords(res.data)
    } catch (err) {
      toast.error('Gagal mengambil data kepatuhan kredensial.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'inventory') {
      fetchCompliance()
    }
  }, [activeTab])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [scanLogs])

  useEffect(() => {
    if (customLogEndRef.current) {
      customLogEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [customScanLogs])

  // Handle auto-ports for protocol switches
  useEffect(() => {
    setCustomPort(customProtocol === 'telnet' ? '23' : '22')
  }, [customProtocol])

  const triggerScan = async () => {
    setScanning(true)
    setScanLogs(['[*] Memulai pemindaian kepatuhan kredensial...', '[*] Mengambil daftar perangkat dan template dari database...'])
    setProgress(0)
    
    try {
      const res = await credentialsApi.runScan()
      const results = res.data

      let logs = ['[*] Menemukan ' + results.length + ' perangkat untuk dipindai.', '[*] Memulai penelusuran SSH/Telnet dengan Semaphore (maks 5 paralel)...']
      setScanLogs([...logs])

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const num = i + 1
        const percent = Math.round((num / results.length) * 100)
        
        await new Promise(resolve => setTimeout(resolve, 300))
        
        let statusLog = ''
        if (r.status === 'secure') {
          statusLog = `[SUCCESS] ${r.device_name} (${r.device_ip}) - AMAN (Hanya kredensial resmi yang berhasil login).`
        } else if (r.status === 'vulnerable') {
          statusLog = `[ALERT] ${r.device_name} (${r.device_ip}) - RENTAN (Kredensial default cocok: ${r.working_defaults.join(', ')}).`
        } else if (r.status === 'weak') {
          statusLog = `[WARNING] ${r.device_name} (${r.device_ip}) - LEMAH (Template kredensial lain berhasil masuk: ${r.working_db_templates.join(', ')}).`
        } else {
          statusLog = `[ERROR] ${r.device_name} (${r.device_ip}) - UNREACHABLE (${r.error_message || 'Tidak dapat terhubung'}).`
        }
        
        logs.push(`[${num}/${results.length}] ${statusLog}`)
        setScanLogs([...logs])
        setProgress(percent)
      }

      logs.push('[*] Pemindaian selesai! Menyimpan hasil ke database...')
      setScanLogs([...logs])
      setRecords(results)
      toast.success('Pemindaian kepatuhan kredensial selesai.')
    } catch (err) {
      setScanLogs(prev => [...prev, '[FATAL] Gagal menjalankan pemindaian: ' + (err.response?.data?.detail || err.message)])
      toast.error('Gagal menjalankan pemindaian kredensial.')
    } finally {
      setScanning(false)
    }
  }

  const triggerCustomScan = async (e) => {
    e.preventDefault()
    if (!customIp) {
      toast.error('Silakan isi IP Address perangkat.')
      return
    }

    setCustomScanning(true)
    setCustomResult(null)
    
    let logs = [
      `[*] Memulai scan kustom untuk ${customIp}...`,
      `[*] Protokol: ${customProtocol.toUpperCase()} | Port: ${customPort}`,
      `[*] Tipe Perangkat: ${customDeviceType}`,
      `[*] Memeriksa reachability perangkat...`
    ]
    setCustomScanLogs([...logs])

    try {
      const payload = {
        ip: customIp,
        protocol: customProtocol,
        port: customPort ? parseInt(customPort, 10) : null,
        device_type: customDeviceType
      }
      
      const res = await credentialsApi.scanTarget(payload)
      const r = res.data
      
      await new Promise(resolve => setTimeout(resolve, 800)) // visual drift

      if (r.status === 'unreachable') {
        logs.push(`[ERROR] Perangkat tidak merespons: ${r.error_message || 'Port tertutup atau IP mati.'}`)
      } else {
        logs.push(`[+] Perangkat terhubung secara ${customProtocol.toUpperCase()}. Memulai pengujian kredensial...`)
        
        // Print detailed login failures/success simulation for UX
        logs.push(`[*] Mencoba default password Allied Telesis & Ruijie...`)
        await new Promise(resolve => setTimeout(resolve, 400))
        
        if (r.working_defaults && r.working_defaults.length > 0) {
          logs.push(`[ALERT] Ditemukan kredensial default yang COCOK:`)
          r.working_defaults.forEach(d => {
            logs.push(`   -> [RENTAN] ${d}`)
          })
        } else {
          logs.push(`[+] Tidak ada default password yang berhasil login.`)
        }

        logs.push(`[*] Menguji penetrasi login menggunakan template kredensial di sistem...`)
        await new Promise(resolve => setTimeout(resolve, 400))

        if (r.working_db_templates && r.working_db_templates.length > 0) {
          logs.push(`[WARNING] Ditemukan template database lain yang COCOK:`)
          r.working_db_templates.forEach(t => {
            logs.push(`   -> [LEMAH] Template: ${t}`)
          })
        } else {
          logs.push(`[+] Tidak ada template database lain yang dapat menembus login.`)
        }

        if (r.status === 'secure') {
          logs.push(`[SUCCESS] Scan Selesai: Kredensial target AMAN.`)
        } else if (r.status === 'vulnerable') {
          logs.push(`[ALERT] Scan Selesai: Target RENTAN terhadap sandi default pabrik.`)
        } else if (r.status === 'weak') {
          logs.push(`[WARNING] Scan Selesai: Target memiliki proteksi LEMAH karena template lain cocok.`)
        }
      }

      setCustomScanLogs([...logs])
      setCustomResult(r)
      toast.success('Pemindaian target kustom selesai.')
    } catch (err) {
      logs.push(`[FATAL] Gagal menyelesaikan scan: ` + (err.response?.data?.detail || err.message))
      setCustomScanLogs([...logs])
      toast.error('Gagal memindai target kustom.')
    } finally {
      setCustomScanning(false)
    }
  }

  // Summary counts
  const totalScanned = records.length
  const vulnerableCount = records.filter(r => r.status === 'vulnerable').length
  const weakCount = records.filter(r => r.status === 'weak').length
  const secureCount = records.filter(r => r.status === 'secure').length
  const unreachableCount = records.filter(r => r.status === 'unreachable').length

  // Filtered inventory records
  const filteredRecords = records.filter(r => {
    const matchesSearch = r.device_name.toLowerCase().includes(search.toLowerCase()) || 
                          r.device_ip.includes(search) || 
                          r.device_type.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = statusFilter === 'all' || r.status === statusFilter
    return matchesSearch && matchesFilter
  })

  const getStatusBadge = (status) => {
    switch (status) {
      case 'secure':
        return (
          <span className="badge badge-online" style={{ textTransform: 'none', background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
            <ShieldCheck size={13} style={{ marginRight: '4px' }} /> Secure
          </span>
        )
      case 'weak':
        return (
          <span className="badge badge-online" style={{ textTransform: 'none', background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
            <ShieldWarning size={13} style={{ marginRight: '4px' }} /> Weak (Other Template)
          </span>
        )
      case 'vulnerable':
        return (
          <span className="badge badge-offline" style={{ textTransform: 'none', background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', fontWeight: 700, animation: 'pulse 2s infinite' }}>
            <ShieldAlert size={13} style={{ marginRight: '4px' }} /> Vulnerable (Default PW)
          </span>
        )
      default:
        return (
          <span className="badge badge-unknown" style={{ textTransform: 'none' }}>
            <AlertOctagon size={13} style={{ marginRight: '4px' }} /> Unreachable
          </span>
        )
    }
  }

  return (
    <div className="page-container animate-fade">
      {/* Tab bar header */}
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <div className="page-title">
            <Shield size={22} style={{ color: 'var(--primary)' }} />
            Scan Keamanan Kredensial Perangkat
          </div>
          <div className="page-subtitle">
            Deteksi perangkat yang masih menggunakan password default dan uji coba login kustom.
          </div>
        </div>

        {activeTab === 'inventory' && (
          <button 
            className="btn btn-primary" 
            onClick={triggerScan} 
            disabled={scanning || loading}
            style={{ gap: '8px' }}
          >
            <RefreshCw size={15} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
            {scanning ? 'Memindai...' : 'Scan Inventory'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        <button 
          className={`tab-btn ${activeTab === 'inventory' ? 'active' : ''}`}
          onClick={() => setActiveTab('inventory')}
        >
          Scan Inventory Sistem
        </button>
        <button 
          className={`tab-btn ${activeTab === 'custom' ? 'active' : ''}`}
          onClick={() => setActiveTab('custom')}
        >
          Scan Target Kustom (IP & Protokol)
        </button>
      </div>

      {activeTab === 'inventory' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Summary Cards */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: 0 }}>
            <div className="stat-card blue">
              <div className="stat-label">Total Terdaftar</div>
              <div className="stat-value">{totalScanned}</div>
              <div className="stat-sub">Perangkat dipindai</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Secure (Aman)</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{secureCount}</div>
              <div className="stat-sub">Kredensial aman</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Weak (Sandi Lain)</div>
              <div className="stat-value" style={{ color: 'var(--warning)' }}>{weakCount}</div>
              <div className="stat-sub">Template lain cocok</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Vulnerable (Rentan)</div>
              <div className="stat-value" style={{ color: 'var(--danger)', textShadow: vulnerableCount > 0 ? '0 0 10px rgba(239,68,68,0.3)' : 'none' }}>{vulnerableCount}</div>
              <div className="stat-sub">Sandi default aktif!</div>
            </div>
            <div className="stat-card cyan">
              <div className="stat-label">Unreachable</div>
              <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{unreachableCount}</div>
              <div className="stat-sub">Mati / port tertutup</div>
            </div>
          </div>

          {/* Vulnerable Alert Notice */}
          {vulnerableCount > 0 && (
            <div 
              className="card" 
              style={{ 
                background: 'rgba(239, 68, 68, 0.06)', 
                border: '1px solid rgba(239, 68, 68, 0.25)', 
                borderRadius: '12px', 
                padding: '16px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px' 
              }}
            >
              <ShieldAlert size={28} className="text-danger animate-pulse" />
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
                  Peringatan Keamanan Kredensial Default!
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Ditemukan {vulnerableCount} perangkat yang masih menggunakan kombinasi username/password default (misal Allied Telesis `manager/friend` atau Ruijie `admin/admin`). Segera amankan konfigurasi perangkat bersangkutan!
                </div>
              </div>
            </div>
          )}

          {/* Live Scan Logging Panel */}
          {scanning && (
            <div className="card animate-slide" style={{ padding: '20px', background: 'var(--bg-card-2)' }}>
              <div className="flex-between mb-8">
                <span style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
                  <Terminal size={15} /> Log Scanner Kredensial Terkini ({progress}%)
                </span>
                <span className="loading-spinner" style={{ width: '14px', height: '14px' }} />
              </div>
              
              <div className="refresh-progress" style={{ height: '4px', marginBottom: '16px', background: 'var(--border)' }}>
                <div className="refresh-progress-bar" style={{ width: `${progress}%` }} />
              </div>

              <div 
                style={{ 
                  height: '180px', 
                  background: 'var(--bg-base)', 
                  borderRadius: '8px', 
                  padding: '12px', 
                  fontFamily: 'JetBrains Mono, monospace', 
                  fontSize: '12px', 
                  color: '#38bdf8', 
                  overflowY: 'auto',
                  border: '1px solid var(--border)'
                }}
              >
                {scanLogs.map((log, idx) => {
                  let color = '#38bdf8'
                  if (log.includes('[SUCCESS]')) color = 'var(--success)'
                  if (log.includes('[ALERT]')) color = 'var(--danger)'
                  if (log.includes('[WARNING]')) color = 'var(--warning)'
                  if (log.includes('[ERROR]') || log.includes('[FATAL]')) color = 'var(--text-muted)'
                  return (
                    <div key={idx} style={{ color, marginBottom: '6px', lineHeight: '1.4' }}>{log}</div>
                  )
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* Main Table */}
          <div className="card">
            {/* Table Filters */}
            <div className="flex-between mb-16" style={{ gap: '16px', flexWrap: 'wrap' }}>
              <div className="search-box" style={{ width: '100%', maxWidth: '360px' }}>
                <Search className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Cari berdasarkan nama, IP, atau tipe..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              <div className="flex-center gap-8">
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Status Kepatuhan:</span>
                <select 
                  className="form-control" 
                  style={{ width: '180px', padding: '6px 10px', fontSize: '13px' }}
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="all">Semua Status ({totalScanned})</option>
                  <option value="secure">Secure ({secureCount})</option>
                  <option value="weak">Weak ({weakCount})</option>
                  <option value="vulnerable">Vulnerable ({vulnerableCount})</option>
                  <option value="unreachable">Unreachable ({unreachableCount})</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="loading-overlay" style={{ minHeight: '300px' }}>
                <div className="loading-spinner" />
                <span className="text-muted" style={{ marginLeft: '12px' }}>Mengambil status kepatuhan...</span>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '300px', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                <ShieldCheck size={48} className="text-muted" style={{ marginBottom: '16px', opacity: 0.5 }} />
                <div className="empty-title">Tidak ada data kepatuhan</div>
                <div className="empty-desc">
                  Tekan tombol "Scan Sekarang" untuk mengumpulkan status kepatuhan kata sandi perangkat di inventory.
                </div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Nama Perangkat</th>
                      <th>IP Address</th>
                      <th>Tipe & Protokol</th>
                      <th>Status Keamanan</th>
                      <th>Kredensial Bocor / Kerentanan</th>
                      <th>Scan Terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map(r => (
                      <tr key={r.device_id}>
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.device_name}</td>
                        <td className="font-mono" style={{ fontSize: '12.5px' }}>{r.device_ip}</td>
                        <td>
                          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{r.device_type}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '2px' }}>{r.protocol}</div>
                        </td>
                        <td>{getStatusBadge(r.status)}</td>
                        <td>
                          {r.status === 'secure' && (
                            <span style={{ fontSize: '12.5px', color: 'var(--success)' }}>
                              Sandi aman. Tidak ada kebocoran terdeteksi.
                            </span>
                          )}
                          {r.status === 'vulnerable' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ fontSize: '12.5px', color: 'var(--danger)', fontWeight: 600 }}>
                                ⚠️ Kredensial Default Berhasil Login:
                              </span>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {r.working_defaults.map((d, idx) => (
                                  <span key={idx} style={{ fontSize: '11px', background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                                    {d}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {r.status === 'weak' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ fontSize: '12.5px', color: 'var(--warning)', fontWeight: 600 }}>
                                ⚠️ Terakses template kredensial lain:
                              </span>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
                                {r.working_db_templates.map((t, idx) => (
                                  <span key={idx} style={{ fontSize: '11px', background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 }}>
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {r.status === 'unreachable' && (
                            <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                              {r.error_message || 'Tidak dapat terhubung.'}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '12.5px' }}>
                          {r.scanned_at ? new Date(r.scanned_at).toLocaleString('id-ID') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Form Card */}
          <div className="card">
            <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={16} className="text-primary" /> Target Baru
            </h3>
            
            <form onSubmit={triggerCustomScan} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">IP Address Perangkat</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="Contoh: 192.168.10.25" 
                  value={customIp}
                  onChange={e => setCustomIp(e.target.value)}
                  required
                  disabled={customScanning}
                />
              </div>

              <div className="form-row" style={{ margin: 0 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Protokol</label>
                  <select 
                    className="form-control"
                    value={customProtocol}
                    onChange={e => setCustomProtocol(e.target.value)}
                    disabled={customScanning}
                  >
                    <option value="ssh">SSH</option>
                    <option value="telnet">Telnet</option>
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Port</label>
                  <input 
                    type="number" 
                    className="form-control"
                    placeholder="Port" 
                    value={customPort}
                    onChange={e => setCustomPort(e.target.value)}
                    disabled={customScanning}
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Tipe OS Perangkat</label>
                <select 
                  className="form-control"
                  value={customDeviceType}
                  onChange={e => setCustomDeviceType(e.target.value)}
                  disabled={customScanning}
                >
                  {DEVICE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={customScanning || !customIp}
                style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
              >
                {customScanning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Memindai...
                  </>
                ) : (
                  <>
                    <Shield size={14} /> Mulai Scan
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Results Console Log / Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Terminal Console */}
            <div className="card" style={{ background: 'var(--bg-card-2)', border: '1px solid var(--border)' }}>
              <div className="flex-between mb-12">
                <span style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
                  <Terminal size={15} /> Console Scan Target Kustom
                </span>
                {customScanning && <span className="loading-spinner" style={{ width: '14px', height: '14px' }} />}
              </div>

              <div 
                style={{ 
                  height: '240px', 
                  background: 'var(--bg-base)', 
                  borderRadius: '8px', 
                  padding: '16px', 
                  fontFamily: 'JetBrains Mono, monospace', 
                  fontSize: '12.5px', 
                  color: '#38bdf8', 
                  overflowY: 'auto',
                  border: '1px solid var(--border)'
                }}
              >
                {customScanLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', height: '100%' }}>
                    <HelpCircle size={16} /> Console siap. Silakan klik "Mulai Scan" untuk meluncurkan pengujian kredensial.
                  </div>
                ) : (
                  customScanLogs.map((log, idx) => {
                    let color = '#38bdf8'
                    if (log.includes('[SUCCESS]')) color = 'var(--success)'
                    if (log.includes('[ALERT]') || log.includes('[RENTAN]')) color = 'var(--danger)'
                    if (log.includes('[WARNING]') || log.includes('[LEMAH]')) color = 'var(--warning)'
                    if (log.includes('[ERROR]') || log.includes('[FATAL]')) color = 'var(--text-muted)'
                    return (
                      <div key={idx} style={{ color, marginBottom: '6px', lineHeight: '1.4' }}>{log}</div>
                    )
                  })
                )}
                <div ref={customLogEndRef} />
              </div>
            </div>

            {/* Custom Scan Result Details Box */}
            {customResult && (
              <div className="card animate-slide" style={{ padding: '24px', borderLeft: `5px solid ${customResult.status === 'secure' ? 'var(--success)' : customResult.status === 'vulnerable' ? 'var(--danger)' : customResult.status === 'weak' ? 'var(--warning)' : 'var(--text-muted)'}` }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {customResult.status === 'secure' ? (
                    <ShieldCheck className="text-success" size={20} />
                  ) : (
                    <ShieldAlert className={customResult.status === 'vulnerable' ? 'text-danger' : 'text-warning'} size={20} />
                  )}
                  Hasil Penilaian Keamanan: {customResult.status.toUpperCase()}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                    <div style={{ padding: '12px', background: 'var(--bg-card-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Target IP</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px', fontFamily: 'monospace' }}>{customResult.device_ip}</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-card-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Protokol & Port</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px', textTransform: 'uppercase' }}>{customResult.protocol} ({customPort})</div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-card-2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tipe OS</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px' }}>{DEVICE_TYPES.find(t => t.value === customResult.device_type)?.label || customResult.device_type}</div>
                    </div>
                  </div>

                  <div className="divider" style={{ margin: 0 }} />

                  <div>
                    {customResult.status === 'secure' && (
                      <div style={{ padding: '16px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', color: 'var(--success)', fontSize: '13.5px' }}>
                        <strong>Aman (Secure)</strong>: Perangkat ini tidak dapat diakses menggunakan kata sandi default Ruijie/Allied Telesis atau template database lain. Kredensial terlindungi dengan baik.
                      </div>
                    )}
                    {customResult.status === 'vulnerable' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ padding: '16px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: 'var(--danger)', fontSize: '13.5px' }}>
                          <strong>Rentan (Vulnerable)</strong>: Perangkat ini masih membiarkan akses login menggunakan kata sandi default pabrik. Harap segera matikan kredensial bawaan berikut!
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Password Bawaan yang Bocor:</span>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {customResult.working_defaults.map((d, idx) => (
                              <span key={idx} style={{ fontSize: '11px', background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', padding: '4px 10px', borderRadius: '4px', fontWeight: 600 }}>
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {customResult.status === 'weak' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ padding: '16px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', color: 'var(--warning)', fontSize: '13.5px' }}>
                          <strong>Lemah (Weak Protection)</strong>: Meskipun tidak rentan sandi default, perangkat ini membiarkan akses masuk menggunakan template kredensial database lain yang tidak dialokasikan untuk perangkat ini.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Template Kredensial yang Cocok:</span>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {customResult.working_db_templates.map((t, idx) => (
                              <span key={idx} style={{ fontSize: '11px', background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', padding: '4px 10px', borderRadius: '4px', fontWeight: 600 }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {customResult.status === 'unreachable' && (
                      <div style={{ padding: '16px', background: 'var(--bg-card-2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '13.5px' }}>
                        <strong>Tidak Dapat Dijangkau (Unreachable)</strong>: Scanner gagal membangun socket koneksi ke host IP atau port tujuan. Alasan: {customResult.error_message}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
