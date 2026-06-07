import { useState, useEffect } from 'react'
import { 
  AlertTriangle, CheckCircle, RefreshCw, Search, Clock, 
  AlertOctagon, Activity, FileText, ChevronLeft, ChevronRight, Info
} from 'lucide-react'
import { anomaliesApi, devicesApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function NetworkAnomalies() {
  const [activeAnomalies, setActiveAnomalies] = useState([])
  const [historyAnomalies, setHistoryAnomalies] = useState([])
  const [devices, setDevices] = useState([])
  
  // Loading states
  const [loadingActive, setLoadingActive] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolvingAll, setResolvingAll] = useState(false)

  // Filters & Pagination for History
  const [page, setPage] = useState(1)
  const [limit] = useState(15)
  const [totalPages, setTotalPages] = useState(1)
  const [totalHistory, setTotalHistory] = useState(0)
  
  const [filterType, setFilterType] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterDevice, setFilterDevice] = useState('')

  const [activeTab, setActiveTab] = useState('active') // 'active' or 'history'

  const { user } = useAuth()
  const toast = useToast()
  const isViewer = user?.role === 'viewer'

  const ANOMALY_TYPE_LABELS = {
    'broadcast_storm': 'Broadcast Storm',
    'multicast_storm': 'Multicast Storm',
    'unicast_storm': 'Unicast Storm',
    'port_flapping': 'Port Flapping',
    'mac_flapping': 'MAC Flapping',
    'stp_tcn': 'STP Topology Change'
  }

  const fetchDevices = async () => {
    try {
      const res = await devicesApi.list()
      setDevices(res.data)
    } catch (err) {
      console.error('Failed to load devices list for filter.', err)
    }
  }

  const fetchActiveAnomalies = async () => {
    setLoadingActive(true)
    try {
      const res = await anomaliesApi.getActive()
      setActiveAnomalies(res.data)
    } catch (err) {
      toast.error('Gagal mengambil daftar anomali aktif.')
    } finally {
      setLoadingActive(false)
    }
  }

  const fetchHistoryAnomalies = async () => {
    setLoadingHistory(true)
    try {
      const params = {
        page,
        limit,
        anomaly_type: filterType || undefined,
        severity: filterSeverity || undefined,
        device_id: filterDevice || undefined
      }
      const res = await anomaliesApi.getHistory(params)
      setHistoryAnomalies(res.data.results)
      setTotalPages(res.data.pages)
      setTotalHistory(res.data.total)
    } catch (err) {
      toast.error('Gagal mengambil riwayat log anomali.')
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    fetchDevices()
    fetchActiveAnomalies()
  }, [])

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryAnomalies()
    }
  }, [page, filterType, filterSeverity, filterDevice, activeTab])

  // Reset page on filter changes
  useEffect(() => {
    setPage(1)
  }, [filterType, filterSeverity, filterDevice])

  const handleRefresh = () => {
    if (activeTab === 'active') {
      fetchActiveAnomalies()
    } else {
      fetchHistoryAnomalies()
    }
    toast.success('Data anomali berhasil diperbarui.')
  }

  const handleResolve = async (id) => {
    if (isViewer) return
    setResolvingId(id)
    try {
      const res = await anomaliesApi.resolve(id)
      if (res.data.success) {
        toast.success(res.data.message || 'Anomali berhasil diselesaikan.')
        fetchActiveAnomalies()
        if (activeTab === 'history') fetchHistoryAnomalies()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyelesaikan anomali.')
    } finally {
      setResolvingId(null)
    }
  }

  const handleResolveAll = async () => {
    if (isViewer) return
    if (!confirm('Apakah Anda yakin ingin menyelesaikan semua anomali aktif secara massal?')) return
    setResolvingAll(true)
    try {
      const res = await anomaliesApi.resolveAll()
      if (res.data.success) {
        toast.success(res.data.message || 'Semua anomali berhasil diselesaikan.')
        fetchActiveAnomalies()
        if (activeTab === 'history') fetchHistoryAnomalies()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyelesaikan semua anomali.')
    } finally {
      setResolvingAll(false)
    }
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

  const getAnomalyBadgeClass = (type) => {
    switch (type) {
      case 'broadcast_storm':
      case 'multicast_storm':
      case 'unicast_storm':
        return 'badge-offline' // Reddish
      case 'port_flapping':
      case 'mac_flapping':
        return 'badge-ssh' // Orangeish
      case 'stp_tcn':
        return 'badge-online' // Blue/Greenish (Vlan/Stp)
      default:
        return 'badge-neutral'
    }
  }

  const getSeverityBadgeClass = (sev) => {
    return sev === 'critical' ? 'badge-offline' : 'badge-ssh'
  }

  // Count active stats
  const criticalCount = activeAnomalies.filter(a => a.severity === 'critical').length
  const warningCount = activeAnomalies.filter(a => a.severity === 'warning').length

  return (
    <div className="page-container animate-fade">
      {/* Styles for glassmorphic card widgets and alerts */}
      <style>{`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        
        .stat-card-glass {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 4px 20px 0 rgba(0, 0, 0, 0.15);
          position: relative;
          overflow: hidden;
          transition: all 0.2s;
        }
        
        .stat-card-glass:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px 0 rgba(0, 0, 0, 0.25);
          border-color: var(--primary);
        }
        
        .stat-icon-wrapper {
          width: 48px;
          height: 48px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }
        
        .stat-val {
          font-size: 26px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
        }
        
        .stat-label {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .pulse-red {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          animation: pulse-red-anim 1.8s infinite;
        }
        
        .pulse-orange {
          box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7);
          animation: pulse-orange-anim 1.8s infinite;
        }

        @keyframes pulse-red-anim {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
        
        @keyframes pulse-orange-anim {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 8px rgba(249, 115, 22, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
          }
        }

        .anomaly-card-item {
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          transition: all 0.2s;
        }
        
        .anomaly-card-item:hover {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .anomaly-card-item.critical {
          border-left: 4px solid var(--danger);
        }
        
        .anomaly-card-item.warning {
          border-left: 4px solid #f97316;
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <AlertTriangle size={22} style={{ color: activeAnomalies.length > 0 ? 'var(--danger)' : 'var(--primary)' }} />
            Deteksi Anomali Jaringan
          </div>
          <div className="page-subtitle">
            Pemantauan real-time untuk mendeteksi broadcast storms, port flapping, L2 topology changes, dan MAC flapping.
          </div>
        </div>
        <div className="flex-center gap-12">
          <button className="btn btn-ghost btn-sm animate-fade" onClick={handleRefresh} disabled={loadingActive || loadingHistory}>
            <RefreshCw size={13} style={{ marginRight: '6px', animation: (loadingActive || loadingHistory) ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
          </button>
          {!isViewer && activeAnomalies.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={handleResolveAll} disabled={resolvingAll}>
              {resolvingAll ? 'Menyelesaikan...' : 'Selesaikan Semua'}
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="stats-grid">
        <div className="stat-card-glass">
          <div className="stat-icon-wrapper" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
            <Activity size={22} />
          </div>
          <div>
            <div className="stat-val">{activeAnomalies.length}</div>
            <div className="stat-label">Total Anomali Aktif</div>
          </div>
        </div>

        <div className="stat-card-glass">
          <div className={`stat-icon-wrapper ${criticalCount > 0 ? 'pulse-red' : ''}`} style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}>
            <AlertOctagon size={22} />
          </div>
          <div>
            <div className="stat-val" style={{ color: 'var(--danger)' }}>{criticalCount}</div>
            <div className="stat-label">Kritis (Critical)</div>
          </div>
        </div>

        <div className="stat-card-glass">
          <div className={`stat-icon-wrapper ${warningCount > 0 ? 'pulse-orange' : ''}`} style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <div className="stat-val" style={{ color: '#f97316' }}>{warningCount}</div>
            <div className="stat-label">Peringatan (Warning)</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-container" style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('active')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'active' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'active' ? 'var(--primary-bright)' : 'var(--text-muted)',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
        >
          Anomali Aktif ({activeAnomalies.length})
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'history' ? '3px solid var(--primary)' : '3px solid transparent',
            color: activeTab === 'history' ? 'var(--primary-bright)' : 'var(--text-muted)',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
        >
          Riwayat Log Anomali
        </button>
      </div>

      {/* Active Tab View */}
      {activeTab === 'active' && (
        <div className="card">
          {loadingActive ? (
            <div className="loading-overlay" style={{ minHeight: '200px' }}>
              <div className="loading-spinner" />
              Memindai anomali aktif...
            </div>
          ) : activeAnomalies.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '200px' }}>
              <CheckCircle size={36} className="text-success" style={{ marginBottom: '12px' }} />
              <div className="empty-title">Jaringan Stabil</div>
              <div className="empty-desc">Tidak ada anomali atau ancaman yang terdeteksi saat ini.</div>
            </div>
          ) : (
            <div>
              {activeAnomalies.map(a => (
                <div key={a.id} className={`anomaly-card-item ${a.severity}`}>
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <div style={{ marginTop: '3px' }}>
                      <AlertTriangle size={18} style={{ color: a.severity === 'critical' ? 'var(--danger)' : '#f97316' }} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                          {ANOMALY_TYPE_LABELS[a.anomaly_type] || a.anomaly_type}
                        </span>
                        <span className={`badge ${getSeverityBadgeClass(a.severity)}`} style={{ textTransform: 'uppercase', fontSize: '9px', fontWeight: 800 }}>
                          {a.severity}
                        </span>
                        <span className="badge badge-neutral" style={{ fontSize: '10.5px' }}>
                          {a.device_name} ({a.device_ip})
                        </span>
                        {a.interface_name && a.interface_name !== 'Global' && (
                          <span className="badge badge-ssh" style={{ fontSize: '10.5px', background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                            Port: {a.interface_name}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: '1.4' }}>
                        {a.details}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}>
                        <Clock size={11} /> Terdeteksi pada: {formatTime(a.detected_at)}
                      </div>
                    </div>
                  </div>
                  
                  {!isViewer && (
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => handleResolve(a.id)}
                      disabled={resolvingId === a.id}
                      style={{ height: '32px', borderColor: 'var(--border)' }}
                    >
                      {resolvingId === a.id ? (
                        <span className="loading-spinner" style={{ width: 12, height: 12 }} />
                      ) : (
                        'Selesaikan'
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History Tab View */}
      {activeTab === 'history' && (
        <>
          {/* Filters Area */}
          <div className="card mb-16" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' }}>
                <label className="form-label" style={{ fontSize: '11px' }}>Jenis Anomali</label>
                <select 
                  className="select-input"
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  style={{ background: 'var(--bg-input)' }}
                >
                  <option value="">Semua Jenis</option>
                  {Object.entries(ANOMALY_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '120px' }}>
                <label className="form-label" style={{ fontSize: '11px' }}>Tingkat Keparahan</label>
                <select 
                  className="select-input"
                  value={filterSeverity}
                  onChange={e => setFilterSeverity(e.target.value)}
                  style={{ background: 'var(--bg-input)' }}
                >
                  <option value="">Semua Level</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                <label className="form-label" style={{ fontSize: '11px' }}>Perangkat</label>
                <select 
                  className="select-input"
                  value={filterDevice}
                  onChange={e => setFilterDevice(e.target.value)}
                  style={{ background: 'var(--bg-input)' }}
                >
                  <option value="">Semua Perangkat</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* History List */}
          <div className="card">
            {loadingHistory ? (
              <div className="loading-overlay" style={{ minHeight: '200px' }}>
                <div className="loading-spinner" />
                Memuat riwayat log...
              </div>
            ) : historyAnomalies.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '200px' }}>
                <FileText size={32} className="text-muted" style={{ marginBottom: '12px' }} />
                <div className="empty-title">Tidak ada log ditemukan</div>
                <div className="empty-desc">Tidak ada catatan anomali yang sesuai dengan kriteria filter Anda.</div>
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu Terdeteksi</th>
                        <th>Device</th>
                        <th>Jenis Anomali</th>
                        <th>Severity</th>
                        <th>Port / Interface</th>
                        <th>Detail Rincian</th>
                        <th>Waktu Selesai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyAnomalies.map(h => (
                        <tr key={h.id}>
                          <td className="mono" style={{ fontSize: '11.5px' }}>{formatTime(h.detected_at)}</td>
                          <td style={{ fontWeight: 600 }}>{h.device_name}</td>
                          <td>
                            <span className={`badge ${getAnomalyBadgeClass(h.anomaly_type)}`} style={{ fontSize: '10.5px' }}>
                              {ANOMALY_TYPE_LABELS[h.anomaly_type] || h.anomaly_type}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${getSeverityBadgeClass(h.severity)}`} style={{ fontSize: '9.5px', textTransform: 'uppercase' }}>
                              {h.severity}
                            </span>
                          </td>
                          <td className="mono" style={{ fontWeight: 'bold' }}>{h.interface_name || '—'}</td>
                          <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{h.details}</td>
                          <td className="mono" style={{ fontSize: '11.5px', color: h.is_active ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {h.is_active ? (
                              <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span className="status-dot pulse-red" style={{ background: 'var(--danger)', width: 6, height: 6 }} /> Aktif
                              </span>
                            ) : (
                              formatTime(h.resolved_at)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <div className="text-muted" style={{ fontSize: '12.5px' }}>
                    Menampilkan {historyAnomalies.length === 0 ? 0 : (page - 1) * limit + 1} - {Math.min(page * limit, totalHistory)} dari {totalHistory} catatan
                  </div>
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.max(p - 1, 1))}
                      disabled={page === 1 || loadingHistory}
                    >
                      <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {page} dari {totalPages}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                      disabled={page === totalPages || loadingHistory}
                    >
                      Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
