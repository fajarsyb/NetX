import { useState, useEffect, useRef } from 'react'
import { 
  Radio, RefreshCw, Search, Trash2, Clock, 
  AlertTriangle, Info, ShieldAlert, ChevronLeft, ChevronRight, Ban, Terminal, ExternalLink
} from 'lucide-react'
import { snmpTrapsApi, devicesApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'
import { useTheme } from '../context/ThemeContext'

export default function SnmpTraps() {
  const [traps, setTraps] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedPayload, setSelectedPayload] = useState(null)
  
  // Filters & Pagination
  const [page, setPage] = useState(1)
  const [limit] = useState(50)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  
  const [filterDevice, setFilterDevice] = useState('')
  const [filterGeneric, setFilterGeneric] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Auto-refresh logic
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefreshTimerRef = useRef(null)

  const { user } = useAuth()
  const toast = useToast()
  const { theme } = useTheme()
  const isViewer = user?.role === 'viewer'

  const TRAP_TYPES = {
    0: { label: 'coldStart', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)' },
    1: { label: 'warmStart', color: '#eab308', bg: 'rgba(234, 179, 8, 0.08)' },
    2: { label: 'linkDown', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.15)' },
    3: { label: 'linkUp', color: 'var(--success)', bg: 'rgba(16, 185, 129, 0.12)' },
    4: { label: 'authenticationFailure', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.12)' },
    5: { label: 'egpNeighborLoss', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },
    6: { label: 'enterpriseSpecific', color: 'var(--primary)', bg: 'rgba(59, 130, 246, 0.08)' }
  }

  const fetchDevices = async () => {
    try {
      const res = await devicesApi.list()
      setDevices(res.data)
    } catch (_) {}
  }

  const fetchTraps = async (showSilently = false) => {
    if (!showSilently) setLoading(true)
    try {
      const params = {
        page,
        limit,
        device_id: filterDevice || undefined,
        generic_trap: filterGeneric !== '' ? parseInt(filterGeneric) : undefined,
        search: searchQuery || undefined
      }
      const res = await snmpTrapsApi.list(params)
      setTraps(res.data.results)
      setTotal(res.data.total)
      setTotalPages(res.data.pages)
    } catch (err) {
      toast.error('Gagal mengambil log SNMP Traps.')
    } finally {
      if (!showSilently) setLoading(false)
    }
  }

  useEffect(() => {
    fetchDevices()
  }, [])

  // Refetch when page or filters change
  useEffect(() => {
    fetchTraps()
  }, [page, filterDevice, filterGeneric, searchQuery])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filterDevice, filterGeneric, searchQuery])

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        fetchTraps(true)
      }, 5000)
    } else {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current)
      }
    }
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current)
      }
    }
  }, [autoRefresh, page, filterDevice, filterGeneric, searchQuery])

  const handleManualRefresh = () => {
    fetchTraps()
    toast.success('Log SNMP Traps berhasil disegarkan.')
  }

  const handleClearTraps = async () => {
    if (isViewer) return
    setClearing(true)
    try {
      const res = await snmpTrapsApi.clear()
      if (res.data.success) {
        toast.success(res.data.message || 'Semua log traps berhasil dibersihkan.')
        setTraps([])
        setTotal(0)
        setTotalPages(1)
        setShowClearConfirm(false)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal membersihkan log.')
    } finally {
      setClearing(false)
    }
  }

  const getTrapStyle = (type) => {
    return TRAP_TYPES[type] || { label: `generic-${type}`, color: 'var(--text-primary)', bg: 'transparent' }
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return '—'
    return new Date(timeStr).toLocaleString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  }

  const formatUptime = (ticks) => {
    if (ticks === null || ticks === undefined) return '—'
    // uptime in ticks (hundredths of a second)
    const total_seconds = ticks / 100
    const days = Math.floor(total_seconds / 86400)
    const hours = Math.floor((total_seconds % 86400) / 3600)
    const minutes = Math.floor((total_seconds % 3600) / 60)
    const secs = Math.floor(total_seconds % 60)
    
    let parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (parts.length === 0 || secs > 0) parts.push(`${secs}s`)
    return parts.join(' ')
  }

  return (
    <div className="page-container animate-fade">
      <style>{`
        .traps-meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }

        .traps-meta-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 15px 0 rgba(0,0,0,0.06);
          transition: border-color 0.2s;
        }

        .traps-meta-card:hover {
          border-color: var(--border-light);
        }

        .traps-meta-val {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .traps-meta-label {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .varbind-table {
          width: 100%;
          border-collapse: collapse;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 12px;
        }

        .varbind-table th, .varbind-table td {
          padding: 8px 12px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .varbind-table th {
          background: var(--bg-card-2);
          color: var(--text-secondary);
        }

        select option {
          background-color: var(--bg-card-2) !important;
          color: var(--text-primary) !important;
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <Radio size={22} style={{ color: 'var(--primary)' }} />
            SNMP Traps Log
          </div>
          <div className="page-subtitle">
            Penerimaan log trap SNMP real-time (UDP 162/1620) dengan deteksi kegagalan link otomatis.
          </div>
        </div>
        <div className="flex-center gap-12">
          {/* Auto Refresh Toggle */}
          <button 
            type="button"
            className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Matikan Auto-Refresh' : 'Aktifkan Auto-Refresh (5 detik)'}
            style={{ padding: '6px 12px', fontSize: '12.5px' }}
          >
            {autoRefresh ? 'Auto Refresh: ON' : 'Auto Refresh: OFF'}
          </button>

          <button className="btn btn-ghost btn-sm" onClick={handleManualRefresh} disabled={loading} style={{ border: '1px solid var(--border)' }}>
            <RefreshCw size={13} style={{ marginRight: '6px', animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
          </button>

          {!isViewer && traps.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setShowClearConfirm(true)}>
              <Trash2 size={13} style={{ marginRight: '6px' }} /> Bersihkan Log
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="traps-meta-grid">
        <div className="traps-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)' }} />
          <div>
            <div className="traps-meta-val">{total}</div>
            <div className="traps-meta-label">Total Traps Tersimpan</div>
          </div>
        </div>
        <div className="traps-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }} />
          <div>
            <div className="traps-meta-val">UDP 162</div>
            <div className="traps-meta-label">Standard Port Listener</div>
          </div>
        </div>
        <div className="traps-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7' }} />
          <div>
            <div className="traps-meta-val">Reaktif</div>
            <div className="traps-meta-label">Metode Monitoring</div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="card mb-16" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Search Box */}
          <div className="search-box" style={{ maxWidth: '300px', flex: 1 }}>
            <Search className="search-icon" size={14} />
            <input 
              placeholder="Cari IP, komunitas, atau OID..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              style={{ fontSize: '13px' }}
            />
          </div>

          {/* Device Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
            <select 
              className="form-control"
              value={filterDevice}
              onChange={e => setFilterDevice(e.target.value)}
              style={{ height: '38px' }}
            >
              <option value="">Semua Perangkat</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
              ))}
              <option value="unregistered">Perangkat Tak Terdaftar</option>
            </select>
          </div>

          {/* Generic Trap Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
            <select 
              className="form-control"
              value={filterGeneric}
              onChange={e => setFilterGeneric(e.target.value)}
              style={{ height: '38px' }}
            >
              <option value="">Semua Tipe Trap</option>
              {Object.entries(TRAP_TYPES).map(([val, info]) => (
                <option key={val} value={val}>{val} - {info.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Trap Table */}
      <div className="card">
        {loading && traps.length === 0 ? (
          <div className="loading-overlay" style={{ minHeight: '300px' }}>
            <div className="loading-spinner" />
            Memuat data SNMP Traps...
          </div>
        ) : traps.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '300px' }}>
            <Radio size={36} className="text-muted" style={{ marginBottom: '12px' }} />
            <div className="empty-title">Tidak ada SNMP Trap diterima</div>
            <div className="empty-desc">
              Pastikan perangkat switch/router Anda telah dikonfigurasi untuk mengirim Trap ke IP server NetX (port UDP 162/1620).
            </div>
          </div>
        ) : (
          <>
            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: '1000px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ width: '160px' }}>Waktu Terima</th>
                    <th style={{ width: '180px' }}>Perangkat Pengirim</th>
                    <th style={{ width: '150px' }}>IP / Versi</th>
                    <th style={{ width: '180px' }}>Tipe Trap</th>
                    <th style={{ width: '160px' }}>Uptime</th>
                    <th>Enterprise OID</th>
                    <th style={{ width: '100px', textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {traps.map(t => {
                    const style = getTrapStyle(t.generic_trap)
                    
                    return (
                      <tr 
                        key={t.id} 
                        style={{ 
                          borderBottom: '1px solid var(--border)'
                        }}
                      >
                        <td className="mono" style={{ fontSize: '11px', padding: '10px 12px' }}>
                          {formatTime(t.received_at)}
                        </td>
                        <td style={{ fontWeight: 600, padding: '10px 12px' }}>
                          {t.device_name || 'Perangkat Tak Terdaftar'}
                        </td>
                        <td className="mono" style={{ fontSize: '11.5px', padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          <div>{t.source_ip}</div>
                          <div style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>SNMP {t.version} ({t.community || 'public'})</div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span 
                            className="badge" 
                            style={{ 
                              background: style.bg, 
                              color: style.color, 
                              borderColor: 'transparent',
                              fontSize: '11px',
                              fontWeight: 700
                            }}
                          >
                            {style.label}
                          </span>
                        </td>
                        <td className="mono" style={{ fontSize: '11.5px', padding: '10px 12px', color: 'var(--text-secondary)' }}>
                          {formatUptime(t.uptime)}
                        </td>
                        <td className="mono" style={{ fontSize: '11px', padding: '10px 12px', color: 'var(--text-muted)' }}>
                          {t.enterprise_oid || '—'}
                          {t.specific_trap !== null && <span style={{ color: 'var(--primary)' }}> (Specific: {t.specific_trap})</span>}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSelectedPayload(t)}
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                          >
                            Payload
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <div className="text-muted" style={{ fontSize: '12.5px' }}>
                Menampilkan {traps.length === 0 ? 0 : (page - 1) * limit + 1} - {Math.min(page * limit, total)} dari {total} traps
              </div>
              <div className="flex-center gap-12">
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page === 1 || loading}
                >
                  <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                </button>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Halaman {page} dari {totalPages}
                </span>
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                  disabled={page === totalPages || loading}
                >
                  Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Payload Modal */}
      {selectedPayload && (
        <div className="modal-overlay" onClick={() => setSelectedPayload(null)}>
          <div className="modal animate-slide" style={{ maxWidth: '680px', width: '100%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Info size={18} style={{ color: 'var(--primary)' }} />
                Variable Bindings Payload ({selectedPayload.source_ip})
              </div>
              <button className="btn-close" onClick={() => setSelectedPayload(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '20px', maxHeight: '450px', overflowY: 'auto' }}>
              <div style={{ marginBottom: '16px', background: 'var(--bg-card-2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12.5px' }}>
                  <div><strong>Tipe Trap:</strong> {getTrapStyle(selectedPayload.generic_trap).label}</div>
                  <div><strong>Waktu Terima:</strong> {formatTime(selectedPayload.received_at)}</div>
                  <div><strong>Uptime Perangkat:</strong> {formatUptime(selectedPayload.uptime)}</div>
                  <div><strong>Versi SNMP:</strong> SNMP {selectedPayload.version}</div>
                </div>
              </div>

              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Varbinds Data:</div>
              {selectedPayload.varbinds && typeof selectedPayload.varbinds === 'object' && Object.keys(selectedPayload.varbinds).length > 0 ? (
                <div className="table-wrapper">
                  <table className="varbind-table">
                    <thead>
                      <tr>
                        <th>OID</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selectedPayload.varbinds).map(([oid, val]) => (
                        <tr key={oid}>
                          <td style={{ color: 'var(--primary-bright)', wordBreak: 'break-all' }}>{oid}</td>
                          <td style={{ color: 'var(--success)', wordBreak: 'break-all' }}>{String(val)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  Tidak ada data variable bindings.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setSelectedPayload(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Traps Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !clearing && setShowClearConfirm(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '440px' }}>
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239,68,68,0.2)' }}>
              <div className="modal-title" style={{ color: 'var(--danger)' }}>
                <Ban size={18} /> Bersihkan Riwayat SNMP Traps
              </div>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: '1.6' }}>
                Apakah Anda benar-benar yakin ingin menghapus <strong>seluruh catatan SNMP Trap</strong> dari database? <br />
                Tindakan ini bersifat permanen dan tidak dapat dibatalkan.
              </p>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setShowClearConfirm(false)} 
                disabled={clearing}
              >
                Batal
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleClearTraps}
                disabled={clearing}
              >
                {clearing ? 'Membersihkan...' : 'Ya, Hapus Semua Traps'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
