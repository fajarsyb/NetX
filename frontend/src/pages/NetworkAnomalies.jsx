import { useState, useEffect } from 'react'
import { 
  AlertTriangle, CheckCircle, RefreshCw, Search, Clock, 
  AlertOctagon, Activity, FileText, ChevronLeft, ChevronRight, Info, Filter, X
} from 'lucide-react'
import { anomaliesApi, devicesApi, syslogApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'
import { cleanInterfaceName } from '../utils/portUtils'

export default function NetworkAnomalies() {
  const [activeAnomalies, setActiveAnomalies] = useState([])
  const [historyAnomalies, setHistoryAnomalies] = useState([])
  const [devices, setDevices] = useState([])
  
  // Loading states
  const [loadingActive, setLoadingActive] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)
  const [resolvingAll, setResolvingAll] = useState(false)

  // Tab state: 'active', 'history', 'senders', 'rca', 'patterns'
  const [activeTab, setActiveTab] = useState('active')
  const [logSenders, setLogSenders] = useState([])
  const [loadingSenders, setLoadingSenders] = useState(false)

  // RCA & Pattern states
  const [rcaIncidents, setRcaIncidents] = useState([])
  const [loadingRca, setLoadingRca] = useState(false)
  const [syslogPatterns, setSyslogPatterns] = useState([])
  const [loadingPatterns, setLoadingPatterns] = useState(false)
  const [updatingPatternHash, setUpdatingPatternHash] = useState(null)
  const [expandedIncidents, setExpandedIncidents] = useState({})

  // --- Tab 1: Active Anomalies States ---
  const [activePage, setActivePage] = useState(1)
  const [activeLimit, setActiveLimit] = useState(50)
  const [searchActiveQuery, setSearchActiveQuery] = useState('')
  const [filterActiveType, setFilterActiveType] = useState('')
  const [filterActiveSeverity, setFilterActiveSeverity] = useState('')
  const [filterActiveDevice, setFilterActiveDevice] = useState('')

  // --- Tab 2: History Anomalies States ---
  const [page, setPage] = useState(1)
  const [historyLimit, setHistoryLimit] = useState(50)
  const [searchHistoryQuery, setSearchHistoryQuery] = useState('')
  const [debouncedSearchHistory, setDebouncedSearchHistory] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterDevice, setFilterDevice] = useState('')
  const [totalPages, setTotalPages] = useState(1)
  const [totalHistory, setTotalHistory] = useState(0)

  const { user } = useAuth()
  const toast = useToast()
  const isViewer = user?.role === 'viewer'

  const ANOMALY_TYPE_LABELS = {
    'broadcast_storm': 'Broadcast Storm',
    'multicast_storm': 'Multicast Storm',
    'unicast_storm': 'Unicast Storm',
    'port_flapping': 'Port Flapping',
    'mac_flapping': 'MAC Flapping',
    'stp_tcn': 'STP Topology Change',
    'security_auth_fail': 'Security Auth Failure',
    'port_down': 'Port Link Down',
    'syslog_spike': 'Syslog Pattern Spike',
    'syslog_critical': 'Critical Syslog Pattern',
    'device_offline': 'Device Offline',
    'crc_errors': 'CRC Errors (LAN Cable)',
    'framing_errors': 'Framing Errors',
    'transmission_errors': 'Transmission Errors',
    'speed_drop': 'Link Speed Drop'
  }

  // Fetch initial devices list for filters
  const fetchDevices = async () => {
    try {
      const res = await devicesApi.list()
      setDevices(res.data)
    } catch (err) {
      console.error('Failed to load devices list for filter.', err)
    }
  }

  // Fetch active anomalies
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

  // Fetch history anomalies (called on filter/pagination/limit change)
  const fetchHistoryAnomalies = async () => {
    setLoadingHistory(true)
    try {
      const params = {
        page,
        limit: historyLimit,
        anomaly_type: filterType || undefined,
        severity: filterSeverity || undefined,
        device_id: filterDevice || undefined,
        search: debouncedSearchHistory || undefined
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

  // Fetch RCA incidents
  const fetchRcaData = async () => {
    setLoadingRca(true)
    try {
      const res = await anomaliesApi.getRca()
      setRcaIncidents(res.data || [])
    } catch (err) {
      toast.error('Gagal mengambil data korelasi akar masalah (RCA).')
    } finally {
      setLoadingRca(false)
    }
  }

  // Fetch syslog patterns
  const fetchPatterns = async () => {
    setLoadingPatterns(true)
    try {
      const res = await syslogApi.getPatterns()
      setSyslogPatterns(res.data || [])
    } catch (err) {
      toast.error('Gagal mengambil daftar pola syslog.')
    } finally {
      setLoadingPatterns(false)
    }
  }

  const handleTogglePatternStatus = async (hash, field, currentVal) => {
    if (isViewer) return
    setUpdatingPatternHash(hash)
    const newVal = currentVal === 1 ? 0 : 1
    const payload = {
      [field]: newVal
    }
    try {
      const res = await syslogApi.updatePattern(hash, payload)
      if (res.data.success) {
        toast.success(res.data.message || 'Status pola berhasil diperbarui.')
        fetchPatterns()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal memperbarui status pola.')
    } finally {
      setUpdatingPatternHash(null)
    }
  }

  const toggleIncidentExpand = (id) => {
    setExpandedIncidents(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  // Debounce search input for history to avoid hammering API
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchHistory(searchHistoryQuery)
    }, 450)
    return () => clearTimeout(timer)
  }, [searchHistoryQuery])

  useEffect(() => {
    fetchDevices()
    fetchActiveAnomalies()
  }, [])

  const fetchSenders = async () => {
    setLoadingSenders(true)
    try {
      const res = await syslogApi.getSenders()
      setLogSenders(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      console.error('Failed to load active syslog senders:', err)
      toast.error('Gagal mengambil data pengirim log.')
    } finally {
      setLoadingSenders(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'senders') {
      fetchSenders()
    } else if (activeTab === 'rca') {
      fetchRcaData()
    } else if (activeTab === 'patterns') {
      fetchPatterns()
    } else if (activeTab === 'active') {
      fetchActiveAnomalies()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistoryAnomalies()
    }
  }, [page, historyLimit, filterType, filterSeverity, filterDevice, debouncedSearchHistory, activeTab])

  // Reset page when history filters/limit change
  useEffect(() => {
    setPage(1)
  }, [filterType, filterSeverity, filterDevice, historyLimit, debouncedSearchHistory])

  // Reset page when active filters/limit change
  useEffect(() => {
    setActivePage(1)
  }, [filterActiveType, filterActiveSeverity, filterActiveDevice, activeLimit, searchActiveQuery])

  const handleRefresh = () => {
    if (activeTab === 'active') {
      fetchActiveAnomalies()
    } else if (activeTab === 'history') {
      fetchHistoryAnomalies()
    } else if (activeTab === 'senders') {
      fetchSenders()
    } else if (activeTab === 'rca') {
      fetchRcaData()
    } else if (activeTab === 'patterns') {
      fetchPatterns()
    }
    toast.success('Data berhasil diperbarui.')
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
      case 'port_down':
        return 'badge-ssh' // Orangeish
      case 'stp_tcn':
        return 'badge-online' // Blue/Greenish
      case 'security_auth_fail':
        return 'badge-offline'
      default:
        return 'badge-neutral'
    }
  }

  const getSeverityBadgeClass = (sev) => {
    return sev === 'critical' ? 'badge-offline' : 'badge-ssh'
  }

  // --- Active anomalies client-side filtering logic ---
  const filteredActive = activeAnomalies.filter(a => {
    if (filterActiveType && a.anomaly_type !== filterActiveType) return false
    if (filterActiveSeverity && a.severity !== filterActiveSeverity) return false
    if (filterActiveDevice && String(a.device_id) !== String(filterActiveDevice)) return false
    if (searchActiveQuery) {
      const q = searchActiveQuery.toLowerCase()
      return (
        (a.details && a.details.toLowerCase().includes(q)) ||
        (a.device_name && a.device_name.toLowerCase().includes(q)) ||
        (a.device_ip && a.device_ip.toLowerCase().includes(q)) ||
        (a.interface_name && a.interface_name.toLowerCase().includes(q)) ||
        (a.anomaly_type && a.anomaly_type.toLowerCase().includes(q))
      )
    }
    return true
  })

  // Paginate filtered active anomalies on client-side
  const totalActivePages = Math.ceil(filteredActive.length / activeLimit) || 1
  
  // Guard active page bounds
  const currentPageActive = activePage > totalActivePages ? 1 : activePage
  
  const displayedActive = filteredActive.slice(
    (currentPageActive - 1) * activeLimit,
    currentPageActive * activeLimit
  )

  // Count raw active stats
  const criticalCount = activeAnomalies.filter(a => a.severity === 'critical').length
  const warningCount = activeAnomalies.filter(a => a.severity === 'warning').length

  return (
    <div className="page-container animate-fade">
      {/* Premium UI/UX Custom Styling */}
      <style>{`
        .anomaly-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }
        
        .anomaly-stat-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 22px;
          display: flex;
          align-items: center;
          gap: 18px;
          box-shadow: 0 4px 24px 0 rgba(0, 0, 0, 0.12);
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .anomaly-stat-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: transparent;
          transition: all 0.3s;
        }
        
        .anomaly-stat-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
          border-color: var(--primary-bright);
        }
        
        .anomaly-stat-card.total:hover::before {
          background: var(--primary);
        }
        
        .anomaly-stat-card.critical:hover::before {
          background: var(--danger);
        }
        
        .anomaly-stat-card.warning:hover::before {
          background: #f97316;
        }
        
        .anomaly-stat-icon {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.3s;
        }
        
        .anomaly-stat-card:hover .anomaly-stat-icon {
          transform: scale(1.1);
        }
        
        .anomaly-stat-val {
          font-size: 30px;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
        }
        
        .anomaly-stat-label {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 500;
          margin-top: 4px;
        }

        .pulse-red-glow {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5);
          animation: pulse-red-key 2s infinite;
        }
        
        .pulse-orange-glow {
          box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.5);
          animation: pulse-orange-key 2s infinite;
        }

        @keyframes pulse-red-key {
          0% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
        
        @keyframes pulse-orange-key {
          0% {
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.5);
          }
          70% {
            box-shadow: 0 0 0 10px rgba(249, 115, 22, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0);
          }
        }

        .filter-panel-glass {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 18px;
          margin-bottom: 20px;
          box-shadow: 0 4px 20px 0 rgba(0,0,0,0.08);
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: flex-end;
        }

        .filter-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
          min-width: 180px;
        }

        .filter-field-search {
          flex: 2;
          min-width: 250px;
        }

        .search-wrapper-relative {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon-pos {
          position: absolute;
          left: 12px;
          color: var(--text-muted);
        }

        .search-clear-btn {
          position: absolute;
          right: 12px;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
        }

        .search-clear-btn:hover {
          color: var(--text-primary);
        }

        .input-styled-filter {
          width: 100%;
          padding: 10px 12px 10px 38px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 10px;
          color: var(--text-primary);
          font-size: 13.5px;
          transition: all 0.2s;
        }

        .input-styled-filter:focus {
          border-color: var(--primary);
          outline: none;
          box-shadow: 0 0 0 2px var(--primary-dim);
        }

        .anomaly-card-modern {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 18px 22px;
          margin-bottom: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          box-shadow: 0 4px 15px 0 rgba(0, 0, 0, 0.05);
          position: relative;
          overflow: hidden;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .anomaly-card-modern:hover {
          transform: translateX(4px);
          border-color: var(--border-hover);
          box-shadow: 0 6px 22px 0 rgba(0, 0, 0, 0.12);
        }

        .anomaly-card-modern::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
        }
        
        .anomaly-card-modern.critical::before {
          background: linear-gradient(180deg, var(--danger) 0%, #ef4444 100%);
        }
        
        .anomaly-card-modern.warning::before {
          background: linear-gradient(180deg, #f97316 0%, #fb923c 100%);
        }

        .limit-select-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .tabs-header-wrapper {
          display: flex;
          border-bottom: 1px solid var(--border);
          margin-bottom: 20px;
          gap: 8px;
        }

        .tab-btn-modern {
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          color: var(--text-muted);
          padding: 12px 24px;
          font-size: 14.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .tab-btn-modern:hover {
          color: var(--text-primary);
        }

        .tab-btn-modern.active {
          border-bottom-color: var(--primary);
          color: var(--primary);
        }

        .badge-tab-count {
          background: var(--border-hover);
          color: var(--text-primary);
          padding: 2px 8px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 800;
        }

        .tab-btn-modern.active .badge-tab-count {
          background: var(--primary-dim);
          color: var(--primary);
        }

        /* Styled select option tags to guarantee readability on dark mode */
        select option {
          background-color: var(--bg-card-2) !important;
          color: var(--text-primary) !important;
        }

        /* Glowing outlines for themed buttons */
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

        .btn-outline-success {
          background: rgba(16, 185, 129, 0.08);
          color: var(--success);
          border: 1px solid rgba(16, 185, 129, 0.3) !important;
          transition: all 0.2s;
        }
        .btn-outline-success:hover {
          background: rgba(16, 185, 129, 0.2);
          border-color: var(--success) !important;
          color: var(--text-primary);
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
          transform: translateY(-1px);
        }

        .btn-danger-styled {
          background: rgba(239, 68, 68, 0.1);
          color: var(--danger);
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
          transition: all 0.2s;
        }
        .btn-danger-styled:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: var(--danger) !important;
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.25);
        }
      `}</style>

      {/* Header Area */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <AlertTriangle size={24} style={{ color: activeAnomalies.length > 0 ? 'var(--danger)' : 'var(--primary)' }} />
            Deteksi Anomali Jaringan
          </div>
          <div className="page-subtitle">
            Sistem pemantauan real-time mendeteksi broadcast storms, port flapping, L2 topology changes, kegagalan otentikasi, dan MAC flapping.
          </div>
        </div>
        <div className="flex-center gap-12">
          <button className="btn btn-outline-primary btn-sm animate-fade" onClick={handleRefresh} disabled={loadingActive || loadingHistory}>
            <RefreshCw size={13} style={{ marginRight: '6px', animation: (loadingActive || loadingHistory) ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
          </button>
          {!isViewer && activeAnomalies.length > 0 && (
            <button className="btn btn-danger-styled btn-sm" onClick={handleResolveAll} disabled={resolvingAll}>
              {resolvingAll ? 'Menyelesaikan...' : 'Selesaikan Semua'}
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="anomaly-stats-grid">
        <div className="anomaly-stat-card total">
          <div className="anomaly-stat-icon" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
            <Activity size={24} />
          </div>
          <div>
            <div className="anomaly-stat-val">{activeAnomalies.length}</div>
            <div className="anomaly-stat-label">Total Anomali Aktif</div>
          </div>
        </div>

        <div className="anomaly-stat-card critical">
          <div className={`anomaly-stat-icon ${criticalCount > 0 ? 'pulse-red-glow' : ''}`} style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}>
            <AlertOctagon size={24} />
          </div>
          <div>
            <div className="anomaly-stat-val" style={{ color: 'var(--danger)' }}>{criticalCount}</div>
            <div className="anomaly-stat-label">Kritis (Critical)</div>
          </div>
        </div>

        <div className="anomaly-stat-card warning">
          <div className={`anomaly-stat-icon ${warningCount > 0 ? 'pulse-orange-glow' : ''}`} style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <div className="anomaly-stat-val" style={{ color: '#f97316' }}>{warningCount}</div>
            <div className="anomaly-stat-label">Peringatan (Warning)</div>
          </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="tabs-header-wrapper">
        <button 
          className={`tab-btn-modern ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          Anomali Aktif 
          <span className="badge-tab-count">{activeAnomalies.length}</span>
        </button>
        <button 
          className={`tab-btn-modern ${activeTab === 'rca' ? 'active' : ''}`}
          onClick={() => setActiveTab('rca')}
        >
          🔍 Analisis Akar Masalah (RCA)
          {rcaIncidents.length > 0 && (
            <span className="badge-tab-count" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
              {rcaIncidents.length}
            </span>
          )}
        </button>
        <button 
          className={`tab-btn-modern ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Riwayat Log Anomali
        </button>
        <button 
          className={`tab-btn-modern ${activeTab === 'patterns' ? 'active' : ''}`}
          onClick={() => setActiveTab('patterns')}
        >
          📋 Pola Syslog (Clustering)
        </button>
        <button 
          className={`tab-btn-modern ${activeTab === 'senders' ? 'active' : ''}`}
          onClick={() => setActiveTab('senders')}
        >
          📊 Pengirim Log Aktif
        </button>
      </div>

      {/* --- TAB 1: ACTIVE ANOMALIES VIEW --- */}
      {activeTab === 'active' && (
        <>
          {/* Active Tab Filters Panel */}
          <div className="filter-panel-glass animate-fade">
            <div className="filter-field filter-field-search">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Cari Kata Kunci</label>
              <div className="search-wrapper-relative">
                <Search size={15} className="search-icon-pos" />
                <input 
                  type="text"
                  className="input-styled-filter"
                  placeholder="Cari detail, IP, tipe, atau port..."
                  value={searchActiveQuery}
                  onChange={e => setSearchActiveQuery(e.target.value)}
                />
                {searchActiveQuery && (
                  <button className="search-clear-btn" onClick={() => setSearchActiveQuery('')}>
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Jenis Anomali</label>
              <select 
                className="form-control"
                value={filterActiveType}
                onChange={e => setFilterActiveType(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Jenis</option>
                {Object.entries(ANOMALY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Tingkat Keparahan</label>
              <select 
                className="form-control"
                value={filterActiveSeverity}
                onChange={e => setFilterActiveSeverity(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Level</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Perangkat</label>
              <select 
                className="form-control"
                value={filterActiveDevice}
                onChange={e => setFilterActiveDevice(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Perangkat</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Anomalies List */}
          <div className="card">
            {loadingActive ? (
              <div className="loading-overlay" style={{ minHeight: '260px' }}>
                <div className="loading-spinner" />
                Memindai anomali aktif...
              </div>
            ) : filteredActive.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '260px' }}>
                <CheckCircle size={42} className="text-success" style={{ marginBottom: '16px' }} />
                <div className="empty-title" style={{ fontSize: '18px' }}>Jaringan Stabil & Bersih</div>
                <div className="empty-desc">
                  {searchActiveQuery || filterActiveType || filterActiveSeverity || filterActiveDevice 
                    ? 'Tidak ada anomali aktif yang sesuai dengan kriteria filter Anda.' 
                    : 'Tidak ada anomali atau gangguan port terdeteksi pada seluruh switch dikelola.'}
                </div>
              </div>
            ) : (
              <div>
                <div className="flex-between mb-16" style={{ padding: '0 4px' }}>
                  <div className="text-secondary" style={{ fontSize: '13px', fontWeight: 500 }}>
                    Menampilkan {displayedActive.length} dari {filteredActive.length} anomali aktif terfilter
                  </div>
                  
                  <div className="limit-select-container">
                    <span className="text-muted" style={{ fontSize: '12.5px', fontWeight: 500 }}>Batas Baris:</span>
                    <select
                      className="form-control"
                      value={activeLimit}
                      onChange={e => {
                        setActiveLimit(Number(e.target.value))
                        setActivePage(1)
                      }}
                      style={{ width: '80px', height: '34px', padding: '4px 8px', fontSize: '13px' }}
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={500}>500</option>
                    </select>
                  </div>
                </div>

                <div>
                  {displayedActive.map(a => (
                    <div key={a.id} className={`anomaly-card-modern ${a.severity} animate-fade`}>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                        <div style={{ marginTop: '4px' }}>
                          <AlertTriangle size={20} style={{ color: a.severity === 'critical' ? 'var(--danger)' : '#f97316' }} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: '14.5px', color: 'var(--text-primary)' }}>
                              {ANOMALY_TYPE_LABELS[a.anomaly_type] || a.anomaly_type}
                            </span>
                            <span className={`badge ${getSeverityBadgeClass(a.severity)}`} style={{ textTransform: 'uppercase', fontSize: '9px', fontWeight: 800 }}>
                              {a.severity}
                            </span>
                            <span className="badge badge-neutral" style={{ fontSize: '11px', fontWeight: 600 }}>
                              {a.device_name} ({a.device_ip})
                            </span>
                            {a.interface_name && a.interface_name !== 'Global' && (
                              <span className="badge badge-ssh" style={{ fontSize: '11px', background: 'var(--primary-dim)', color: 'var(--primary)', fontWeight: 600 }}>
                                Port: {cleanInterfaceName(a.interface_name)}
                              </span>
                            )}
                            {a.parent_anomaly_id && (() => {
                              const parent = activeAnomalies.find(p => p.id === a.parent_anomaly_id)
                              return (
                                <span className="badge" style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.08)', color: 'var(--danger)', border: '1px dashed var(--danger)', fontWeight: 600 }}>
                                  ⚠️ Dampak dari: {parent ? `${parent.device_name} (${ANOMALY_TYPE_LABELS[parent.anomaly_type] || parent.anomaly_type})` : `Akar Masalah #${a.parent_anomaly_id}`}
                                </span>
                              )
                            })()}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: '1.45' }}>
                            {a.details}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px' }}>
                            <Clock size={12} /> Terdeteksi pada: {formatTime(a.detected_at)}
                          </div>
                        </div>
                      </div>
                      
                      {!isViewer && (
                        <button 
                          className="btn btn-outline-success btn-sm" 
                          onClick={() => handleResolve(a.id)}
                          disabled={resolvingId === a.id}
                          style={{ height: '34px', minWidth: '95px' }}
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

                {/* Client-side Pagination Controls */}
                {totalActivePages > 1 && (
                  <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                    <div className="text-muted" style={{ fontSize: '12.5px' }}>
                      Halaman {currentPageActive} dari {totalActivePages}
                    </div>
                    <div className="flex-center gap-12">
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => setActivePage(p => Math.max(p - 1, 1))}
                        disabled={currentPageActive === 1}
                      >
                        <ChevronLeft size={14} /> Sebelum
                      </button>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {currentPageActive}
                      </span>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => setActivePage(p => Math.min(p + 1, totalActivePages))}
                        disabled={currentPageActive === totalActivePages}
                      >
                        Berikut <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* --- TAB 2: HISTORICAL LOGS VIEW --- */}
      {activeTab === 'history' && (
        <>
          {/* Historical Log Filters Panel */}
          <div className="filter-panel-glass animate-fade">
            <div className="filter-field filter-field-search">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Cari Kata Kunci</label>
              <div className="search-wrapper-relative">
                <Search size={15} className="search-icon-pos" />
                <input 
                  type="text"
                  className="input-styled-filter"
                  placeholder="Cari riwayat detail, IP, tipe, atau port..."
                  value={searchHistoryQuery}
                  onChange={e => setSearchHistoryQuery(e.target.value)}
                />
                {searchHistoryQuery && (
                  <button className="search-clear-btn" onClick={() => setSearchHistoryQuery('')}>
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Jenis Anomali</label>
              <select 
                className="form-control"
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Jenis</option>
                {Object.entries(ANOMALY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Tingkat Keparahan</label>
              <select 
                className="form-control"
                value={filterSeverity}
                onChange={e => setFilterSeverity(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Level</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </div>

            <div className="filter-field">
              <label className="form-label" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Perangkat</label>
              <select 
                className="form-control"
                value={filterDevice}
                onChange={e => setFilterDevice(e.target.value)}
                style={{ height: '40px' }}
              >
                <option value="">Semua Perangkat</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
                ))}
              </select>
            </div>
          </div>

          {/* History List Table Card */}
          <div className="card animate-fade">
            {loadingHistory ? (
              <div className="loading-overlay" style={{ minHeight: '260px' }}>
                <div className="loading-spinner" />
                Memuat riwayat log...
              </div>
            ) : historyAnomalies.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '260px' }}>
                <FileText size={42} className="text-muted" style={{ marginBottom: '16px' }} />
                <div className="empty-title" style={{ fontSize: '18px' }}>Log Kosong</div>
                <div className="empty-desc">Tidak ada catatan anomali yang sesuai dengan kriteria penyaringan filter Anda.</div>
              </div>
            ) : (
              <>
                <div className="flex-between mb-12" style={{ padding: '0 4px' }}>
                  <div className="text-secondary" style={{ fontSize: '13px', fontWeight: 500 }}>
                    Menampilkan {(page - 1) * historyLimit + 1} - {Math.min(page * historyLimit, totalHistory)} dari {totalHistory} catatan log
                  </div>
                  
                  <div className="limit-select-container">
                    <span className="text-muted" style={{ fontSize: '12.5px', fontWeight: 500 }}>Batas Baris:</span>
                    <select
                      className="form-control"
                      value={historyLimit}
                      onChange={e => setHistoryLimit(Number(e.target.value))}
                      style={{ width: '80px', height: '34px', padding: '4px 8px', fontSize: '13px' }}
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={500}>500</option>
                    </select>
                  </div>
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '170px' }}>Waktu Terdeteksi</th>
                        <th>Device</th>
                        <th>Jenis Anomali</th>
                        <th>Severity</th>
                        <th>Port / Interface</th>
                        <th>Detail Rincian</th>
                        <th style={{ width: '170px' }}>Waktu Selesai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyAnomalies.map(h => (
                        <tr key={h.id}>
                          <td className="mono" style={{ fontSize: '11.5px' }}>{formatTime(h.detected_at)}</td>
                          <td style={{ fontWeight: 600 }}>{h.device_name}</td>
                          <td>
                            <span className={`badge ${getAnomalyBadgeClass(h.anomaly_type)}`} style={{ fontSize: '10.5px', fontWeight: 700 }}>
                              {ANOMALY_TYPE_LABELS[h.anomaly_type] || h.anomaly_type}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${getSeverityBadgeClass(h.severity)}`} style={{ fontSize: '9.5px', textTransform: 'uppercase', fontWeight: 800 }}>
                              {h.severity}
                            </span>
                          </td>
                          <td className="mono" style={{ fontWeight: 'bold' }}>{cleanInterfaceName(h.interface_name) || '—'}</td>
                          <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)', maxWeight: '400px' }}>{h.details}</td>
                          <td className="mono" style={{ fontSize: '11.5px', color: h.is_active ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {h.is_active ? (
                              <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="status-dot pulse-red-glow" style={{ background: 'var(--danger)', width: 6, height: 6 }} /> Aktif
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
                    Halaman {page} dari {totalPages}
                  </div>
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.max(p - 1, 1))}
                      disabled={page === 1 || loadingHistory}
                    >
                      <ChevronLeft size={14} /> Sebelum
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {page}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                      disabled={page === totalPages || loadingHistory}
                    >
                      Berikut <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* --- TAB 4: RCA VIEW --- */}
      {activeTab === 'rca' && (
        <div className="animate-slide">
          <div className="card p-0" style={{ overflow: 'hidden' }}>
            <div className="p-24" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Analisis Akar Masalah (Root Cause Analysis - RCA)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Mengkorelasikan beberapa anomali aktif berdasarkan hubungan topologi uplink dan port interkoneksi fisik (LLDP/CDP).
                </p>
              </div>
              <button className="btn btn-outline-primary btn-sm" onClick={fetchRcaData} disabled={loadingRca}>
                <RefreshCw size={12} className={loadingRca ? 'spin' : ''} style={{ marginRight: '6px' }} /> Segarkan Data
              </button>
            </div>

            {loadingRca ? (
              <div className="loading-overlay" style={{ padding: '48px' }}>
                <div className="loading-spinner" />
                <span>Menganalisis korelasi akar masalah...</span>
              </div>
            ) : rcaIncidents.length === 0 ? (
              <div className="empty-state" style={{ padding: '48px', minHeight: '200px' }}>
                <CheckCircle size={42} className="text-success" style={{ marginBottom: '16px' }} />
                <div className="empty-title" style={{ fontSize: '16px' }}>Tidak Ada Korelasi Akar Masalah</div>
                <div className="empty-desc">Seluruh anomali aktif bersifat independen atau tidak ada gangguan interkoneksi topologi terdeteksi.</div>
              </div>
            ) : (
              <div style={{ padding: '24px' }}>
                {rcaIncidents.map((incident) => {
                  const rc = incident.root_cause
                  const isExpanded = !!expandedIncidents[incident.id]
                  return (
                    <div key={incident.id} className="card mb-16" style={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', padding: 0 }}>
                      {/* Root Cause Header */}
                      <div style={{ 
                        background: 'rgba(79, 142, 247, 0.04)', 
                        padding: '16px 20px', 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        borderBottom: isExpanded ? '1px solid var(--border)' : 'none',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <AlertOctagon size={22} style={{ color: rc.severity === 'critical' ? 'var(--danger)' : '#f97316' }} />
                          <div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800, fontSize: '14.5px', color: 'var(--text-primary)' }}>
                                {rc.device_name} ({rc.device_ip})
                              </span>
                              <span className={`badge ${getSeverityBadgeClass(rc.severity)}`} style={{ fontSize: '9px', fontWeight: 800 }}>
                                {rc.severity.toUpperCase()}
                              </span>
                              <span className="badge badge-neutral" style={{ fontSize: '11px', background: 'var(--danger-dim)', color: 'var(--danger)' }}>
                                ROOT CAUSE (Sumber Masalah)
                              </span>
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                              <strong>{ANOMALY_TYPE_LABELS[rc.anomaly_type] || rc.anomaly_type}</strong>: {rc.details}
                            </div>
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          {incident.impact_count > 0 && (
                            <button 
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => toggleIncidentExpand(incident.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                              {isExpanded ? 'Sembunyikan' : 'Lihat'} {incident.impact_count} Dampak
                            </button>
                          )}
                          {!isViewer && (
                            <button 
                              className="btn btn-outline-success btn-sm"
                              onClick={() => handleResolve(rc.id)}
                              disabled={resolvingId === rc.id}
                            >
                              Selesaikan
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Impacted Child Anomalies */}
                      {isExpanded && incident.impacts.length > 0 && (
                        <div style={{ padding: '16px 20px', background: 'var(--bg-body)' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            Daftar Perangkat/Port Terdampak (Dependent Outages):
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {incident.impacts.map((child) => (
                              <div key={child.id} style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                alignItems: 'center', 
                                padding: '10px 14px', 
                                background: 'var(--bg-card)', 
                                borderLeft: '3px solid var(--danger)', 
                                borderRadius: '6px' 
                              }}>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                  <Info size={16} style={{ color: 'var(--text-muted)' }} />
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                                      {child.device_name} ({child.device_ip})
                                    </span>
                                    {child.interface_name && child.interface_name !== 'Global' && (
                                      <span className="badge badge-ssh" style={{ marginLeft: '6px', fontSize: '10.5px' }}>
                                        Port: {cleanInterfaceName(child.interface_name)}
                                      </span>
                                    )}
                                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                      {child.details}
                                    </div>
                                  </div>
                                </div>
                                {!isViewer && (
                                  <button 
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleResolve(child.id)}
                                    disabled={resolvingId === child.id}
                                    style={{ fontSize: '11px', height: '28px' }}
                                  >
                                    Selesaikan
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- TAB 5: SYSLOG PATTERNS VIEW --- */}
      {activeTab === 'patterns' && (
        <div className="animate-slide">
          <div className="card p-0" style={{ overflow: 'hidden' }}>
            <div className="p-24" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Klaster & Profil Pola Syslog (Clustering)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Mengelompokkan pesan syslog mentah menjadi pola terstruktur. Membisukan log bising atau menandai pola log sebagai anomali kritis.
                </p>
              </div>
              <button className="btn btn-outline-primary btn-sm" onClick={fetchPatterns} disabled={loadingPatterns}>
                <RefreshCw size={12} className={loadingPatterns ? 'spin' : ''} style={{ marginRight: '6px' }} /> Segarkan Data
              </button>
            </div>

            {loadingPatterns ? (
              <div className="loading-overlay" style={{ padding: '48px' }}>
                <div className="loading-spinner" />
                <span>Memuat klaster pola syslog...</span>
              </div>
            ) : syslogPatterns.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Belum ada pola syslog tercatat di database.
              </div>
            ) : (
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: '24px' }}>Hash & Pola Template</th>
                      <th>Program</th>
                      <th style={{ textAlign: 'center' }}>Severity</th>
                      <th style={{ textAlign: 'center' }}>Kemunculan</th>
                      <th>Terakhir Dilihat</th>
                      <th style={{ paddingRight: '24px', textAlign: 'right', width: '240px' }}>Aksi / Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syslogPatterns.map((p) => (
                      <tr key={p.pattern_hash} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ paddingLeft: '24px', verticalAlign: 'top', paddingTop: '14px', paddingBottom: '14px' }}>
                          <span className="mono" style={{ fontSize: '10px', background: 'var(--bg-body)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                            {p.pattern_hash.slice(0, 8)}
                          </span>
                          <div style={{ 
                            fontSize: '13px', 
                            color: 'var(--text-primary)', 
                            fontWeight: 600, 
                            marginTop: '6px', 
                            whiteSpace: 'pre-wrap', 
                            wordBreak: 'break-all',
                            maxWidth: '500px'
                          }}>
                            {p.template}
                          </div>
                        </td>
                        <td style={{ verticalAlign: 'top', paddingTop: '14px' }}>
                          <span className="badge badge-neutral" style={{ fontSize: '11px' }}>{p.program || 'syslog'}</span>
                        </td>
                        <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: '14px' }}>
                          <span className="badge" style={{ 
                            fontSize: '10px', 
                            background: p.severity <= 3 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-body)', 
                            color: p.severity <= 3 ? 'var(--danger)' : 'var(--text-secondary)' 
                          }}>
                            Lvl {p.severity}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: '14px' }}>
                          <span style={{ fontWeight: 800, color: 'var(--primary)' }}>
                            {p.occurrence_count.toLocaleString()}
                          </span>
                        </td>
                        <td style={{ verticalAlign: 'top', paddingTop: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {p.last_seen ? formatTime(p.last_seen) : '—'}
                        </td>
                        <td style={{ paddingRight: '24px', textAlign: 'right', verticalAlign: 'top', paddingTop: '14px' }}>
                          <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              className={`btn btn-sm ${p.is_blocked === 1 ? 'btn-danger-styled' : 'btn-ghost'}`}
                              onClick={() => handleTogglePatternStatus(p.pattern_hash, 'is_blocked', p.is_blocked)}
                              disabled={updatingPatternHash === p.pattern_hash || isViewer}
                              style={{ height: '30px', fontSize: '11px', minWidth: '75px' }}
                            >
                              {p.is_blocked === 1 ? 'Bising (Muted)' : 'Mute Log'}
                            </button>
                            <button
                              className={`btn btn-sm ${p.is_anomaly === 1 ? 'btn-outline-primary' : 'btn-ghost'}`}
                              onClick={() => handleTogglePatternStatus(p.pattern_hash, 'is_anomaly', p.is_anomaly)}
                              disabled={updatingPatternHash === p.pattern_hash || isViewer}
                              style={{ height: '30px', fontSize: '11px', minWidth: '85px' }}
                            >
                              {p.is_anomaly === 1 ? '⚠️ Anomali' : 'Set Anomali'}
                            </button>
                          </div>
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

      {/* --- TAB 3: LOG SENDERS VIEW --- */}
      {activeTab === 'senders' && (
        <div className="animate-slide">
          <div className="card p-0" style={{ overflow: 'hidden' }}>
            <div className="p-24" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Perangkat Aktif Mengirimkan Syslog
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                  Menampilkan daftar IP/perangkat yang mengirimkan log ke server NetX.
                </p>
              </div>
              <button className="btn btn-outline-primary btn-sm" onClick={fetchSenders} disabled={loadingSenders}>
                <RefreshCw size={12} className={loadingSenders ? 'spin' : ''} /> Segarkan Data
              </button>
            </div>

            {loadingSenders ? (
              <div className="loading-overlay" style={{ padding: '48px' }}>
                <div className="loading-spinner" />
                <span>Memuat data pengirim syslog...</span>
              </div>
            ) : logSenders.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Belum ada perangkat yang tercatat mengirimkan log ke server.
              </div>
            ) : (
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: '24px' }}>Nama Perangkat</th>
                      <th>IP Address</th>
                      <th>Source IP Log</th>
                      <th style={{ textAlign: 'center' }}>Jumlah Log Diterima</th>
                      <th style={{ paddingRight: '24px', textAlign: 'right' }}>Terakhir Dilihat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logSenders.map((s, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ paddingLeft: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {s.device_name}
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>{s.device_ip}</td>
                        <td className="mono" style={{ color: 'var(--text-muted)' }}>{s.raw_sender_ip}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ 
                            background: 'var(--primary-dim)', 
                            color: 'var(--primary)', 
                            padding: '4px 10px', 
                            borderRadius: '12px', 
                            fontSize: '12px',
                            fontWeight: 700
                          }}>
                            {s.log_count.toLocaleString()}
                          </span>
                        </td>
                        <td style={{ paddingRight: '24px', textAlign: 'right', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          {new Date(s.last_seen).toLocaleString('id-ID')}
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
    </div>
  )
}
