import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Layers, RefreshCw, AlertTriangle, CheckCircle, Info, ShieldAlert,
  Search, Power, HelpCircle, ArrowLeft, ChevronDown, Activity, 
  ExternalLink, Shield, Sliders, Play, AlertCircle, X, Cpu, Zap,
  TrendingUp, AlertOctagon, Network, Clock, List, FileText, ArrowRight
} from 'lucide-react'
import { devicesApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useTheme } from '../context/ThemeContext'
import { cleanInterfaceName } from '../utils/portUtils'

export default function PortAnalysis({ deviceId: propDeviceId }) {
  const { id: routeDeviceId } = useParams()
  const deviceId = propDeviceId || routeDeviceId
  const navigate = useNavigate()
  const toast = useToast()
  const { theme } = useTheme()

  const [deviceList, setDeviceList] = useState([])
  const [selectedDevice, setSelectedDevice] = useState(deviceId || '')
  const [deviceInfo, setDeviceInfo] = useState(null)
  
  // Tab control
  const [activeTab, setActiveTab] = useState('overview') // overview | ports | stp | vlan | mac | timeline | lifecycle

  // Data states
  const [overviewData, setOverviewData] = useState(null)
  const [portsData, setPortsData] = useState([])
  const [stpData, setStpData] = useState(null)
  const [vlanData, setVlanData] = useState(null)
  const [macData, setMacData] = useState(null)
  const [timelineData, setTimelineData] = useState([])
  const [lifecycleData, setLifecycleData] = useState([])
  
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  // Filters for ports tab
  const [portSearch, setPortSearch] = useState('')
  const [portStatusFilter, setPortStatusFilter] = useState('all') // all | up | down
  const [portTypeFilter, setPortTypeFilter] = useState('all') // all | access | trunk
  const [portSfpFilter, setPortSfpFilter] = useState('all') // all | sfp | copper

  // Filters for lifecycle tab
  const [lifecycleSearch, setLifecycleSearch] = useState('')
  const [lifecycleClassFilter, setLifecycleClassFilter] = useState('all')

  // Filters and pagination for MAC tab
  const [macSearch, setMacSearch] = useState('')
  const [macPageSize, setMacPageSize] = useState(50)
  const [macCurrentPage, setMacCurrentPage] = useState(1)

  // Selected port details modal
  const [selectedPort, setSelectedPort] = useState(null)

  // Fetch switches list for selector if outside device context
  useEffect(() => {
    if (!deviceId) {
      devicesApi.list()
        .then(res => {
          setDeviceList(res.data || [])
          if (res.data && res.data.length > 0) {
            setSelectedDevice(res.data[0].id)
          }
        })
        .catch(() => {
          toast.error('Gagal mengambil daftar perangkat.')
        })
    }
  }, [deviceId])

  // Load L2 Analysis data
  useEffect(() => {
    const devId = deviceId || selectedDevice
    if (devId) {
      fetchL2Analysis(devId)
      fetchDeviceInfo(devId)
    }
  }, [deviceId, selectedDevice])

  const fetchDeviceInfo = async (id) => {
    try {
      const res = await devicesApi.get(id)
      setDeviceInfo(res.data)
    } catch (_) {}
  }

  const fetchL2Analysis = async (id) => {
    setLoading(true)
    try {
      // Fetch all endpoints concurrently
      const [overviewRes, portsRes, stpRes, vlanRes, macRes, timelineRes, lifecycleRes] = await Promise.all([
        devicesApi.getL2Overview(id),
        devicesApi.getL2Ports(id),
        devicesApi.getL2Stp(id),
        devicesApi.getL2Vlans(id),
        devicesApi.getL2Macs(id),
        devicesApi.getL2Timeline(id),
        devicesApi.getL2Lifecycle(id)
      ])

      setOverviewData(overviewRes.data)
      setPortsData(portsRes.data || [])
      setStpData(stpRes.data)
      setVlanData(vlanRes.data)
      setMacData(macRes.data)
      setTimelineData(timelineRes.data || [])
      setLifecycleData(lifecycleRes.data || [])
      setLastUpdated(new Date().toLocaleTimeString('id-ID'))
    } catch (err) {
      toast.error('Gagal memuat data L2 Analysis: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    const devId = deviceId || selectedDevice
    if (!devId) return

    setRefreshing(true)
    toast.info('Memulai penyelarasan Layer 2...')
    try {
      // 1. Submit job — returns immediately with job_id
      const startRes = await devicesApi.refreshL2(devId)
      const jobId = startRes.data?.job_id
      if (!jobId) throw new Error('Tidak ada job_id dari server.')

      // 2. Poll status every 2s, up to 180s
      const MAX_WAIT_MS = 180000
      const INTERVAL_MS = 2000
      const started = Date.now()

      await new Promise((resolve, reject) => {
        const poll = async () => {
          if (Date.now() - started > MAX_WAIT_MS) {
            return reject(new Error('Waktu habis setelah 3 menit menunggu penyelarasan L2.'))
          }
          try {
            const statusRes = await devicesApi.getL2RefreshStatus(devId, jobId)
            if (statusRes.data?.status === 'done') return resolve()
            if (statusRes.data?.status === 'error') return reject(new Error(statusRes.data.message || 'Error tidak diketahui.'))
            // Still pending — continue polling
            setTimeout(poll, INTERVAL_MS)
          } catch (pollErr) {
            // HTTP 503 / 404 from status endpoint means error or expired
            reject(new Error(pollErr.response?.data?.detail || pollErr.message))
          }
        }
        setTimeout(poll, INTERVAL_MS)
      })

      toast.success('Penyelarasan Layer 2 selesai.')
      await fetchL2Analysis(devId)
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Tidak diketahui'
      toast.error('Penyelarasan L2 gagal: ' + detail)
    } finally {
      setRefreshing(false)
    }
  }

  const handleDeviceChange = (e) => {
    setSelectedDevice(e.target.value)
    setSelectedPort(null)
  }

  // Filter ports logic
  const filteredPorts = useMemo(() => {
    return portsData.filter(port => {
      const q = portSearch.toLowerCase()
      const matchesSearch = !q || 
        port.interface_name.toLowerCase().includes(q) ||
        cleanInterfaceName(port.interface_name).toLowerCase().includes(q) ||
        (port.connected_device && port.connected_device.toLowerCase().includes(q)) ||
        (port.description && port.description.toLowerCase().includes(q)) ||
        (port.vlan && port.vlan.toLowerCase().includes(q))

      const matchesStatus = portStatusFilter === 'all' || port.oper_status === portStatusFilter
      const matchesType = portTypeFilter === 'all' || port.port_type.toLowerCase() === portTypeFilter
      const matchesSfp = portSfpFilter === 'all' || 
        (portSfpFilter === 'sfp' && port.sfp_vendor !== '') || 
        (portSfpFilter === 'copper' && port.sfp_vendor === '')

      return matchesSearch && matchesStatus && matchesType && matchesSfp
    })
  }, [portsData, portSearch, portStatusFilter, portTypeFilter, portSfpFilter])

  // Filter lifecycle logic
  const filteredLifecycle = useMemo(() => {
    return lifecycleData.filter(item => {
      const q = lifecycleSearch.toLowerCase()
      const matchesSearch = !q ||
        item.interface_name.toLowerCase().includes(q) ||
        cleanInterfaceName(item.interface_name).toLowerCase().includes(q) ||
        (item.classification && item.classification.toLowerCase().includes(q))
        
      let matchesClass = true
      if (lifecycleClassFilter !== 'all') {
        if (lifecycleClassFilter === 'Candidate for Reuse') {
          const p = portsData.find(port => port.interface_name === item.interface_name)
          matchesClass = p?.recommendation_action === 'Candidate for Reuse'
        } else if (lifecycleClassFilter === 'Safe to Disable') {
          const p = portsData.find(port => port.interface_name === item.interface_name)
          matchesClass = p?.recommendation_action === 'Safe to Disable'
        } else {
          matchesClass = item.classification === lifecycleClassFilter
        }
      }
      return matchesSearch && matchesClass
    })
  }, [lifecycleData, portsData, lifecycleSearch, lifecycleClassFilter])

  const portLifecycle = useMemo(() => {
    if (!selectedPort || !lifecycleData) return null
    return lifecycleData.find(l => l.interface_name === selectedPort.interface_name)
  }, [selectedPort, lifecycleData])

  // Scores computed helper
  const scores = overviewData?.scores || { l2: 100, port: 100, stp: 100, sfp: 100, loop_risk: 0, broadcast_risk: 0, confidence_score: 100, data_source: 'Simulation', validation_status: 'Verified' }
  const summary = overviewData?.summary || { total_ports: 0, active_ports: 0, inactive_ports: 0, stp_mode: 'unknown', root_bridge: '—', root_port: '—', active_loops: 0 }

  const getScoreColorClass = (val) => {
    if (val >= 90) return 'text-success'
    if (val >= 70) return 'text-warning'
    return 'text-danger'
  }

  const getScoreBgClass = (val) => {
    if (val >= 90) return 'bg-success-glow'
    if (val >= 70) return 'bg-warning-glow'
    return 'bg-danger-glow'
  }

  // AI recommendations compiler based on metrics
  const aiRecommendations = useMemo(() => {
    const list = []
    if (scores.loop_risk > 50) {
      list.push({
        id: 'rec_loop',
        title: '⚠️ Kemungkinan Loop Layer 2 Terdeteksi',
        desc: 'Loop terindikasi karena status flapping berlebih dan pps broadcast tinggi di interface switch. Silakan cek diagram STP dan matikan port bermasalah.',
        action: 'Lihat STP Topology',
        tab: 'stp'
      })
    }
    if (scores.broadcast_risk > 50) {
      list.push({
        id: 'rec_broadcast',
        title: '📣 Trafik Broadcast Berlebih (Broadcast Storm)',
        desc: 'Peningkatan packet per second broadcast terdeteksi. Silakan cek port yang terjangkit dan pertimbangan storm control.',
        action: 'Periksa Port Trafik',
        tab: 'ports'
      })
    }
    if (vlanData?.mismatches?.length > 0) {
      list.push({
        id: 'rec_vlan_mismatch',
        title: '🛑 Mismatch Native VLAN pada Trunk',
        desc: 'Native VLAN mismatch terdeteksi dengan perangkat tetangga. Perbaiki konfigurasi native vlan agar sejajar.',
        action: 'Lihat VLAN Config',
        tab: 'vlan'
      })
    }
    if (vlanData?.pruning_recommendations?.length > 0) {
      list.push({
        id: 'rec_vlan_pruning',
        title: '✂️ Rekomendasi Pruning VLAN Trunk',
        desc: 'Terdeteksi allowed VLAN list yang terlalu besar dan tidak aktif. Lakukan pruning VLAN untuk efisiensi multicast/broadcast domain.',
        action: 'Detail Pruning VLAN',
        tab: 'vlan'
      })
    }
    if (portsData.some(p => p.sfp_health === 'Critical')) {
      list.push({
        id: 'rec_sfp_critical',
        title: '🔌 Deteksi Modul Transceiver SFP Kritis',
        desc: 'Ada SFP transceiver dengan optical RX power di bawah ambang batas (low power). Segera periksa kebersihan kabel serat optik atau ganti SFP.',
        action: 'Lihat Detail SFP',
        tab: 'ports'
      })
    }
    if (macData?.duplicates?.length > 0) {
      list.push({
        id: 'rec_mac_flap',
        title: '🔀 Deteksi MAC Address Flapping / Bergerak',
        desc: 'MAC Address yang sama terdeteksi berpindah-pindah antar interface secara agresif. Indikasi loop fisik atau IP duplicate.',
        action: 'Periksa MAC Table',
        tab: 'mac'
      })
    }
    if (portsData.some(p => p.oper_status === 'down' && p.admin_status === 'up' && p.recommendation_code === 'safe_to_disable')) {
      list.push({
        id: 'rec_admin_down',
        title: '🔒 Matikan Port Fisik Tidak Terpakai',
        desc: 'Beberapa port fisik terdeteksi DOWN lebih dari 90 hari tetapi secara administratif masih UP. Nonaktifkan port ini secara administratif demi keamanan internal.',
        action: 'Filter Port Inaktif',
        tab: 'ports'
      })
    }

    if (list.length === 0) {
      list.push({
        id: 'rec_healthy',
        title: '✅ Layer 2 Beroperasi Optimal',
        desc: 'Selamat! Tidak ditemukan anomali STP, Loop, VLAN mismatch, atau kerusakan SFP. Switch dalam keadaan prima.',
        action: 'Lihat Port Summary',
        tab: 'overview'
      })
    }
    return list
  }, [scores, vlanData, portsData, macData])

  const filteredMacs = useMemo(() => {
    if (!macData?.entries) return []
    const q = macSearch.toLowerCase().trim()
    if (!q) return macData.entries
    return macData.entries.filter(m => 
      m.mac_address?.toLowerCase().includes(q) ||
      m.interface_name?.toLowerCase().includes(q) ||
      `vlan ${m.vlan}`.toLowerCase().includes(q) ||
      m.vlan?.toString().includes(q) ||
      m.entry_type?.toLowerCase().includes(q) ||
      m.mac_vendor?.toLowerCase().includes(q)
    )
  }, [macData, macSearch])

  const paginatedMacs = useMemo(() => {
    const start = (macCurrentPage - 1) * macPageSize
    return filteredMacs.slice(start, start + macPageSize)
  }, [filteredMacs, macCurrentPage, macPageSize])

  const totalMacPages = Math.ceil(filteredMacs.length / macPageSize) || 1

  useEffect(() => {
    setMacCurrentPage(1)
  }, [macSearch, macPageSize])

  return (
    <div className={propDeviceId ? "animate-fade" : "page-container animate-fade"}>
      {/* 1. Header Area */}
      {!propDeviceId && (
        <div style={{ marginBottom: '20px' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ marginBottom: '12px' }}>
            <ArrowLeft size={14} /> Kembali ke Dashboard
          </button>
          
          <div className="page-header">
            <div>
              <div className="page-title" style={{ gap: '12px' }}>
                <Layers size={22} style={{ color: 'var(--primary)' }} />
                Redesain Layer 2 Analysis Platform
              </div>
              <div className="page-subtitle">
                Modul diagnostik interaktif STP, VLAN, MAC, Loop Detection, Transceiver SFP, dan AI Troubleshoot untuk Switch Enterprise.
              </div>
            </div>
            
            <div className="flex-center gap-12">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Pilih Device:</span>
                <select
                  className="form-control"
                  style={{ width: '220px', padding: '6px 10px', fontSize: '13px' }}
                  value={selectedDevice}
                  onChange={handleDeviceChange}
                >
                  <option value="" disabled>Pilih Perangkat...</option>
                  {deviceList.map(dev => (
                    <option key={dev.id} value={dev.id}>{dev.name} ({dev.ip})</option>
                  ))}
                </select>
              </div>
              
              <button className="btn btn-primary btn-sm" onClick={handleRefresh} disabled={loading || refreshing || !selectedDevice}>
                <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
                {refreshing ? 'Menyelaraskan L2...' : 'Live L2 Sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {propDeviceId && (
        <div className="flex-between mb-16" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
          <div>
            <h4 style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} className="text-primary" /> Layer 2 Analysis Platform
            </h4>
            <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>
              Analisis siklus hidup port switch, STP topology, loop risk, dan SFP health.
            </p>
          </div>
          <div className="flex-center gap-12">
            {lastUpdated && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Terakhir Diperbarui: {lastUpdated}
              </span>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleRefresh} disabled={loading || refreshing}>
              <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Menyinkronkan...' : 'Segarkan Data L2'}
            </button>
          </div>
        </div>
      )}

      {loading && !overviewData ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px', gap: '16px' }}>
          <div className="loading-spinner" style={{ width: 36, height: 36 }} />
          <span style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>Menganalisis MIB Spanning Tree, VLAN, Port, dan Transceiver SFP...</span>
        </div>
      ) : !overviewData ? (
        <div className="empty-state" style={{ padding: '64px', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
          <Info size={32} className="text-muted" style={{ marginBottom: '12px' }} />
          <div className="empty-title">Tidak Ada Data L2 Analysis</div>
          <div className="empty-desc">
            {!selectedDevice && !deviceId ? 'Silakan pilih perangkat switch terlebih dahulu di atas.' : 'Gagal memuat modul L2. Lakukan Sinkronisasi L2 dengan tombol di atas.'}
          </div>
        </div>
      ) : (
        <div>
          {/* Tabs Menu */}
          <div className="tabs" style={{ marginBottom: '20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '16px' }}>
            <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'overview' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'overview' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'overview' ? 600 : 400, cursor: 'pointer' }}>
              <Cpu size={15} /> L2 Health Overview
            </button>
            <button className={`tab ${activeTab === 'ports' ? 'active' : ''}`} onClick={() => setActiveTab('ports')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'ports' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'ports' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'ports' ? 600 : 400, cursor: 'pointer' }}>
              <Sliders size={15} /> Port Diagnostics
            </button>
            <button className={`tab ${activeTab === 'stp' ? 'active' : ''}`} onClick={() => setActiveTab('stp')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'stp' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'stp' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'stp' ? 600 : 400, cursor: 'pointer' }}>
              <Network size={15} /> Spanning Tree
            </button>
            <button className={`tab ${activeTab === 'vlan' ? 'active' : ''}`} onClick={() => setActiveTab('vlan')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'vlan' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'vlan' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'vlan' ? 600 : 400, cursor: 'pointer' }}>
              <Layers size={15} /> VLAN & Trunk
            </button>
            <button className={`tab ${activeTab === 'mac' ? 'active' : ''}`} onClick={() => setActiveTab('mac')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'mac' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'mac' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'mac' ? 600 : 400, cursor: 'pointer' }}>
              <Shield size={15} /> MAC Address
            </button>
            <button className={`tab ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'timeline' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'timeline' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'timeline' ? 600 : 400, cursor: 'pointer' }}>
              <Clock size={15} /> L2 Timeline
            </button>
            <button className={`tab ${activeTab === 'lifecycle' ? 'active' : ''}`} onClick={() => setActiveTab('lifecycle')} style={{ padding: '10px 4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: activeTab === 'lifecycle' ? '2px solid var(--primary)' : '', background: 'none', border: 'none', color: activeTab === 'lifecycle' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'lifecycle' ? 600 : 400, cursor: 'pointer' }}>
              <TrendingUp size={15} /> Port Lifecycle Analysis
            </button>
          </div>

          {/* Validation Status & Confidence Score Banner */}
          <div className="card animate-fade" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            marginBottom: '20px',
            background: scores.confidence_score >= 90 ? 'rgba(16, 185, 129, 0.05)' : (scores.confidence_score >= 70 ? 'rgba(245, 158, 11, 0.05)' : 'rgba(239, 68, 68, 0.05)'),
            borderLeft: `4px solid ${scores.confidence_score >= 90 ? 'var(--success)' : (scores.confidence_score >= 70 ? 'var(--warning)' : 'var(--danger)')}`,
            borderRadius: 'var(--radius)',
            gap: '12px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {scores.confidence_score >= 90 ? (
                <CheckCircle size={18} className="text-success" />
              ) : (
                <AlertTriangle size={18} className={scores.confidence_score >= 70 ? 'text-warning' : 'text-danger'} />
              )}
              <div>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>
                  Metode Pengumpulan & Validasi Data L2
                </span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Sumber: <span style={{ color: 'var(--primary)' }}>{scores.data_source}</span> | Status: <span style={{ fontStyle: 'italic' }}>{scores.validation_status}</span>
                </span>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>
                  Confidence Score
                </span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: scores.confidence_score >= 90 ? 'var(--success)' : (scores.confidence_score >= 70 ? 'var(--warning)' : 'var(--danger)') }} className="mono">
                  {scores.confidence_score}%
                </span>
              </div>
            </div>
          </div>

          {/* TAB CONTENT: OVERVIEW */}
          {activeTab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px' }}>
              {/* Left Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* Health Score Card Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div className="card text-center" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Device L2 Score</div>
                    <div className={`mono ${getScoreColorClass(scores.l2)}`} style={{ fontSize: '42px', fontWeight: 800, margin: '8px 0' }}>
                      {scores.l2}
                    </div>
                    <div style={{ display: 'inline-block', fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px' }} className={getScoreBgClass(scores.l2)}>
                      L2 Health
                    </div>
                  </div>
                  <div className="card text-center" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Port Health</div>
                    <div className={`mono ${getScoreColorClass(scores.port)}`} style={{ fontSize: '42px', fontWeight: 800, margin: '8px 0' }}>
                      {scores.port}
                    </div>
                    <div style={{ display: 'inline-block', fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px' }} className={getScoreBgClass(scores.port)}>
                      Ports Integrity
                    </div>
                  </div>
                  <div className="card text-center" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>STP Integrity</div>
                    <div className={`mono ${getScoreColorClass(scores.stp)}`} style={{ fontSize: '42px', fontWeight: 800, margin: '8px 0' }}>
                      {scores.stp}
                    </div>
                    <div style={{ display: 'inline-block', fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px' }} className={getScoreBgClass(scores.stp)}>
                      Spanning Tree
                    </div>
                  </div>
                  <div className="card text-center" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>SFP Optical Health</div>
                    <div className={`mono ${getScoreColorClass(scores.sfp)}`} style={{ fontSize: '42px', fontWeight: 800, margin: '8px 0' }}>
                      {scores.sfp}
                    </div>
                    <div style={{ display: 'inline-block', fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px' }} className={getScoreBgClass(scores.sfp)}>
                      Transceivers
                    </div>
                  </div>
                </div>

                {/* Anomalies, Loop, Storm Alerts */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  
                  {/* Loop Detection status card */}
                  <div className="card" style={{ padding: '20px', borderLeft: scores.loop_risk > 50 ? '5px solid var(--danger)' : '5px solid var(--success)' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertOctagon size={18} className={scores.loop_risk > 50 ? 'text-danger' : 'text-success'} />
                      Status Loop Layer 2
                    </h4>
                    
                    {scores.loop_risk > 50 ? (
                      <div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--danger)', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          {scores.loop_risk}%
                          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Loop Probability</span>
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0 12px 0', lineHeight: '1.45' }}>
                          <strong>Akar Masalah:</strong> Peningkatan topology change, broadcast pps ekstrim pada interface <strong>{portsData.find(p => p.broadcast_pps > 3000)?.interface_name || 'Global'}</strong>, dan MAC address flapping.
                        </p>
                        <button className="btn btn-danger btn-sm" onClick={() => setActiveTab('stp')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          Mitigasi Loop via STP <ArrowRight size={12} />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--success)', marginBottom: '8px' }}>
                          Tidak Ada Loop Terdeteksi
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
                          Spanning Tree mendeteksi struktur topologi stabil dan tidak ada badai broadcast (broadcast storms) aktif.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Broadcast & Multicast Storms */}
                  <div className="card" style={{ padding: '20px', borderLeft: scores.broadcast_risk > 50 ? '5px solid var(--danger)' : '5px solid var(--success)' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={18} className={scores.broadcast_risk > 50 ? 'text-danger' : 'text-success'} />
                      Broadcast & Multicast Storm
                    </h4>
                    {scores.broadcast_risk > 50 ? (
                      <div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--danger)' }}>
                          {portsData.find(p => p.broadcast_pps > 3000)?.broadcast_pps.toFixed(0) || '0'} pps
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '8px 0 12px 0', lineHeight: '1.45' }}>
                          Storm aktif terdeteksi pada interface <strong>{portsData.find(p => p.broadcast_pps > 3000)?.interface_name || '—'}</strong>. Hal ini memakan utilisasi CPU switch.
                        </p>
                        <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('ports')} style={{ color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                          Isolasi Trafik Port
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--success)', marginBottom: '8px' }}>
                          Laju PPS Broadcast Normal
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
                          Rata-rata laju broadcast di seluruh interface switch berada di bawah ambang batas (1000 pps).
                        </p>
                      </div>
                    )}
                  </div>

                </div>

                {/* Uplink Overview Table */}
                <div className="card" style={{ padding: '20px' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Network size={16} className="text-primary" />
                    Uplink Switch Interfaces
                  </h4>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ paddingBottom: '8px' }}>Interface</th>
                        <th style={{ paddingBottom: '8px' }}>Uplink Type</th>
                        <th style={{ paddingBottom: '8px' }}>Connected Switch</th>
                        <th style={{ paddingBottom: '8px' }}>Bandwidth</th>
                        <th style={{ paddingBottom: '8px' }}>Utilization</th>
                        <th style={{ paddingBottom: '8px' }}>Redundancy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portsData.filter(p => p.is_uplink === 1).map(u => (
                        <tr key={u.interface_name} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 0', fontWeight: 700 }}>{cleanInterfaceName(u.interface_name)}</td>
                          <td>{u.uplink_type}</td>
                          <td>{u.uplink_switch}</td>
                          <td>{(u.uplink_bandwidth / 1000000000).toFixed(0)} Gbps</td>
                          <td style={{ color: u.uplink_utilization > 70 ? 'var(--danger)' : 'var(--text-primary)' }}>
                            {u.uplink_utilization.toFixed(2)}%
                          </td>
                          <td>
                            <span className="badge badge-online" style={{ fontSize: '9px', padding: '1px 6px' }}>{u.uplink_redundancy}</span>
                          </td>
                        </tr>
                      ))}
                      {portsData.filter(p => p.is_uplink === 1).length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            Tidak ada port uplink teridentifikasi (Cek tetangga LLDP/CDP).
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

              </div>

              {/* Right Column: AI Recommendations sidebar */}
              <div className="card" style={{ padding: '20px', background: theme === 'light' ? '#f8fafc' : '#111722', height: 'max-content' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Zap size={16} className="text-warning" />
                  AI Troubleshoot Checklist
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {aiRecommendations.map(rec => (
                    <div 
                      key={rec.id} 
                      style={{ 
                        background: 'var(--bg-card)', 
                        padding: '12px', 
                        borderRadius: '6px', 
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-sm)'
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)' }}>
                        {rec.title}
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                        {rec.desc}
                      </p>
                      {rec.tab !== 'overview' && (
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ marginTop: '8px', padding: '2px 8px', fontSize: '10px', color: 'var(--primary)' }}
                          onClick={() => setActiveTab(rec.tab)}
                        >
                          {rec.action} <ArrowRight size={10} style={{ marginLeft: '4px' }} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* TAB CONTENT: PORT DIAGNOSTICS */}
          {activeTab === 'ports' && (
            <div>
              {/* Port Table Filters */}
              <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="search-box" style={{ width: '260px' }}>
                    <Search className="search-icon" />
                    <input
                      placeholder="Cari port, VLAN, tetangga..."
                      value={portSearch}
                      onChange={e => setPortSearch(e.target.value)}
                    />
                  </div>
                  
                  <div className="flex-center gap-8">
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
                    <select className="form-control" style={{ padding: '4px 8px', fontSize: '12px', width: '100px' }} value={portStatusFilter} onChange={e => setPortStatusFilter(e.target.value)}>
                      <option value="all">Semua</option>
                      <option value="up">Link Up</option>
                      <option value="down">Link Down</option>
                    </select>
                  </div>

                  <div className="flex-center gap-8">
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tipe:</span>
                    <select className="form-control" style={{ padding: '4px 8px', fontSize: '12px', width: '120px' }} value={portTypeFilter} onChange={e => setPortTypeFilter(e.target.value)}>
                      <option value="all">Semua</option>
                      <option value="access">Access</option>
                      <option value="trunk">Trunk</option>
                    </select>
                  </div>

                  <div className="flex-center gap-8">
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Medium:</span>
                    <select className="form-control" style={{ padding: '4px 8px', fontSize: '12px', width: '120px' }} value={portSfpFilter} onChange={e => setPortSfpFilter(e.target.value)}>
                      <option value="all">Semua</option>
                      <option value="sfp">Fiber (SFP)</option>
                      <option value="copper">Tembaga (RJ45)</option>
                    </select>
                  </div>

                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Menampilkan <strong>{filteredPorts.length}</strong> port
                  </span>
                </div>
              </div>

              {/* Ports Grid / Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px' }}>Interface Name</th>
                      <th>Status</th>
                      <th>Speed / Duplex</th>
                      <th>VLAN Allocation</th>
                      <th>Error Stats</th>
                      <th>Laju PPS</th>
                      <th>Neighbor Details</th>
                      <th>SFP Health</th>
                      <th>Action Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPorts.map(p => {
                      const isUp = p.oper_status === 'up'
                      const hasSfp = p.sfp_vendor !== ''
                      return (
                        <tr 
                          key={p.interface_name} 
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => setSelectedPort(p)}
                          className="row-hover"
                        >
                          <td style={{ padding: '12px 16px', fontWeight: 700 }}>{cleanInterfaceName(p.interface_name)}</td>
                          <td>
                            <span className={`badge badge-${isUp ? 'online' : 'offline'}`} style={{ fontSize: '9.5px', padding: '1px 6px' }}>
                              {p.oper_status.toUpperCase()}
                            </span>
                          </td>
                          <td>{p.speed} / {p.duplex}</td>
                          <td>
                            {p.port_type === 'Trunk' ? (
                              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Trunk</span>
                            ) : (
                              <span>VLAN {p.vlan}</span>
                            )}
                          </td>
                          <td style={{ color: p.crc_errors > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                            CRC: {p.crc_errors} | Drops: {p.drops}
                          </td>
                          <td className="mono" style={{ fontSize: '11px' }}>
                            B: {p.broadcast_pps.toFixed(0)} | M: {p.multicast_pps.toFixed(0)}
                          </td>
                          <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.connected_device}
                          </td>
                          <td>
                            {hasSfp ? (
                              <span 
                                className={`badge badge-${p.sfp_health === 'Healthy' ? 'online' : 'offline'}`} 
                                style={{ fontSize: '9.5px', padding: '1px 6px' }}
                              >
                                {p.sfp_health}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>RJ45</span>
                            )}
                          </td>
                          <td>
                            {p.recommendation_action !== '—' ? (
                              <span 
                                style={{ 
                                  fontSize: '10px', 
                                  fontWeight: 700, 
                                  color: p.recommendation_code === 'check_loop' || p.recommendation_code === 'replace_sfp' ? 'var(--danger)' : 'var(--warning)',
                                  background: p.recommendation_code === 'check_loop' || p.recommendation_code === 'replace_sfp' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                  padding: '2px 6px',
                                  borderRadius: '3px'
                                }}
                              >
                                {p.recommendation_action}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--success)' }}>Healthy</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* TAB CONTENT: STP (SPANNING TREE) */}
          {activeTab === 'stp' && stpData && (
            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>
              
              {/* Left Box: Global bridge stats */}
              <div className="card animate-slide" style={{ padding: '20px', height: 'max-content' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={16} className="text-primary" />
                  STP Bridge Information
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Mode STP:</span>
                    <div style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary)' }}>
                      {stpData.bridge?.stp_mode}
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Root Bridge ID:</span>
                    <div className="mono" style={{ fontWeight: 700, fontSize: '12px' }}>
                      {stpData.bridge?.root_bridge_id}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Root Bridge Priority:</span>
                    <div style={{ fontWeight: 600 }}>{stpData.bridge?.root_bridge_priority}</div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Lokal Bridge ID:</span>
                    <div className="mono" style={{ fontWeight: 700, fontSize: '12px' }}>
                      {stpData.bridge?.bridge_id}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Lokal Bridge Priority:</span>
                    <div style={{ fontWeight: 600 }}>{stpData.bridge?.bridge_priority}</div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Root Path Cost / Port:</span>
                    <div style={{ fontWeight: 600 }}>
                      Cost: {stpData.bridge?.root_path_cost} | Port: {stpData.bridge?.root_port}
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Topology Change Counter:</span>
                    <div className="mono" style={{ fontWeight: 800, color: 'var(--warning)', fontSize: '15px' }}>
                      {stpData.bridge?.topology_change_count}
                    </div>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      Terakhir: {stpData.bridge?.last_topology_change ? new Date(stpData.bridge.last_topology_change).toLocaleString('id-ID') : 'Never'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Box: STP Ports Role and states */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="p-20" style={{ borderBottom: '1px solid var(--border)' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Daftar Port Spanning Tree (STP)</h4>
                </div>
                
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '10px 16px' }}>Interface Name</th>
                      <th>Port Role</th>
                      <th>Port State</th>
                      <th>Path Cost</th>
                      <th>Port Priority</th>
                      <th>BPDU Guard</th>
                      <th>Loop Guard</th>
                      <th>Root Guard</th>
                      <th>PortFast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stpData.ports?.map(sp => {
                      const isBlocking = sp.port_state === 'Blocking'
                      const isRoot = sp.port_role === 'Root'
                      
                      return (
                        <tr key={sp.interface_name} style={{ borderBottom: '1px solid var(--border)' }} className="row-hover">
                          <td style={{ padding: '10px 16px', fontWeight: 700 }}>{cleanInterfaceName(sp.interface_name)}</td>
                          <td style={{ fontWeight: 700, color: isRoot ? '#a855f7' : '' }}>
                            {sp.port_role}
                          </td>
                          <td>
                            <span 
                              className={`badge badge-${isBlocking ? 'offline' : 'online'}`} 
                              style={{ 
                                fontSize: '9.5px', 
                                padding: '1px 6px',
                                background: isBlocking ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                color: isBlocking ? 'var(--danger)' : 'var(--success)'
                              }}
                            >
                              {sp.port_state.toUpperCase()}
                            </span>
                          </td>
                          <td>{sp.cost}</td>
                          <td>{sp.priority}</td>
                          <td style={{ color: sp.bpdu_guard === 'Enabled' ? 'var(--success)' : 'var(--text-muted)' }}>
                            {sp.bpdu_guard}
                          </td>
                          <td style={{ color: sp.loop_guard === 'Enabled' ? 'var(--success)' : 'var(--text-muted)' }}>
                            {sp.loop_guard}
                          </td>
                          <td style={{ color: sp.root_guard === 'Enabled' ? 'var(--success)' : 'var(--text-muted)' }}>
                            {sp.root_guard}
                          </td>
                          <td style={{ color: sp.portfast === 'Enabled' ? 'var(--success)' : 'var(--text-muted)' }}>
                            {sp.portfast}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}

          {/* TAB CONTENT: VLAN & TRUNK */}
          {activeTab === 'vlan' && vlanData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Native VLAN Mismatch Warnings */}
              {vlanData.mismatches?.length > 0 && (
                <div 
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '16px',
                    color: 'var(--danger)',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'start'
                  }}
                >
                  <AlertOctagon size={20} style={{ marginTop: '2px' }} />
                  <div>
                    <h5 style={{ margin: 0, fontWeight: 700, fontSize: '13.5px' }}>Kritis: Deteksi Native VLAN Mismatch</h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {vlanData.mismatches.map((m, idx) => (
                        <div key={idx} style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                          • Interface <strong>{m.interface}</strong>: {m.details}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* VLAN Table and Pruning suggestions */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px' }}>
                
                {/* Active VLAN database */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="p-20" style={{ borderBottom: '1px solid var(--border)' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>VLAN Database Cache</h4>
                  </div>
                  
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 16px' }}>VLAN ID</th>
                        <th>VLAN Name</th>
                        <th>Status</th>
                        <th>Member Interfaces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vlanData.vlans?.map(vl => (
                        <tr key={vl.vlan_id} style={{ borderBottom: '1px solid var(--border)' }} className="row-hover">
                          <td style={{ padding: '10px 16px', fontWeight: 700 }}>VLAN {vl.vlan_id}</td>
                          <td>{vl.name}</td>
                          <td>
                            <span className="badge badge-online" style={{ fontSize: '9px', padding: '1px 5px' }}>
                              {vl.status}
                            </span>
                          </td>
                          <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {portsData
                              .filter(p => p.vlan === String(vl.vlan_id) || (p.port_type === 'Trunk' && p.allowed_vlans?.includes(String(vl.vlan_id))))
                              .map(p => cleanInterfaceName(p.interface_name))
                              .join(', ') || 'None'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pruning Recommendations */}
                <div className="card" style={{ padding: '20px', height: 'max-content' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sliders size={16} className="text-warning" />
                    Rekomendasi VLAN Pruning
                  </h4>
                  
                  {vlanData.pruning_recommendations?.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {vlanData.pruning_recommendations.map((pr, idx) => (
                        <div key={idx} style={{ background: 'var(--bg-base)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--primary)' }}>Interface {pr.interface}</span>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                            {pr.recommendation}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center', padding: '16px' }}>
                      Allowed VLAN list sudah optimal di seluruh trunk port.
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}

          {/* TAB CONTENT: MAC ADDRESS */}
          {activeTab === 'mac' && macData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Duplicate MAC Warning */}
              {macData.duplicates?.length > 0 && (
                <div 
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1.5px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '16px',
                    color: 'var(--danger)',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'start'
                  }}
                >
                  <AlertOctagon size={20} style={{ marginTop: '2px' }} />
                  <div>
                    <h5 style={{ margin: 0, fontWeight: 700, fontSize: '13.5px' }}>Peringatan: MAC Address Flapping / Bergerak</h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {macData.duplicates.map((d, idx) => (
                        <div key={idx} style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                          • MAC Address <strong>{d.mac_address}</strong> terdeteksi duplikat/flapping antara interface <strong>{d.port_1}</strong> dan <strong>{d.port_2}</strong> (VLAN {d.vlan}).
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* MAC Controls Panel */}
              <div className="card flex-between" style={{ padding: '12px 20px', flexDirection: 'row', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="flex-center" style={{ gap: '8px', flex: 1, minWidth: '240px' }}>
                  <Search size={16} className="text-muted" />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Cari MAC Address, Port, VLAN, OUI Vendor..."
                    value={macSearch}
                    onChange={e => setMacSearch(e.target.value)}
                    style={{ width: '100%', height: '36px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                </div>
                
                <div className="flex-center" style={{ gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tampilkan:</span>
                  <select
                    className="form-control"
                    value={macPageSize}
                    onChange={e => setMacPageSize(Number(e.target.value))}
                    style={{ height: '36px', minWidth: '80px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', background: 'var(--bg-card)', padding: '0 6px', color: 'var(--text-primary)' }}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                </div>
              </div>

              {/* MAC Address Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="p-20" style={{ borderBottom: '1px solid var(--border)' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Tabel MAC Address Switch ({filteredMacs.length} entri)</h4>
                </div>
                
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px' }}>MAC Address</th>
                      <th>Interface Port</th>
                      <th>VLAN</th>
                      <th>Type</th>
                      <th>OUI Vendor</th>
                      <th>First Seen</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedMacs.map((m, idx) => {
                      const isFlapping = macData.duplicates?.some(d => d.mac_address === m.mac_address)
                      return (
                        <tr 
                          key={idx} 
                          style={{ 
                            borderBottom: '1px solid var(--border)',
                            background: isFlapping ? 'rgba(239, 68, 68, 0.04)' : '' 
                          }}
                          className="row-hover"
                        >
                          <td style={{ padding: '10px 16px', fontWeight: 700, color: isFlapping ? 'var(--danger)' : 'var(--text-primary)' }} className="mono">
                            {m.mac_address}
                          </td>
                          <td style={{ fontWeight: 700 }}>{cleanInterfaceName(m.interface_name)}</td>
                          <td>VLAN {m.vlan}</td>
                          <td>
                            <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 5px' }}>
                              {m.entry_type}
                            </span>
                          </td>
                          <td>{m.mac_vendor}</td>
                          <td>{new Date(m.first_seen).toLocaleString('id-ID')}</td>
                          <td>{new Date(m.last_seen).toLocaleString('id-ID')}</td>
                        </tr>
                      )
                    })}
                    {filteredMacs.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Tidak ada data MAC Address yang cocok.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {totalMacPages > 1 && (
                  <div className="flex-between" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-hover)' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Menampilkan <strong>{Math.min(filteredMacs.length, (macCurrentPage - 1) * macPageSize + 1)}-{Math.min(filteredMacs.length, macCurrentPage * macPageSize)}</strong> dari <strong>{filteredMacs.length}</strong> entri
                    </div>
                    <div className="flex-center" style={{ gap: '8px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setMacCurrentPage(p => Math.max(1, p - 1))}
                        disabled={macCurrentPage === 1}
                        style={{ padding: '4px 10px', fontSize: '12px', height: '30px' }}
                      >
                        Sebelumnya
                      </button>
                      <span style={{ fontSize: '12.5px', fontWeight: 600, padding: '0 8px' }}>
                        Halaman {macCurrentPage} dari {totalMacPages}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setMacCurrentPage(p => Math.min(totalMacPages, p + 1))}
                        disabled={macCurrentPage === totalMacPages}
                        style={{ padding: '4px 10px', fontSize: '12px', height: '30px' }}
                      >
                        Selanjutnya
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB CONTENT: TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="card" style={{ padding: '20px' }}>
              <h4 style={{ margin: '0 0 20px 0', fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={16} className="text-primary" />
                Layer 2 Historical Timeline Events
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', paddingLeft: '20px', borderLeft: '2px solid var(--border)' }}>
                {timelineData.map(ev => {
                  const isCritical = ev.severity === 'critical'
                  const isWarning = ev.severity === 'warning'
                  return (
                    <div key={ev.id} style={{ position: 'relative' }}>
                      {/* Timeline dot */}
                      <span 
                        style={{
                          position: 'absolute',
                          left: '-27px',
                          top: '2px',
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--primary)',
                          border: '2.5px solid var(--bg-card)'
                        }}
                      />
                      
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        {new Date(ev.timestamp).toLocaleString('id-ID')} | Port: {cleanInterfaceName(ev.interface_name)}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: isCritical ? 'var(--danger)' : 'var(--text-primary)' }}>
                        {ev.event_type.replace('_', ' ').toUpperCase()}
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        {ev.details}
                      </p>
                    </div>
                  )}
                )}
                {timelineData.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Belum ada rekaman L2 events dalam database.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: PORT LIFECYCLE ANALYSIS */}
          {activeTab === 'lifecycle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Lifecycle KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                <div className="card text-center" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Active Ports</div>
                  <div className="mono text-success" style={{ fontSize: '28px', fontWeight: 800, margin: '6px 0' }}>
                    {lifecycleData.filter(i => i.classification === 'Active').length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Currently transmitting traffic</div>
                </div>
                
                <div className="card text-center" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Never Used</div>
                  <div className="mono text-warning" style={{ fontSize: '28px', fontWeight: 800, margin: '6px 0' }}>
                    {lifecycleData.filter(i => i.classification === 'Never Used').length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No link up detected yet</div>
                </div>
                
                <div className="card text-center" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Inactive &gt;30 Days</div>
                  <div className="mono text-primary" style={{ fontSize: '28px', fontWeight: 800, margin: '6px 0' }}>
                    {lifecycleData.filter(i => i.classification.startsWith('Inactive >')).length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Candidates for reclamation</div>
                </div>

                <div className="card text-center" style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Safe to Disable</div>
                  <div className="mono text-danger" style={{ fontSize: '28px', fontWeight: 800, margin: '6px 0' }}>
                    {portsData.filter(p => p.recommendation_action === 'Safe to Disable').length}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Recommended secure action</div>
                </div>
              </div>

              {/* Lifecycle filters */}
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="search-box" style={{ width: '280px' }}>
                    <Search className="search-icon" />
                    <input
                      placeholder="Cari port, klasifikasi..."
                      value={lifecycleSearch}
                      onChange={e => setLifecycleSearch(e.target.value)}
                    />
                  </div>
                  
                  <div className="flex-center gap-8">
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Klasifikasi & Rekomendasi:</span>
                    <select 
                      className="form-control" 
                      style={{ padding: '4px 8px', fontSize: '12px', width: '220px' }} 
                      value={lifecycleClassFilter} 
                      onChange={e => setLifecycleClassFilter(e.target.value)}
                    >
                      <option value="all">Semua Klasifikasi</option>
                      <option value="Active">Active</option>
                      <option value="Unused">Unused</option>
                      <option value="Never Used">Never Used</option>
                      <option value="Inactive >30 Days">Inactive &gt;30 Days</option>
                      <option value="Inactive >60 Days">Inactive &gt;60 Days</option>
                      <option value="Inactive >90 Days">Inactive &gt;90 Days</option>
                      <option value="Candidate for Reuse">Rekomendasi: Candidate for Reuse</option>
                      <option value="Safe to Disable">Rekomendasi: Safe to Disable</option>
                    </select>
                  </div>

                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Menampilkan <strong>{filteredLifecycle.length}</strong> port lifecycle
                  </span>
                </div>
              </div>

              {/* Lifecycle Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px' }}>Interface Name</th>
                      <th>Classification</th>
                      <th>Last Link Up / Down</th>
                      <th>Active Time</th>
                      <th>Inactive Time</th>
                      <th>Link Events</th>
                      <th>Util (Avg / Peak)</th>
                      <th>MACs</th>
                      <th>Neighbors</th>
                      <th>VLANs</th>
                      <th>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLifecycle.map(item => {
                      const p = portsData.find(port => port.interface_name === item.interface_name) || {}
                      
                      let badgeClass = 'badge-online'
                      if (item.classification === 'Never Used') badgeClass = 'badge-offline'
                      else if (item.classification.startsWith('Inactive >')) badgeClass = 'badge-offline'
                      else if (item.classification === 'Unused') badgeClass = 'badge-info'
                      
                      const showMacHistory = () => {
                        toast.info(`MAC History untuk ${item.interface_name}: ${item.mac_history.length > 0 ? item.mac_history.join(', ') : 'Tidak ada riwayat MAC'}`)
                      }
                      
                      const showNeighborHistory = () => {
                        toast.info(`Neighbor History untuk ${item.interface_name}: ${item.neighbor_history.length > 0 ? item.neighbor_history.join(', ') : 'Tidak ada riwayat neighbor'}`)
                      }

                      const showVlanHistory = () => {
                        toast.info(`VLAN History untuk ${item.interface_name}: ${item.vlan_history.length > 0 ? 'VLAN ' + item.vlan_history.join(', ') : 'Tidak ada riwayat VLAN'}`)
                      }

                      return (
                        <tr 
                          key={item.interface_name} 
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => setSelectedPort(p)}
                          className="row-hover"
                        >
                          <td style={{ padding: '12px 16px', fontWeight: 700 }}>{cleanInterfaceName(item.interface_name)}</td>
                          <td>
                            <span className={`badge ${badgeClass}`} style={{ fontSize: '9.5px', padding: '1px 6px' }}>
                              {item.classification}
                            </span>
                          </td>
                          <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {item.last_link_up ? `Up: ${new Date(item.last_link_up).toLocaleDateString('id-ID')}` : 'Never Up'} <br/>
                            {item.last_link_down ? `Down: ${new Date(item.last_link_down).toLocaleDateString('id-ID')}` : 'Never Down'}
                          </td>
                          <td>{formatTimeInterval(item.total_active_time)}</td>
                          <td>{formatTimeInterval(item.total_inactive_time)}</td>
                          <td style={{ textAlign: 'center' }}>{item.link_event_count}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="mono" style={{ fontSize: '11px' }}>{item.avg_utilization}% / {item.peak_utilization}%</span>
                            </div>
                          </td>
                          <td>
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ padding: '2px 6px', fontSize: '10.5px', height: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); showMacHistory(); }}
                            >
                              {item.mac_history?.length || 0}
                            </button>
                          </td>
                          <td>
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ padding: '2px 6px', fontSize: '10.5px', height: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); showNeighborHistory(); }}
                            >
                              {item.neighbor_history?.length || 0}
                            </button>
                          </td>
                          <td>
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ padding: '2px 6px', fontSize: '10.5px', height: 'auto' }}
                              onClick={(e) => { e.stopPropagation(); showVlanHistory(); }}
                            >
                              {item.vlan_history?.length || 0}
                            </button>
                          </td>
                          <td>
                            {p.recommendation_action && p.recommendation_action !== '—' ? (
                              <span 
                                style={{ 
                                  fontSize: '10px', 
                                  fontWeight: 700, 
                                  color: p.recommendation_action === 'Safe to Disable' ? 'var(--danger)' : 'var(--warning)',
                                  background: p.recommendation_action === 'Safe to Disable' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                  padding: '2px 6px',
                                  borderRadius: '3px'
                                }}
                              >
                                {p.recommendation_action}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--success)' }}>Active / Normal</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {filteredLifecycle.length === 0 && (
                      <tr>
                        <td colSpan={11} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          Tidak ada port matching. Lakukan live sync L2 untuk mengumpulkan data historis.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PORT DETAILS SIDEBAR MODAL (OVERLAY MODAL) */}
          {selectedPort && (
            <div 
              style={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: '420px',
                height: '100vh',
                background: theme === 'light' ? '#ffffff' : '#0e131f',
                borderLeft: '1px solid var(--border)',
                boxShadow: '-4px 0 16px rgba(0,0,0,0.15)',
                zIndex: 9999,
                padding: '24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
              }}
              className="animate-slide"
            >
              <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>
                  🔌 Port: {cleanInterfaceName(selectedPort.interface_name)}
                </h3>
                <button 
                  style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}
                  onClick={() => setSelectedPort(null)}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Status details */}
              <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Link & Admin Status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge badge-${selectedPort.oper_status === 'up' ? 'online' : 'offline'}`}>
                      LINK {selectedPort.oper_status.toUpperCase()}
                    </span>
                    <span className={`badge badge-${selectedPort.admin_status === 'up' ? 'online' : 'offline'}`}>
                      ADMIN {selectedPort.admin_status.toUpperCase()}
                    </span>
                    <span style={{ fontWeight: 700 }} className="text-primary">{selectedPort.port_type}</span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Physical Speeds</div>
                  <div>Speed: <strong>{selectedPort.speed}</strong> | Duplex: <strong>{selectedPort.duplex}</strong> | MTU: <strong>{selectedPort.mtu}</strong></div>
                </div>

                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>VLAN details</div>
                  {selectedPort.port_type === 'Trunk' ? (
                    <div>
                      <div>Native VLAN: <strong>{selectedPort.native_vlan || '1'}</strong></div>
                      <div>Allowed VLANs: <strong style={{ color: 'var(--primary)' }}>{selectedPort.allowed_vlans || '—'}</strong></div>
                    </div>
                  ) : (
                    <div>Access VLAN: <strong>{selectedPort.vlan}</strong> {selectedPort.voice_vlan && <span>| Voice VLAN: <strong>{selectedPort.voice_vlan}</strong></span>}</div>
                  )}
                </div>

                {portLifecycle && (
                  <div style={{ background: 'var(--bg-hover)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Port Lifecycle & History</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                      <div>Classification: <strong style={{ color: 'var(--primary)' }}>{portLifecycle.classification}</strong></div>
                      <div>First Seen: <strong>{new Date(portLifecycle.first_seen).toLocaleDateString('id-ID')}</strong></div>
                      <div>Total Active: <strong>{formatTimeInterval(portLifecycle.total_active_time)}</strong></div>
                      <div>Total Inactive: <strong>{formatTimeInterval(portLifecycle.total_inactive_time)}</strong></div>
                      <div>Link Events: <strong>{portLifecycle.link_event_count}</strong> up/down</div>
                      <div>Traffic Average: <strong>{portLifecycle.avg_utilization}%</strong> (Peak: <strong>{portLifecycle.peak_utilization}%</strong>)</div>
                      
                      {portLifecycle.mac_history && portLifecycle.mac_history.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>HISTORICAL MACs:</span>
                          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)', maxHeight: '60px', overflowY: 'auto' }}>
                            {portLifecycle.mac_history.join(', ')}
                          </div>
                        </div>
                      )}
                      
                      {portLifecycle.neighbor_history && portLifecycle.neighbor_history.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>HISTORICAL NEIGHBORS:</span>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', maxHeight: '60px', overflowY: 'auto' }}>
                            {portLifecycle.neighbor_history.join(', ')}
                          </div>
                        </div>
                      )}
                      
                      {portLifecycle.vlan_history && portLifecycle.vlan_history.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)' }}>HISTORICAL VLANs:</span>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            VLAN {portLifecycle.vlan_history.join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* SFP Optic Transceiver diagnostics */}
                {selectedPort.sfp_vendor && (
                  <div style={{ background: 'var(--bg-hover)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>SFP Optical Diagnostics</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                      <div>Vendor: <strong>{selectedPort.sfp_vendor}</strong></div>
                      <div>Model: <strong>{selectedPort.sfp_model}</strong></div>
                      <div>Serial: <strong>{selectedPort.sfp_serial}</strong></div>
                      <div style={{ color: selectedPort.sfp_health === 'Critical' ? 'var(--danger)' : '' }}>Health: <strong>{selectedPort.sfp_health}</strong></div>
                      <div>Suhu: <strong>{selectedPort.sfp_temp} °C</strong></div>
                      <div>Voltase: <strong>{selectedPort.sfp_voltage} V</strong></div>
                      <div style={{ color: selectedPort.sfp_rx_power < -10 ? 'var(--danger)' : '' }}>RX Power: <strong>{selectedPort.sfp_rx_power} dBm</strong></div>
                      <div>TX Power: <strong>{selectedPort.sfp_tx_power} dBm</strong></div>
                    </div>
                  </div>
                )}

                {/* PoE status */}
                {selectedPort.poe_status !== 'Disabled' && (
                  <div style={{ background: 'var(--bg-hover)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Power over Ethernet (PoE)</div>
                    <div>Status: <strong style={{ color: 'var(--success)' }}>{selectedPort.poe_status}</strong></div>
                    <div>Daya Terpakai: <strong>{selectedPort.poe_consumption} Watt</strong></div>
                  </div>
                )}

                {/* Traffic Details */}
                <div>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Trafik Laju Paket</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div style={{ background: 'var(--bg-hover)', padding: '6px', borderRadius: '4px', textAlign: 'center' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>BROADCAST</span>
                      <div className="mono" style={{ fontWeight: 700 }}>{selectedPort.broadcast_pps.toFixed(0)} pps</div>
                    </div>
                    <div style={{ background: 'var(--bg-hover)', padding: '6px', borderRadius: '4px', textAlign: 'center' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>MULTICAST</span>
                      <div className="mono" style={{ fontWeight: 700 }}>{selectedPort.multicast_pps.toFixed(0)} pps</div>
                    </div>
                    <div style={{ background: 'var(--bg-hover)', padding: '6px', borderRadius: '4px', textAlign: 'center' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>UNICAST</span>
                      <div className="mono" style={{ fontWeight: 700 }}>{selectedPort.unknown_unicast_pps.toFixed(0)} pps</div>
                    </div>
                  </div>
                </div>

                {/* Actions Recommendation */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', marginTop: '10px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Troubleshoot Recommendation</div>
                  {selectedPort.recommendation_action !== '—' ? (
                    <div 
                      style={{ 
                        padding: '12px', 
                        borderRadius: '6px', 
                        border: `1.5px solid ${selectedPort.recommendation_code === 'check_loop' || selectedPort.recommendation_code === 'replace_sfp' ? 'var(--danger)' : 'var(--warning)'}`,
                        background: selectedPort.recommendation_code === 'check_loop' || selectedPort.recommendation_code === 'replace_sfp' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)'
                      }}
                    >
                      <div style={{ fontWeight: 700, color: selectedPort.recommendation_code === 'check_loop' || selectedPort.recommendation_code === 'replace_sfp' ? 'var(--danger)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangle size={14} /> {selectedPort.recommendation_action}
                      </div>
                      <p style={{ marginTop: '6px', fontSize: '11.5px', lineHeight: '1.45', color: 'var(--text-primary)' }}>
                        {selectedPort.recommendation_text}
                      </p>
                    </div>
                  ) : (
                    <div style={{ padding: '8px 12px', background: 'var(--success-glow)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                      <CheckCircle size={14} /> Link berjalan dengan baik. Tidak perlu tindakan.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

const formatTimeInterval = (seconds) => {
  if (!seconds) return '0d 0h'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${seconds}s`
}
