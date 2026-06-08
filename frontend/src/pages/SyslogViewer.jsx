import { useState, useEffect, useRef } from 'react'
import { 
  FileText, RefreshCw, Search, Trash2, Clock, 
  AlertTriangle, Info, ShieldAlert, Play, Square, 
  ChevronLeft, ChevronRight, Ban
} from 'lucide-react'
import { syslogApi, devicesApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function SyslogViewer() {
  const [logs, setLogs] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState('logs')
  const [senders, setSenders] = useState([])
  const [sendersLoading, setSendersLoading] = useState(false)

  // Filters & Pagination
  const [page, setPage] = useState(1)
  const [limit] = useState(50)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [filterDevice, setFilterDevice] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Auto-refresh logic
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefreshTimerRef = useRef(null)

  const { user } = useAuth()
  const toast = useToast()
  const isViewer = user?.role === 'viewer'

  const SEVERITY_LEVELS = [
    { value: 0, label: '0 - Emergency', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.15)' },
    { value: 1, label: '1 - Alert', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.15)' },
    { value: 2, label: '2 - Critical', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.15)' },
    { value: 3, label: '3 - Error', color: 'var(--danger)', bg: 'rgba(239, 68, 68, 0.12)' },
    { value: 4, label: '4 - Warning', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)' },
    { value: 5, label: '5 - Notice', color: '#eab308', bg: 'rgba(234, 179, 8, 0.08)' },
    { value: 6, label: '6 - Informational', color: 'var(--primary)', bg: 'rgba(59, 130, 246, 0.05)' },
    { value: 7, label: '7 - Debug', color: 'var(--text-muted)', bg: 'rgba(255, 255, 255, 0.02)' }
  ]

  const FACILITY_NAMES = {
    0: 'kern', 1: 'user', 2: 'mail', 3: 'daemon', 4: 'auth', 5: 'syslog',
    6: 'lpr', 7: 'news', 8: 'uucp', 9: 'cron', 10: 'authpriv', 11: 'ftp',
    12: 'ntp', 13: 'audit', 14: 'console', 15: 'cron2', 16: 'local0',
    17: 'local1', 18: 'local2', 19: 'local3', 20: 'local4', 21: 'local5',
    22: 'local6', 23: 'local7'
  }

  const fetchDevices = async () => {
    try {
      const res = await devicesApi.list()
      setDevices(res.data)
    } catch (_) {}
  }

  const fetchLogs = async (showSilently = false) => {
    if (!showSilently) setLoading(true)
    try {
      const params = {
        page,
        limit,
        device_id: filterDevice || undefined,
        severity: filterSeverity !== '' ? parseInt(filterSeverity) : undefined,
        search: searchQuery || undefined
      }
      const res = await syslogApi.list(params)
      setLogs(res.data.results)
      setTotal(res.data.total)
      setTotalPages(res.data.pages)
    } catch (err) {
      toast.error('Gagal mengambil log syslog.')
    } finally {
      if (!showSilently) setLoading(false)
    }
  }

  const fetchSenders = async (showSilently = false) => {
    if (!showSilently) setSendersLoading(true)
    try {
      const res = await syslogApi.getSenders()
      setSenders(res.data)
    } catch (_) {
      toast.error('Gagal mengambil daftar perangkat terhubung.')
    } finally {
      if (!showSilently) setSendersLoading(false)
    }
  }

  useEffect(() => {
    fetchDevices()
    fetchSenders(true)
  }, [])

  // Refetch when page or filters change
  useEffect(() => {
    fetchLogs()
  }, [page, filterDevice, filterSeverity, searchQuery])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filterDevice, filterSeverity, searchQuery])

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        if (activeTab === 'logs') {
          fetchLogs(true)
        } else if (activeTab === 'senders') {
          fetchSenders(true)
        }
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
  }, [autoRefresh, activeTab, page, filterDevice, filterSeverity, searchQuery])

  const handleManualRefresh = () => {
    if (activeTab === 'logs') {
      fetchLogs()
      toast.success('Log syslog berhasil disegarkan.')
    } else {
      fetchSenders()
      toast.success('Daftar perangkat pengirim berhasil disegarkan.')
    }
  }

  const handleViewSenderLogs = (sender) => {
    if (sender.device_id) {
      setFilterDevice(sender.device_id.toString())
      setSearchQuery('')
    } else {
      setFilterDevice('unregistered')
      setSearchQuery(sender.raw_sender_ip || sender.device_ip)
    }
    setActiveTab('logs')
  }

  const handleClearLogs = async () => {
    if (isViewer) return
    setClearing(true)
    try {
      const res = await syslogApi.clear()
      if (res.data.success) {
        toast.success(res.data.message || 'Semua log berhasil dibersihkan.')
        setLogs([])
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

  const getSeverityStyle = (sev) => {
    const found = SEVERITY_LEVELS.find(l => l.value === sev)
    return found || { color: 'var(--text-primary)', bg: 'transparent' }
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

  return (
    <div className="page-container animate-fade">
      {/* Styles for syslog view */}
      <style>{`
        .syslog-meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }

        .syslog-meta-card {
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

        .syslog-meta-card:hover {
          border-color: var(--border-light);
        }

        .syslog-meta-val {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .syslog-meta-label {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .log-row-mono {
          font-family: 'Consolas', 'Courier New', Courier, monospace;
          font-size: 12px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .severity-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }

        /* Theme-compliant styling for select option tags on dark mode */
        select option {
          background-color: var(--bg-card-2) !important;
          color: var(--text-primary) !important;
        }

        /* Glowing outline styles for buttons */
        .btn-outline-primary {
          background: rgba(79, 142, 247, 0.08);
          color: var(--primary);
          border: 1px solid rgba(79, 142, 247, 0.3) !important;
          transition: all 0.2s;
        }
        .btn-outline-primary:hover {
          background: rgba(79, 142, 247, 0.2);
          border-color: var(--primary) !important;
          color: var(--text-primary);
          box-shadow: 0 0 10px rgba(79, 142, 247, 0.25);
        }

        .btn-outline-danger {
          background: rgba(239, 68, 68, 0.08);
          color: var(--danger);
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
          transition: all 0.2s;
        }
        .btn-outline-danger:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: var(--danger) !important;
          color: var(--text-primary);
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.25);
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <FileText size={22} style={{ color: 'var(--primary)' }} />
            Syslog Viewer
          </div>
          <div className="page-subtitle">
            Penerimaan log jaringan terpusat (UDP 514) dengan kebijakan retensi pembersihan otomatis 30 hari.
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
            {autoRefresh ? (
              <>
                <Play size={13} style={{ marginRight: '6px', fill: 'currentColor' }} /> Auto Refresh: ON
              </>
            ) : (
              <>
                <Square size={12} style={{ marginRight: '6px', fill: 'currentColor' }} /> Auto Refresh: OFF
              </>
            )}
          </button>

          <button className="btn btn-outline-primary btn-sm" onClick={handleManualRefresh} disabled={loading}>
            <RefreshCw size={13} style={{ marginRight: '6px', animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
          </button>

          {!isViewer && logs.length > 0 && (
            <button className="btn btn-outline-danger btn-sm" onClick={() => setShowClearConfirm(true)}>
              <Trash2 size={13} style={{ marginRight: '6px' }} /> Bersihkan Log
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="syslog-meta-grid">
        <div className="syslog-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger)' }} />
          <div>
            <div className="syslog-meta-val">{total}</div>
            <div className="syslog-meta-label">Total Log Tersimpan</div>
          </div>
        </div>
        <div className="syslog-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f97316' }} />
          <div>
            <div className="syslog-meta-val">30 Hari</div>
            <div className="syslog-meta-label">Kebijakan Retensi</div>
          </div>
        </div>
        <div className="syslog-meta-card">
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }} />
          <div>
            <div className="syslog-meta-val">UDP 514</div>
            <div className="syslog-meta-label">Port Listener</div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex-center mb-16" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '0px', justifyContent: 'flex-start' }}>
        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ 
            borderBottomLeftRadius: 0, 
            borderBottomRightRadius: 0, 
            borderBottom: activeTab === 'logs' ? '2px solid var(--primary)' : 'none', 
            fontWeight: 600,
            padding: '10px 16px',
            fontSize: '13.5px'
          }}
        >
          📄 Log Stream
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('senders')
            fetchSenders()
          }}
          className={`btn ${activeTab === 'senders' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ 
            borderBottomLeftRadius: 0, 
            borderBottomRightRadius: 0, 
            borderBottom: activeTab === 'senders' ? '2px solid var(--primary)' : 'none', 
            fontWeight: 600,
            padding: '10px 16px',
            fontSize: '13.5px'
          }}
        >
          🔌 Perangkat Terhubung ({senders.length})
        </button>
      </div>

      {activeTab === 'logs' ? (
        <>
          {/* Filters Bar */}
          <div className="card mb-16" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              
              {/* Search Box */}
              <div className="search-box" style={{ maxWidth: '300px', flex: 1 }}>
                <Search className="search-icon" size={14} />
                <input 
                  placeholder="Cari pesan log, program, atau IP..." 
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

              {/* Severity Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                <select 
                  className="form-control"
                  value={filterSeverity}
                  onChange={e => setFilterSeverity(e.target.value)}
                  style={{ height: '38px' }}
                >
                  <option value="">Semua Tingkat Keparahan</option>
                  {SEVERITY_LEVELS.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Log list */}
          <div className="card">
            {loading && logs.length === 0 ? (
              <div className="loading-overlay" style={{ minHeight: '300px' }}>
                <div className="loading-spinner" />
                Memuat pesan syslog...
              </div>
            ) : logs.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '300px' }}>
                <FileText size={36} className="text-muted" style={{ marginBottom: '12px' }} />
                <div className="empty-title">Tidak ada syslog diterima</div>
                <div className="empty-desc">
                  Pastikan perangkat switch/router Anda telah dikonfigurasi untuk mengirim syslog ke IP server NetX (port UDP 514).
                </div>
              </div>
            ) : (
              <>
                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: '1000px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '160px' }}>Waktu Server</th>
                        <th style={{ width: '150px' }}>Perangkat Pengirim</th>
                        <th style={{ width: '130px' }}>Severity</th>
                        <th style={{ width: '100px' }}>Program</th>
                        <th>Pesan Log</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(l => {
                        const style = getSeverityStyle(l.severity)
                        
                        return (
                           <tr 
                            key={l.id} 
                            style={{ 
                              background: style.bg,
                              transition: 'all 0.1s'
                            }}
                          >
                            <td className="mono" style={{ fontSize: '11px', verticalAlign: 'top', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                              {formatTime(l.timestamp)}
                            </td>
                            <td style={{ fontWeight: 600, verticalAlign: 'top', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span>{l.device_name || 'Tidak Terdaftar'}</span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal' }}>{l.device_ip}</span>
                              </div>
                            </td>
                            <td style={{ verticalAlign: 'top', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                              <span 
                                className="badge" 
                                style={{ 
                                  background: 'rgba(255,255,255,0.03)', 
                                  color: style.color, 
                                  borderColor: 'rgba(255,255,255,0.08)',
                                  fontSize: '10.5px',
                                  fontWeight: 700
                                }}
                              >
                                <span className="severity-indicator" style={{ background: style.color }} />
                                {SEVERITY_LEVELS[l.severity]?.label.split(' - ')[1] || `Level ${l.severity}`}
                              </span>
                            </td>
                            <td className="mono" style={{ verticalAlign: 'top', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--primary-bright)' }}>
                              {l.program || 'syslog'}
                            </td>
                            <td className="log-row-mono" style={{ verticalAlign: 'top', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                              {l.message}
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
                    Menampilkan {logs.length === 0 ? 0 : (page - 1) * limit + 1} - {Math.min(page * limit, total)} dari {total} log
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
        </>
      ) : (
        /* Senders List Tab */
        <div className="card">
          {sendersLoading && senders.length === 0 ? (
            <div className="loading-overlay" style={{ minHeight: '300px' }}>
              <div className="loading-spinner" />
              Memuat daftar perangkat terhubung...
            </div>
          ) : senders.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '300px' }}>
              <FileText size={36} className="text-muted" style={{ marginBottom: '12px' }} />
              <div className="empty-title">Tidak ada perangkat mengirim log</div>
              <div className="empty-desc">
                Belum ada aktivitas syslog yang terekam dari perangkat mana pun di jaringan Anda.
              </div>
            </div>
          ) : (
            <div className="table-wrapper" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ width: '150px' }}>Status</th>
                    <th>Nama Perangkat</th>
                    <th>IP Pengirim</th>
                    <th>Jumlah Log</th>
                    <th>Aktivitas Terakhir</th>
                    <th style={{ width: '150px', textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {senders.map((s, idx) => {
                    const isRegistered = s.device_id !== null;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px' }}>
                          <span 
                            className={`badge badge-${isRegistered ? 'success' : 'warning'}`}
                            style={{ 
                              padding: '2px 8px', 
                              fontSize: '11px', 
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <span 
                              className="status-dot" 
                              style={{ 
                                background: isRegistered ? 'var(--success)' : 'var(--warning)',
                                width: '6px', height: '6px'
                              }} 
                            />
                            {isRegistered ? 'Terdaftar' : 'Tidak Terdaftar'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, padding: '12px', color: 'var(--text-primary)' }}>
                          {s.device_name}
                        </td>
                        <td className="mono" style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                          {s.device_ip}
                        </td>
                        <td style={{ fontWeight: 700, padding: '12px', color: 'var(--primary-bright)' }}>
                          {s.log_count} log
                        </td>
                        <td style={{ padding: '12px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                          {formatTime(s.last_seen)}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleViewSenderLogs(s)}
                            style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                          >
                            <Search size={12} /> Lihat Log
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Clear Logs Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !clearing && setShowClearConfirm(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '440px' }}>
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239,68,68,0.2)' }}>
              <div className="modal-title" style={{ color: 'var(--danger)' }}>
                <Ban size={18} /> Bersihkan Riwayat Syslog
              </div>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', lineHeight: '1.6' }}>
                Apakah Anda benar-benar yakin ingin menghapus <strong>seluruh catatan log syslog</strong> dari database? <br />
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
                onClick={handleClearLogs}
                disabled={clearing}
              >
                {clearing ? (
                  <>
                    <span className="loading-spinner" style={{ width: 13, height: 13, borderTopColor: '#fff', marginRight: 4 }} />
                    Membersihkan...
                  </>
                ) : (
                  'Ya, Hapus Semua Log'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
