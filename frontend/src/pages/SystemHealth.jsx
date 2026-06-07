import { useState, useEffect, useRef } from 'react'
import { Database, HardDrive, RefreshCw, AlertTriangle, CheckCircle2, Cpu, Activity, Clock, ServerCrash } from 'lucide-react'
import axios from 'axios'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

export default function SystemHealth() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timerRef = useRef(null)
  
  const { user } = useAuth()
  const toast = useToast()

  const fetchHealth = async () => {
    try {
      const res = await axios.get('/api/health/diagnostics')
      setData(res.data)
    } catch (err) {
      toast.error('Gagal memuat status kesehatan sistem.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(fetchHealth, 5000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [autoRefresh])

  if (user?.role !== 'admin') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <AlertTriangle size={48} className="text-danger" style={{ marginBottom: '16px' }} />
          <div className="empty-title">Akses Ditolak</div>
          <div className="empty-desc">Hanya Administrator yang dapat melihat halaman diagnosa kesehatan sistem.</div>
        </div>
      </div>
    )
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'var(--success)'
      case 'warning':
        return 'var(--warning)'
      case 'degraded':
        return 'var(--danger)'
      default:
        return 'var(--text-muted)'
    }
  }

  const getStatusGlow = (status) => {
    switch (status) {
      case 'healthy':
        return '0 0 20px rgba(34,197,94,0.3)'
      case 'warning':
        return '0 0 20px rgba(245,158,11,0.3)'
      case 'degraded':
        return '0 0 20px rgba(239,68,68,0.3)'
      default:
        return 'none'
    }
  }

  const getStatusLabel = (status) => {
    switch (status) {
      case 'healthy':
        return 'Sehat (Healthy)'
      case 'warning':
        return 'Peringatan (Warning)'
      case 'degraded':
        return 'Terdegradasi (Degraded)'
      default:
        return 'Unknown'
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Activity size={22} style={{ color: 'var(--primary)' }} />
            Self Health Monitoring
          </div>
          <div className="page-subtitle">
            Pantau performa query database, lag event loop, throughput scanner, dan kapasitas penyimpanan secara real-time.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label className="flex-center" style={{ gap: '6px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)} 
              style={{ width: '14px', height: '14px', accentColor: 'var(--primary)' }} 
            />
            Auto-refresh (5s)
          </label>
          <button className="btn btn-ghost" onClick={fetchHealth} disabled={loading}>
            <RefreshCw size={15} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Segarkan
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="card" style={{ minHeight: '300px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '16px' }}>
          <div className="loading-spinner" />
          <span className="text-muted">Mengambil metrik performa sistem...</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Main Status Header Card */}
          <div 
            className="card animate-slide" 
            style={{ 
              padding: '24px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              borderLeft: `5px solid ${getStatusColor(data?.status)}`,
              boxShadow: getStatusGlow(data?.status),
              transition: 'all 0.5s ease-in-out'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ color: getStatusColor(data?.status) }}>
                {data?.status === 'healthy' ? (
                  <CheckCircle2 size={36} style={{ filter: `drop-shadow(0 0 6px ${getStatusColor(data?.status)})` }} />
                ) : (
                  <AlertTriangle size={36} style={{ filter: `drop-shadow(0 0 6px ${getStatusColor(data?.status)})` }} />
                )}
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Status Kesehatan Sistem</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {getStatusLabel(data?.status)}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Pemantauan aktif sejak startup server<br />
              Terakhir diperbarui: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}
            </div>
          </div>

          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            
            {/* Metric 1: DB Query Latency */}
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>DB Query Latency</span>
                <Database size={16} className="text-muted" />
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: data?.metrics.db_query_latency_ms > 100 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {data?.metrics.db_query_latency_ms} <span style={{ fontSize: '14px', fontWeight: 500 }}>ms</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Rata-rata dari {data?.metrics.db_query_count.toLocaleString()} query terproses
                </div>
              </div>
            </div>

            {/* Metric 2: Event Loop Lag */}
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Event Loop Lag</span>
                <Cpu size={16} className="text-muted" />
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: data?.metrics.event_loop_lag_ms > 150 ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {data?.metrics.event_loop_lag_ms} <span style={{ fontSize: '14px', fontWeight: 500 }}>ms</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Delay penjadwalan asinkron internal
                </div>
              </div>
            </div>

            {/* Metric 3: Scanner Throughput */}
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Scan Throughput</span>
                <Activity size={16} className="text-muted" />
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {data?.metrics.analyzer_throughput_scans_per_min} <span style={{ fontSize: '14px', fontWeight: 500 }}>scans/min</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Kecepatan pemindaian anomalinya
                </div>
              </div>
            </div>

            {/* Metric 4: Disk Usage */}
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Disk Space</span>
                <HardDrive size={16} className="text-muted" />
              </div>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: data?.metrics.disk_usage.free_percent < 15 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {data?.metrics.disk_usage.free_percent} <span style={{ fontSize: '14px', fontWeight: 500 }}>% free</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {data?.metrics.disk_usage.free_gb} GB sisa • DB: {data?.metrics.disk_usage.db_size_mb} MB
                </div>
              </div>
            </div>

            {/* Metric 5: Redis Status */}
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="flex-between">
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Redis Queue Status</span>
                <Clock size={16} className="text-muted" />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="status-dot" style={{ background: 'var(--text-muted)' }} />
                  <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-muted)' }}>Inactive</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
                  Sistem berjalan stabil menggunakan antrean non-blocking internal.
                </div>
              </div>
            </div>

          </div>

          {/* Active Alerts Section */}
          <div className="card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ServerCrash size={18} className="text-muted" />
              Log Degradasi Performa & Alert Sistem
            </h3>
            
            {data?.alerts.length === 0 ? (
              <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'rgba(34,197,94,0.06)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)' }}>
                <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
                <span style={{ fontSize: '13.5px', color: 'var(--success)', fontWeight: 500 }}>
                  Semua komponen bekerja dengan optimal. Tidak ada degradasi performa atau kehabisan sumber daya terdeteksi.
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {data?.alerts.map((alert, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      padding: '16px', 
                      borderRadius: '8px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '12px',
                      backgroundColor: alert.severity === 'critical' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
                      border: `1px solid ${alert.severity === 'critical' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`
                    }}
                  >
                    <AlertTriangle size={18} style={{ color: alert.severity === 'critical' ? 'var(--danger)' : 'var(--warning)' }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: alert.severity === 'critical' ? 'var(--danger)' : 'var(--warning)', marginRight: '8px' }}>
                        [{alert.component}]
                      </span>
                      <span style={{ fontSize: '13.5px', color: 'var(--text-primary)', fontWeight: 500 }}>
                        {alert.message}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
