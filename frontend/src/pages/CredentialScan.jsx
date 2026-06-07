import { useState, useEffect, useRef } from 'react'
import { Shield, ShieldAlert, ShieldCheck, ShieldAlert as ShieldWarning, RefreshCw, Search, AlertOctagon, Terminal } from 'lucide-react'
import { credentialsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

export default function CredentialScan() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [scanLogs, setScanLogs] = useState([])
  const [progress, setProgress] = useState(0)
  
  const toast = useToast()
  const logEndRef = useRef(null)

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
    fetchCompliance()
  }, [])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [scanLogs])

  const triggerScan = async () => {
    setScanning(true)
    setScanLogs(['[*] Memulai pemindaian kepatuhan kredensial...', '[*] Mengambil daftar perangkat dan template dari database...'])
    setProgress(0)
    
    try {
      // We will perform the scan request.
      // In the backend, we run the scan concurrently.
      // To simulate progress log in the UI during this call:
      // Since it's a single POST call, we can simulate logs matching the devices
      // being processed, or just receive the response and dump the final logs.
      // Wait, let's write a beautiful simulation or print the final logs, 
      // but even better: we can print logs step-by-step or compile them based on the results returned.
      const res = await credentialsApi.runScan()
      const results = res.data

      // Build realistic progress logs based on actual results
      let logs = ['[*] Menemukan ' + results.length + ' perangkat untuk dipindai.', '[*] Memulai penelusuran SSH/Telnet dengan Semaphore (maks 5 paralel)...']
      setScanLogs([...logs])

      // Animate log writing for high-premium feel
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const num = i + 1
        const percent = Math.round((num / results.length) * 100)
        
        await new Promise(resolve => setTimeout(resolve, 300)) // delay for premium simulation
        
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

  // Stats calculation
  const totalScanned = records.length
  const vulnerableCount = records.filter(r => r.status === 'vulnerable').length
  const weakCount = records.filter(r => r.status === 'weak').length
  const secureCount = records.filter(r => r.status === 'secure').length
  const unreachableCount = records.filter(r => r.status === 'unreachable').length

  // Filters
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
      <div className="page-header">
        <div>
          <div className="page-title">
            <Shield size={22} style={{ color: 'var(--primary)' }} />
            Scan Keamanan Kredensial Perangkat
          </div>
          <div className="page-subtitle">
            Pindai kepatuhan kata sandi default Ruijie & Allied Telesis, serta uji coba penetrasi login menggunakan template kredensial sistem.
          </div>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={triggerScan} 
          disabled={scanning || loading}
          style={{ gap: '8px' }}
        >
          <RefreshCw size={15} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
          {scanning ? 'Memindai...' : 'Scan Sekarang'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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
          className="card animate-slide" 
          style={{ 
            background: 'rgba(239, 68, 68, 0.06)', 
            border: '1px solid rgba(239, 68, 68, 0.25)', 
            borderRadius: '12px', 
            padding: '16px', 
            marginBottom: '24px', 
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
        <div className="card mb-24 animate-slide" style={{ padding: '20px', background: 'var(--bg-card-2)' }}>
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
              let color = '#38bdf8' // cyan
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

      {/* Controls & Table Card */}
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
            <span className="text-muted" style={{ marginLeft: '12px' }}>Mengambil status kepatuhan kredensial...</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '300px', border: '1px dashed var(--border)', borderRadius: '8px' }}>
            <ShieldCheck size={48} className="text-muted" style={{ marginBottom: '16px', opacity: 0.5 }} />
            <div className="empty-title">Tidak ada data kepatuhan</div>
            <div className="empty-desc">
              Silakan lakukan pemindaian kredensial dengan menekan tombol "Scan Sekarang" untuk mengumpulkan status kepatuhan kata sandi di inventory.
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
  )
}
