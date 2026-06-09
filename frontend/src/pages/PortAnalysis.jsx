import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Layers, RefreshCw, AlertTriangle, CheckCircle, Info, ShieldAlert,
  Search, Power, HelpCircle, ArrowLeft, ChevronDown, Activity, Trash2, 
  ExternalLink, CheckSquare, Shield, Sliders, Play, AlertCircle
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
  
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  // Filtering & Search states
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all') // all | unused_30 | unused_90 | never_used | flapping | low_util | high_util
  const [activeRecFilter, setActiveRecFilter] = useState('all') // all | safe_to_disable | reassign | monitor | investigate
  const [selectedPort, setSelectedPort] = useState(null)

  // Fetch list of switches for global selector if not in device context
  useEffect(() => {
    if (!deviceId) {
      devicesApi.list()
        .then(res => {
          // Filter devices that support SNMP or are switches
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

  // Reload analysis when selected device changes
  useEffect(() => {
    const devId = deviceId || selectedDevice
    if (devId) {
      fetchPortAnalysis(devId)
      fetchDeviceInfo(devId)
    }
  }, [deviceId, selectedDevice])

  const fetchDeviceInfo = async (id) => {
    try {
      const res = await devicesApi.get(id)
      setDeviceInfo(res.data)
    } catch (_) {}
  }

  const fetchPortAnalysis = async (id) => {
    setLoading(true)
    try {
      const res = await devicesApi.getPortAnalysis(id)
      setAnalysis(res.data)
      setLastUpdated(new Date().toLocaleTimeString('id-ID'))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengambil analisis port perangkat.')
      setAnalysis(null)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    const devId = deviceId || selectedDevice
    if (devId) {
      fetchPortAnalysis(devId)
    }
  }

  // Filter ports based on search, activeCategory, and activeRecFilter
  const filteredPorts = useMemo(() => {
    if (!analysis || !analysis.ports) return []

    return analysis.ports.filter(port => {
      // 1. Search Query Match
      const q = search.toLowerCase()
      const matchesSearch = !q || 
        port.interface.toLowerCase().includes(q) || 
        cleanInterfaceName(port.interface).toLowerCase().includes(q) || 
        port.connected_device.toLowerCase().includes(q) || 
        port.vlan.toLowerCase().includes(q) || 
        port.recommendation_action.toLowerCase().includes(q) || 
        port.recommendation_text.toLowerCase().includes(q)

      // 2. Category Filter Match
      let matchesCategory = true
      const ifname = port.interface
      if (activeCategory === 'unused_30') {
        matchesCategory = analysis.categories.unused_30_days.includes(ifname)
      } else if (activeCategory === 'unused_90') {
        matchesCategory = analysis.categories.unused_90_days.includes(ifname)
      } else if (activeCategory === 'never_used') {
        matchesCategory = analysis.categories.never_used.includes(ifname)
      } else if (activeCategory === 'flapping') {
        matchesCategory = analysis.categories.flapping.includes(ifname)
      } else if (activeCategory === 'low_util') {
        matchesCategory = analysis.categories.low_utilization.includes(ifname)
      } else if (activeCategory === 'high_util') {
        matchesCategory = analysis.categories.high_utilization.includes(ifname)
      }

      // 3. Recommendation Filter Match
      let matchesRec = true
      if (activeRecFilter === 'safe_to_disable') {
        matchesRec = port.recommendation_code === 'safe_to_disable'
      } else if (activeRecFilter === 'reassign') {
        matchesRec = port.recommendation_code === 'reassign'
      } else if (activeRecFilter === 'monitor') {
        matchesRec = port.recommendation_code === 'monitor'
      } else if (activeRecFilter === 'investigate') {
        matchesRec = port.recommendation_code === 'investigate'
      }

      return matchesSearch && matchesCategory && matchesRec
    })
  }, [analysis, search, activeCategory, activeRecFilter])

  // Get indicator badge styling
  const getIndicatorColor = (color) => {
    switch (color) {
      case 'green': return { bg: 'var(--success-glow)', text: 'var(--success)', shadow: '0 0 8px var(--success)' }
      case 'yellow': return { bg: 'var(--warning-glow)', text: 'var(--warning)', shadow: 'none' }
      case 'orange': return { bg: 'rgba(249, 115, 22, 0.15)', text: '#f97316', shadow: 'none' }
      case 'red': return { bg: 'var(--danger-glow)', text: 'var(--danger)', shadow: '0 0 8px var(--danger)' }
      default: return { bg: 'var(--bg-hover)', text: 'var(--text-muted)', shadow: 'none' }
    }
  }

  // Helper for rendering summary counts
  const summary = analysis?.summary || {
    total_ports: 0,
    active_ports: 0,
    inactive_ports: 0,
    never_used_ports: 0,
    flapping_ports: 0
  }

  const handleDeviceChange = (e) => {
    setSelectedDevice(e.target.value)
    setActiveCategory('all')
    setActiveRecFilter('all')
    setSelectedPort(null)
  }

  const handleRecCardClick = (recCode) => {
    if (activeRecFilter === recCode) {
      setActiveRecFilter('all') // Toggle off
    } else {
      setActiveRecFilter(recCode)
      setActiveCategory('all') // Reset category filter to prevent conflicts
    }
  }

  const handleCatTabClick = (catCode) => {
    if (activeCategory === catCode) {
      setActiveCategory('all') // Toggle off
    } else {
      setActiveCategory(catCode)
      setActiveRecFilter('all') // Reset recommendation filter to prevent conflicts
    }
  }

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
                Analisis Utilisasi Port Switch
              </div>
              <div className="page-subtitle">
                Mengidentifikasi port yang tidak digunakan, flapping, atau memiliki utilitas abnormal untuk pembersihan kapasitas.
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
              
              <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={loading || !selectedDevice}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
                Refresh Analisis
              </button>
            </div>
          </div>
        </div>
      )}

      {propDeviceId && (
        <div className="flex-between mb-16" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
          <div>
            <h4 style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} className="text-primary" /> Port Utilization Analysis
            </h4>
            <p className="text-muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>
              Analisis siklus hidup port switch untuk optimasi pemakaian port kosong perangkat.
            </p>
          </div>
          <div className="flex-center gap-12">
            {lastUpdated && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Terakhir Diperbarui: {lastUpdated}
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              Segarkan Analisis
            </button>
          </div>
        </div>
      )}

      {loading && !analysis ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px', gap: '16px' }}>
          <div className="loading-spinner" style={{ width: 36, height: 36 }} />
          <span style={{ fontSize: '13.5px', color: 'var(--text-muted)' }}>Menghitung metrik & riwayat pemakaian port switch...</span>
        </div>
      ) : !analysis ? (
        <div className="empty-state" style={{ padding: '64px', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
          <Info size={32} className="text-muted" style={{ marginBottom: '12px' }} />
          <div className="empty-title">Tidak Ada Data Analisis</div>
          <div className="empty-desc">
            {!selectedDevice && !deviceId ? 'Silakan pilih perangkat switch terlebih dahulu di atas.' : 'Gagal memuat data. Silakan lakukan pemindaian SNMP perangkat atau pastikan SNMP berfungsi.'}
          </div>
        </div>
      ) : (
        <div className="animate-slide">
          {/* Hardware Port Count Mismatch Warning Banner */}
          {analysis.hardware_validation && analysis.hardware_validation.status === 'mismatch' && (
            <div 
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                color: 'var(--danger)'
              }}
            >
              <AlertTriangle size={20} />
              <div>
                <strong style={{ fontSize: '13.5px' }}>Verifikasi Hardware Model Mismatch:</strong>
                <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: 'var(--text-primary)' }}>
                  {analysis.hardware_validation.message}
                </p>
              </div>
            </div>
          )}

          {/* 2. Metrics Widgets Grid */}
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <div className="stat-card purple" style={{ padding: '14px 16px' }}>
              <div className="stat-label" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔌 Total Port
              </div>
              <div className="stat-value" style={{ fontSize: '26px' }}>{summary.total_ports}</div>
              <div className="stat-sub" style={{ fontSize: '10px' }}>Total port fisik switch</div>
            </div>
            
            <div className="stat-card green" style={{ padding: '14px 16px' }}>
              <div className="stat-label" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🟢 Port Aktif
              </div>
              <div className="stat-value" style={{ fontSize: '26px', color: 'var(--success)' }}>{summary.active_ports}</div>
              <div className="stat-sub" style={{ fontSize: '10px' }}>Status Link UP</div>
            </div>

            <div className="stat-card amber" style={{ padding: '14px 16px' }}>
              <div className="stat-label" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🟠 Port Inaktif
              </div>
              <div className="stat-value" style={{ fontSize: '26px', color: 'var(--warning)' }}>{summary.inactive_ports}</div>
              <div className="stat-sub" style={{ fontSize: '10px' }}>Status Link DOWN</div>
            </div>

            <div className="stat-card red" style={{ padding: '14px 16px' }}>
              <div className="stat-label" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔴 Never Used
              </div>
              <div className="stat-value" style={{ fontSize: '26px', color: 'var(--danger)' }}>{summary.never_used_ports}</div>
              <div className="stat-sub" style={{ fontSize: '10px' }}>Belum pernah Link UP</div>
            </div>

            <div className="stat-card cyan" style={{ padding: '14px 16px' }}>
              <div className="stat-label" style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚡ Flapping Port
              </div>
              <div className="stat-value" style={{ fontSize: '26px', color: 'var(--accent)' }}>{summary.flapping_ports}</div>
              <div className="stat-sub" style={{ fontSize: '10px' }}>Fluktuasi status aktif</div>
            </div>
          </div>

          {/* 3. Recommendations & Recommendations Filter Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
            {/* Safe to disable */}
            <div 
              onClick={() => handleRecCardClick('safe_to_disable')}
              style={{
                cursor: 'pointer',
                background: 'var(--bg-card)',
                border: activeRecFilter === 'safe_to_disable' ? '1.5px solid var(--danger)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                transition: 'all 0.2s',
                boxShadow: activeRecFilter === 'safe_to_disable' ? 'var(--shadow)' : 'none',
                transform: activeRecFilter === 'safe_to_disable' ? 'translateY(-2px)' : 'none'
              }}
              className="card-hover-highlight"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                <Power size={14} /> Aman untuk Dimatikan
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '20px', fontWeight: 800 }}>{analysis.recommendations.safe_to_disable.length}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>port</span>
              </div>
              <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                Port DOWN &gt; 90 hari / Never Used dengan admin status UP. Rekomendasi dinonaktifkan demi keamanan.
              </p>
            </div>

            {/* Candidate for reassignment */}
            <div 
              onClick={() => handleRecCardClick('reassign')}
              style={{
                cursor: 'pointer',
                background: 'var(--bg-card)',
                border: activeRecFilter === 'reassign' ? '1.5px solid var(--warning)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                transition: 'all 0.2s',
                boxShadow: activeRecFilter === 'reassign' ? 'var(--shadow)' : 'none',
                transform: activeRecFilter === 'reassign' ? 'translateY(-2px)' : 'none'
              }}
              className="card-hover-highlight"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                <CheckCircle size={14} /> Kandidat Realokasi
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '20px', fontWeight: 800 }}>{analysis.recommendations.candidate_for_reassignment.length}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>port</span>
              </div>
              <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                Port DOWN &gt; 30 hari (kurang dari 90 hari). Bebas dialokasikan kembali untuk perangkat client lain.
              </p>
            </div>

            {/* Monitor closely */}
            <div 
              onClick={() => handleRecCardClick('monitor')}
              style={{
                cursor: 'pointer',
                background: 'var(--bg-card)',
                border: activeRecFilter === 'monitor' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                transition: 'all 0.2s',
                boxShadow: activeRecFilter === 'monitor' ? 'var(--shadow)' : 'none',
                transform: activeRecFilter === 'monitor' ? 'translateY(-2px)' : 'none'
              }}
              className="card-hover-highlight"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                <Activity size={14} /> Monitor Ketat
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '20px', fontWeight: 800 }}>{analysis.recommendations.monitor_closely.length}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>port</span>
              </div>
              <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                Port yang terindikasi flapping (status tidak stabil) atau memiliki beban bandwidth tinggi (utilisasi &gt;= 70%).
              </p>
            </div>

            {/* Investigate behavior */}
            <div 
              onClick={() => handleRecCardClick('investigate')}
              style={{
                cursor: 'pointer',
                background: 'var(--bg-card)',
                border: activeRecFilter === 'investigate' ? '1.5px solid var(--danger)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                transition: 'all 0.2s',
                boxShadow: activeRecFilter === 'investigate' ? 'var(--shadow)' : 'none',
                transform: activeRecFilter === 'investigate' ? 'translateY(-2px)' : 'none'
              }}
              className="card-hover-highlight"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
                <ShieldAlert size={14} /> Investigasi Anomali
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ fontSize: '20px', fontWeight: 800 }}>{analysis.recommendations.investigate.length}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>port</span>
              </div>
              <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                Port UP dengan indikator kesehatan buruk, error fisik tinggi (CRC), atau duplex mismatch.
              </p>
            </div>
          </div>

          {/* 4. Category Filter Buttons */}
          <div className="refresh-intervals" style={{ margin: '0 0 16px 0', flexWrap: 'wrap', gap: '8px', height: 'auto', padding: '4px', display: 'flex' }}>
            <button
              className={`refresh-btn-option ${activeCategory === 'all' && activeRecFilter === 'all' ? 'active' : ''}`}
              onClick={() => { setActiveCategory('all'); setActiveRecFilter('all') }}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Semua Port ({analysis.ports.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'unused_30' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('unused_30')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Inaktif &gt; 30 Hari ({analysis.categories.unused_30_days.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'unused_90' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('unused_90')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Inaktif &gt; 90 Hari ({analysis.categories.unused_90_days.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'never_used' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('never_used')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Never Used ({analysis.categories.never_used.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'flapping' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('flapping')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Flapping ({analysis.categories.flapping.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'low_util' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('low_util')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              Low-utilization ({analysis.categories.low_utilization.length})
            </button>
            <button
              className={`refresh-btn-option ${activeCategory === 'high_util' ? 'active' : ''}`}
              onClick={() => handleCatTabClick('high_util')}
              style={{ padding: '6px 12px', fontSize: '11.5px' }}
            >
              High-utilization ({analysis.categories.high_utilization.length})
            </button>
          </div>

          {/* 5. Main Content Grid - Table & Sidebar Detail Panel */}
          <div style={{ display: 'grid', gridTemplateColumns: selectedPort ? '1fr 340px' : '1fr', gap: '20px', alignItems: 'start' }}>
            
            {/* Table Card */}
            <div className="card" style={{ padding: '0px', overflow: 'hidden' }}>
              <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div className="search-box" style={{ width: '300px' }}>
                  <Search className="search-icon" />
                  <input
                    placeholder="Cari interface, VLAN, host, aksi..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Menampilkan <strong>{filteredPorts.length}</strong> dari {analysis.ports.length} port
                  {(activeCategory !== 'all' || activeRecFilter !== 'all') && (
                    <span 
                      style={{ marginLeft: '8px', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => { setActiveCategory('all'); setActiveRecFilter('all') }}
                    >
                      (Clear Filter)
                    </span>
                  )}
                </span>
              </div>

              {filteredPorts.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  Tidak ada port ditemukan yang cocok dengan kriteria filter.
                </div>
              ) : (
                <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: '20px', width: '22%' }}>Interface & Indikator</th>
                        <th style={{ width: '12%' }}>Link Status</th>
                        <th style={{ width: '20%' }}>Uptime / Inactive</th>
                        <th style={{ width: '14%' }}>VLAN</th>
                        <th style={{ width: '16%' }}>Traffic In/Out</th>
                        <th style={{ paddingRight: '20px', width: '16%' }}>Rekomendasi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPorts.map((port) => {
                        const styleConfig = getIndicatorColor(port.visual_indicator)
                        const isUp = port.status === 'up'
                        const isSelected = selectedPort?.interface === port.interface

                        return (
                          <tr 
                            key={port.interface}
                            onClick={() => setSelectedPort(isSelected ? null : port)}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              background: isSelected ? 'rgba(79, 142, 247, 0.06)' : '',
                              cursor: 'pointer'
                            }}
                            className="row-hover"
                          >
                            {/* Interface & Color Indicator */}
                            <td style={{ paddingLeft: '20px', verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span 
                                  style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: styleConfig.text,
                                    boxShadow: styleConfig.shadow,
                                    display: 'inline-block'
                                  }}
                                  title={`Indikator: ${port.visual_indicator}`}
                                />
                                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                  {cleanInterfaceName(port.interface)}
                                </span>
                              </div>
                            </td>

                            {/* Status & Speed */}
                            <td style={{ verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <span 
                                  className={`badge badge-${isUp ? 'online' : 'offline'}`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '10px', width: 'max-content' }}
                                >
                                  {port.status?.toUpperCase()}
                                </span>
                                
                                {/* Role Badge */}
                                <span 
                                  style={{ 
                                    display: 'inline-flex', 
                                    fontSize: '9.5px', 
                                    fontWeight: 700, 
                                    color: port.role === 'Uplink' ? '#a855f7' : port.role === 'Trunk' ? '#3b82f6' : port.role === 'Access' ? '#10b981' : '#6b7280',
                                    background: port.role === 'Uplink' ? 'rgba(168, 85, 247, 0.1)' : port.role === 'Trunk' ? 'rgba(59, 130, 246, 0.1)' : port.role === 'Access' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    width: 'max-content'
                                  }}
                                >
                                  {port.role}
                                </span>
                              </div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>
                                {port.speed}
                              </div>
                            </td>

                            {/* Duration */}
                            <td style={{ verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px', fontSize: '12.5px' }}>
                              {isUp ? (
                                <span style={{ color: 'var(--success)', fontWeight: 500 }}>
                                  Uptime: {port.port_uptime_duration}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)' }}>
                                  Down: {port.port_inactive_duration}
                                </span>
                              )}
                            </td>

                            {/* VLAN */}
                            <td style={{ verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px', fontSize: '13px' }}>
                              VLAN {port.vlan}
                            </td>

                            {/* Traffic rate */}
                            <td style={{ verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                  📥 In: <span className="mono">{port.traffic_in}</span>
                                </span>
                                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                  📤 Out: <span className="mono">{port.traffic_out}</span>
                                </span>
                              </div>
                            </td>

                            {/* Recommendation Action badge */}
                            <td style={{ paddingRight: '20px', verticalAlign: 'middle', paddingBottom: '12px', paddingTop: '12px' }}>
                              {port.recommendation_action !== '—' ? (
                                <span 
                                  style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    background: port.recommendation_code === 'safe_to_disable' || port.recommendation_code === 'investigate' 
                                      ? 'rgba(239, 68, 68, 0.15)' 
                                      : 'rgba(245, 158, 11, 0.15)',
                                    color: port.recommendation_code === 'safe_to_disable' || port.recommendation_code === 'investigate' 
                                      ? 'var(--danger)' 
                                      : 'var(--warning)',
                                    border: `1px solid ${port.recommendation_code === 'safe_to_disable' || port.recommendation_code === 'investigate' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`
                                  }}
                                >
                                  {port.recommendation_action}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>Ok</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Sidebar Detail Panel (When row selected) */}
            {selectedPort && (
              <div 
                className="card animate-slide" 
                style={{ 
                  padding: '16px', 
                  background: theme === 'light' ? 'var(--bg-card-2)' : '#131924',
                  border: '1px solid var(--border)',
                  position: 'sticky',
                  top: '20px'
                }}
              >
                <div className="flex-between mb-16" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
                  <div>
                    <h5 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔌 Detail: <span style={{ color: 'var(--primary)' }}>{cleanInterfaceName(selectedPort.interface)}</span>
                    </h5>
                  </div>
                  <button 
                    style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    onClick={() => setSelectedPort(null)}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
                  {/* Status & Speed */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                      Status Link & Kecepatan
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className={`badge badge-${selectedPort.status === 'up' ? 'online' : 'offline'}`}>
                        {selectedPort.status?.toUpperCase()}
                      </span>
                      <span 
                        style={{ 
                          fontSize: '10px', 
                          fontWeight: 700, 
                          color: selectedPort.role === 'Uplink' ? '#a855f7' : selectedPort.role === 'Trunk' ? '#3b82f6' : selectedPort.role === 'Access' ? '#10b981' : '#6b7280',
                          background: selectedPort.role === 'Uplink' ? 'rgba(168, 85, 247, 0.1)' : selectedPort.role === 'Trunk' ? 'rgba(59, 130, 246, 0.1)' : selectedPort.role === 'Access' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                          padding: '2px 6px',
                          borderRadius: '4px'
                        }}
                      >
                        {selectedPort.role}
                      </span>
                      <span style={{ fontWeight: 600 }}>{selectedPort.speed}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        (Admin: {selectedPort.admin_status})
                      </span>
                    </div>
                  </div>

                  {/* Durations */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                      Durasi Perubahan Terakhir
                    </div>
                    {selectedPort.status === 'up' ? (
                      <div>
                        <strong>Uptime:</strong> {selectedPort.port_uptime_duration}
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Sejak: {selectedPort.last_link_up_time !== 'Never' ? new Date(selectedPort.last_link_up_time).toLocaleString('id-ID') : 'Never'}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <strong>Inaktif:</strong> {selectedPort.port_inactive_duration}
                        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Sejak: {selectedPort.last_link_down_time !== 'Never' ? new Date(selectedPort.last_link_down_time).toLocaleString('id-ID') : 'Never'}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Connected Device Info */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                      Klien / Tetangga Terhubung
                    </div>
                    {selectedPort.connected_device !== '—' ? (
                      <div style={{ background: 'var(--bg-base)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {selectedPort.connected_device}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
                          VLAN: {selectedPort.vlan}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                        Tidak ada tetangga LLDP/CDP atau host MAC yang terdeteksi.
                      </div>
                    )}
                  </div>

                  {/* Traffic Counters */}
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                      Statistik Lalu Lintas (SNMP Rates)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div style={{ background: 'var(--bg-base)', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>IN RATE</span>
                        <div className="mono" style={{ fontWeight: 600, color: 'var(--primary)' }}>{selectedPort.traffic_in}</div>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Util: {selectedPort.rx_util.toFixed(2)}%</span>
                      </div>
                      <div style={{ background: 'var(--bg-base)', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>OUT RATE</span>
                        <div className="mono" style={{ fontWeight: 600, color: 'var(--success)' }}>{selectedPort.traffic_out}</div>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Util: {selectedPort.tx_util.toFixed(2)}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommendation Actions detailed */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '4px' }}>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Tindakan Rekomendasi
                    </div>
                    {selectedPort.recommendation_action !== '—' ? (
                      <div 
                        style={{
                          padding: '10px',
                          borderRadius: '6px',
                          border: `1.5px solid ${selectedPort.recommendation_code === 'safe_to_disable' || selectedPort.recommendation_code === 'investigate' ? 'var(--danger)' : 'var(--warning)'}`,
                          background: selectedPort.recommendation_code === 'safe_to_disable' || selectedPort.recommendation_code === 'investigate' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)'
                        }}
                      >
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: selectedPort.recommendation_code === 'safe_to_disable' || selectedPort.recommendation_code === 'investigate' ? 'var(--danger)' : 'var(--warning)', fontSize: '12.5px' }}>
                          <AlertTriangle size={14} /> {selectedPort.recommendation_action}
                        </div>
                        <p style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-primary)', lineHeight: '1.45' }}>
                          {selectedPort.recommendation_text}
                        </p>
                      </div>
                    ) : (
                      <div style={{ padding: '8px 10px', background: 'var(--success-glow)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '6px', color: 'var(--success)' }}>
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle size={14} /> Beroperasi Normal
                        </div>
                        <p style={{ marginTop: '2px', fontSize: '11px', color: 'var(--text-primary)' }}>
                          Port berfungsi dengan baik dan tidak ada tindakan yang diperlukan.
                        </p>
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
