import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Radio, Network, Pencil, Trash2,
  TestTube, RefreshCw, Cpu, Server, Activity, HardDrive, X
} from 'lucide-react'
import { devicesApi, arpApi, lldpApi, cdpApi, routingApi, snmpApi, macApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import RefreshControl from '../components/Arp/RefreshControl'
import ArpTable from '../components/Arp/ArpTable'
import ArpDonutChart from '../components/Arp/ArpDonutChart'
import LldpTable from '../components/Lldp/LldpTable'
import CdpTable from '../components/Cdp/CdpTable'
import RoutingTable from '../components/Routing/RoutingTable'
import WebCli from '../components/Terminal/WebCli'
import AddDeviceModal from '../components/Device/AddDeviceModal'
import PortMapper from '../components/PortMapper/PortMapper'

// ─── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color = 'blue', icon }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  )
}

// ─── Tab definitions ───────────────────────────────────────────────────────
const TABS = [
  { id: 'port-mapper', label: '🔌 Port Mapper' },
  { id: 'arp',     label: '📡 ARP Table' },
  { id: 'lldp',    label: '🔗 LLDP' },
  { id: 'cdp',     label: '🤝 CDP' },
  { id: 'routing', label: '🛣️ Routing' },
  { id: 'mac',     label: '📋 MAC Table' },
  { id: 'l2',      label: '⛓️ Layer 2 (STP/VLAN)' },
  { id: 'snmp',    label: '⚡ SNMP' },
]

export default function DeviceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast    = useToast()

  const [device,      setDevice]      = useState(null)
  const [tab,         setTab]         = useState('port-mapper')
  const [showEdit,    setShowEdit]    = useState(false)
  const [delConfirm,  setDelConfirm]  = useState(false)

  const [snmpData,    setSnmpData]    = useState(null)
  const [snmpLoading, setSnmpLoading] = useState(false)
  const [interfaces,  setInterfaces]  = useState([])
  const [ifLoading,   setIfLoading]   = useState(false)

  // MAC state
  const [macEntries,  setMacEntries]  = useState([])
  const [macFetched,  setMacFetched]  = useState(null)
  const [macLoading,  setMacLoading]  = useState(false)
  const [macSearch,   setMacSearch]   = useState('')

  // Detect/Compare state
  const [showDetectModal, setShowDetectModal] = useState(false)
  const [detectLoading, setDetectLoading] = useState(false)
  const [showCompareModal, setShowCompareModal] = useState(false)
  const [compareData, setCompareData] = useState(null)

  // ARP state
  const [arpEntries,  setArpEntries]  = useState([])
  const [arpFetched,  setArpFetched]  = useState(null)
  const [arpLoading,  setArpLoading]  = useState(false)

  // LLDP state
  const [lldpNeighbors, setLldpNeighbors] = useState([])
  const [lldpFetched,   setLldpFetched]   = useState(null)
  const [lldpLoading,   setLldpLoading]   = useState(false)

  // CDP state
  const [cdpNeighbors,  setCdpNeighbors]  = useState([])
  const [cdpFetched,    setCdpFetched]    = useState(null)
  const [cdpLoading,    setCdpLoading]    = useState(false)

  // Routing state
  const [routes,        setRoutes]        = useState([])
  const [routingFetched,setRoutingFetched]= useState(null)
  const [routingLoading,setRoutingLoading]= useState(false)

  // Port Mapper state
  const [portMap,       setPortMap]       = useState([])
  const [portMapLoading,setPortMapLoading]= useState(false)

  // Layer 2 state
  const [l2Data,        setL2Data]        = useState(null)
  const [l2Loading,     setL2Loading]     = useState(false)

  // Load device info
  useEffect(() => {
    devicesApi.get(id).then(r => setDevice(r.data)).catch(() => navigate('/'))
  }, [id])

  // Load cached ARP & LLDP on mount
  useEffect(() => {
    if (!id) return
    arpApi.getCache(id).then(r => {
      setArpEntries(r.data.entries || [])
      setArpFetched(r.data.last_fetched)
    }).catch(() => {})

    lldpApi.getCache(id).then(r => {
      setLldpNeighbors(r.data.neighbors || [])
      setLldpFetched(r.data.last_fetched)
    }).catch(() => {})

    cdpApi.getCache(id).then(r => {
      setCdpNeighbors(r.data || [])
      setCdpFetched(r.data[0]?.fetched_at || null)
    }).catch(() => {})

    routingApi.getCache(id).then(r => {
      setRoutes(r.data || [])
      setRoutingFetched(r.data[0]?.fetched_at || null)
    }).catch(() => {})

    macApi.getCache(id).then(r => {
      setMacEntries(r.data.entries || [])
      setMacFetched(r.data.last_fetched)
    }).catch(() => {})

    devicesApi.getPortMap(id).then(r => {
      setPortMap(r.data || [])
    }).catch(() => {})
  }, [id])

  useEffect(() => {
    if (tab === 'snmp') {
      handleFetchInterfaces()
    } else if (tab === 'l2') {
      handleFetchL2Status()
    }
  }, [tab])

  // ─── ARP Refresh ───────────────────────────────────────────────────────
  const handleArpRefresh = async () => {
    setArpLoading(true)
    try {
      const res = await arpApi.refresh(id)
      setArpEntries(res.data.entries || [])
      setArpFetched(res.data.fetched_at)
      toast.success(`✓ ${res.data.count} ARP entries berhasil diambil.`)
      // Refresh device status
      devicesApi.get(id).then(r => setDevice(r.data)).catch(() => {})
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal mengambil ARP table.')
    }
    setArpLoading(false)
  }

  // ─── LLDP Refresh ──────────────────────────────────────────────────────
  const handleLldpRefresh = async () => {
    setLldpLoading(true)
    try {
      const res = await lldpApi.refresh(id)
      setLldpNeighbors(res.data.neighbors || [])
      setLldpFetched(res.data.fetched_at)
      toast.success(res.data.message || `✓ ${res.data.count} LLDP neighbor berhasil diambil.`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memulai fetch LLDP.')
    }
    setLldpLoading(false)
  }

  // ─── CDP Refresh ───────────────────────────────────────────────────────
  const handleCdpRefresh = async () => {
    setCdpLoading(true)
    try {
      const res = await cdpApi.refresh(id)
      setCdpNeighbors(res.data.neighbors || [])
      setCdpFetched(res.data.fetched_at)
      toast.success(res.data.message || `✓ ${res.data.count} CDP neighbor berhasil diambil.`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memulai fetch CDP.')
    }
    setCdpLoading(false)
  }

  // ─── Routing Refresh ───────────────────────────────────────────────────
  const handleRoutingRefresh = async () => {
    setRoutingLoading(true)
    try {
      const res = await routingApi.refresh(id)
      setRoutes(res.data.routes || [])
      setRoutingFetched(res.data.fetched_at)
      toast.success(res.data.message || `✓ ${res.data.count} route berhasil diambil.`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memulai fetch Routing.')
    }
    setRoutingLoading(false)
  }

  // ─── Test Connection ───────────────────────────────────────────────────
  const handleTest = async () => {
    toast.info('Testing koneksi...')
    try {
      const res = await devicesApi.testConnection(id)
      if (res.data.success) toast.success(res.data.message)
      else toast.error(res.data.message)
      devicesApi.get(id).then(r => setDevice(r.data)).catch(() => {})
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal test koneksi.')
    }
  }

  const handleTestSnmp = async () => {
    setSnmpLoading(true)
    setSnmpData(null)
    toast.info('Testing SNMP...')
    try {
      const res = await snmpApi.test(id)
      setSnmpData(res.data.data)
      toast.success(res.data.message)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'SNMP test gagal.')
    } finally {
      setSnmpLoading(false)
    }
  }

  const handleFetchInterfaces = async () => {
    setIfLoading(true)
    try {
      const res = await snmpApi.getInterfaces(id)
      setInterfaces(res.data)
    } catch (e) {
      // Silently fail on auto-load
    } finally {
      setIfLoading(false)
    }
  }

  const handleFetchL2Status = async () => {
    setL2Loading(true)
    try {
      const res = await snmpApi.getL2Status(id)
      setL2Data(res.data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memuat status Layer 2.')
    } finally {
      setL2Loading(false)
    }
  }

  const handleFetchInterfacesManual = async () => {
    setIfLoading(true)
    try {
      const res = await snmpApi.getInterfaces(id)
      setInterfaces(res.data)
      toast.success('Daftar interface berhasil dimuat.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memuat interface SNMP.')
    } finally {
      setIfLoading(false)
    }
  }

  // ─── Detect Info ────────────────────────────────────────────────────────
  const handleDetectInfo = () => {
    setShowDetectModal(true)
  }

  const triggerDetectInfo = async (method) => {
    setDetectLoading(true)
    setShowDetectModal(false)
    toast.info(method === 'compare' ? 'Menjalankan deteksi SNMP & CLI...' : `Mendeteksi info perangkat via ${method.toUpperCase()}...`)
    try {
      const res = await snmpApi.detectInfo(id, method)
      if (method === 'compare') {
        setCompareData(res.data)
        setShowCompareModal(true)
      } else {
        toast.success(res.data.message)
        devicesApi.get(id).then(r => setDevice(r.data)).catch(() => {})
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal mendeteksi info perangkat.')
    } finally {
      setDetectLoading(false)
    }
  }

  const handleSaveReconciled = async (reconciledData) => {
    try {
      await devicesApi.update(id, reconciledData)
      toast.success('Detail perangkat berhasil diperbarui.')
      setShowCompareModal(false)
      const r = await devicesApi.get(id)
      setDevice(r.data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal memperbarui detail perangkat.')
    }
  }

  // ─── MAC Refresh ───────────────────────────────────────────────────────
  const handleMacRefresh = async () => {
    setMacLoading(true)
    toast.info('Menyegarkan tabel MAC Address...')
    try {
      const res = await macApi.refresh(id)
      setMacEntries(res.data.entries || [])
      setMacFetched(res.data.last_fetched || new Date().toISOString())
      toast.success(res.data.message || 'Tabel MAC Address berhasil disegarkan.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menyegarkan tabel MAC Address.')
    } finally {
      setMacLoading(false)
    }
  }

  // ─── Port Mapper Refresh ────────────────────────────────────────────────
  const handlePortMapRefresh = async () => {
    setPortMapLoading(true)
    try {
      const res = await devicesApi.getPortMap(id)
      setPortMap(res.data || [])
      toast.success('Port Mapper berhasil disegarkan.')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menyegarkan data Port Mapper.')
    } finally {
      setPortMapLoading(false)
    }
  }

  // ─── Delete Device ─────────────────────────────────────────────────────
  const handleDelete = async () => {
    try {
      await devicesApi.remove(id)
      toast.success('Device berhasil dihapus.')
      navigate('/')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Gagal menghapus device.')
    }
  }

  // ─── ARP stats ─────────────────────────────────────────────────────────
  const arpStats = {
    total:      arpEntries.length,
    dynamic:    arpEntries.filter(e => e.entry_type === 'dynamic').length,
    static:     arpEntries.filter(e => e.entry_type === 'static').length,
    incomplete: arpEntries.filter(e => e.entry_type === 'incomplete').length,
    vendors:    new Set(arpEntries.map(e => e.mac_vendor).filter(v => v && v !== 'Unknown')).size,
  }

  const lldpStats = {
    total:      lldpNeighbors.length,
    networking: lldpNeighbors.filter(n => n.device_category === 'networking').length,
    endpoint:   lldpNeighbors.filter(n => n.device_category === 'endpoint').length,
  }

  const cdpStats = { total: cdpNeighbors.length }
  const routingStats = { total: routes.length }

  if (!device) {
    return (
      <div className="loading-overlay" style={{ height:'100vh' }}>
        <div className="loading-spinner" />
        Memuat device...
      </div>
    )
  }

  const isCisco = device.device_type?.toLowerCase()?.startsWith('cisco')
  const visibleTabs = TABS.filter(t => t.id !== 'cdp' || isCisco)

  const statusStyle = {
    online:  { color:'var(--success)', dot:'var(--success)' },
    offline: { color:'var(--danger)',  dot:'var(--danger)' },
    unknown: { color:'var(--text-muted)', dot:'var(--text-muted)' },
  }[device.status] || { color:'var(--text-muted)', dot:'var(--text-muted)' }

  return (
    <div className="page-container animate-fade">
      {/* Back + Header */}
      <div style={{ marginBottom:'20px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ marginBottom:'12px' }}>
          <ArrowLeft size={14} /> Kembali ke Dashboard
        </button>

        <div className="page-header">
          <div>
            <div className="page-title" style={{ gap:'12px' }}>
              <span
                className="status-dot"
                style={{ width:10, height:10, background:statusStyle.dot,
                  boxShadow: device.status === 'online' ? `0 0 8px ${statusStyle.dot}` : 'none' }}
              />
              {device.name}
              <span className={`badge badge-${device.protocol}`}>{device.protocol?.toUpperCase()}</span>
            </div>
            <div style={{ display:'flex', gap:'12px', marginTop:'4px', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'13px', color:'var(--text-muted)' }}>
                {device.ip}:{device.port}
              </span>
              <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>•</span>
              <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>{device.device_type}</span>
              {device.description && (
                <>
                  <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>•</span>
                  <span style={{ fontSize:'12px', color:'var(--text-muted)' }}>{device.description}</span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex-center gap-12" style={{ flexWrap:'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDetectInfo}>
              <Cpu size={14} /> Detect Info
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleTest}>
              <TestTube size={14} /> Test Koneksi
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)}>
              <Pencil size={14} /> Edit
            </button>
            {!delConfirm ? (
              <button className="btn btn-danger btn-sm" onClick={() => setDelConfirm(true)}>
                <Trash2 size={14} /> Hapus
              </button>
            ) : (
              <div className="flex-center gap-8">
                <span style={{ fontSize:'12px', color:'var(--danger)' }}>Yakin?</span>
                <button className="btn btn-danger btn-sm" onClick={handleDelete}>Ya, Hapus</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDelConfirm(false)}>Batal</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hardware Details Panel */}
      <div className="card" style={{ marginBottom: '20px', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'rgba(79, 142, 247, 0.1)', borderRadius: '8px', color: 'var(--primary)' }}>
              <Server size={18} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Model Perangkat</div>
              <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)' }}>{device.hardware_model || '-'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'rgba(40, 199, 111, 0.1)', borderRadius: '8px', color: 'var(--success)' }}>
              <Activity size={18} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Versi OS</div>
              <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)' }}>{device.os_version || '-'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'rgba(255, 159, 67, 0.1)', borderRadius: '8px', color: 'var(--warning)' }}>
              <HardDrive size={18} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Serial Number</div>
              <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)', fontFamily: 'monospace' }}>{device.serial_number || '-'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'rgba(234, 84, 85, 0.1)', borderRadius: '8px', color: 'var(--danger)' }}>
              <Network size={18} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MAC Address</div>
              <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text)', fontFamily: 'monospace' }}>{device.mac_address || '-'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span style={{
              background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-hover)',
              color: tab === t.id ? 'white' : 'var(--text-muted)',
              borderRadius:'10px', padding:'0 6px', fontSize:'11px', fontWeight:700
            }}>
              {t.id === 'port-mapper' ? portMap.length :
               t.id === 'arp' ? arpStats.total : 
               t.id === 'lldp' ? lldpStats.total : 
               t.id === 'cdp' ? cdpStats.total : 
               t.id === 'routing' ? routingStats.total :
               t.id === 'mac' ? macEntries.length :
               t.id === 'snmp' ? interfaces.length :
               t.id === 'l2' ? (l2Data?.stp_ports?.length || 0) :
               '0'}
            </span>
          </button>
        ))}
        <button
          className={`tab-btn ${tab === 'terminal' ? 'active' : ''}`}
          onClick={() => setTab('terminal')}
        >
          💻 Web CLI
        </button>
      </div>

      {/* ── PORT MAPPER TAB ──────────────────────────────────────────────── */}
      {tab === 'port-mapper' && (
        <PortMapper portMap={portMap} loading={portMapLoading} onRefresh={handlePortMapRefresh} />
      )}

      {/* ── ARP TAB ──────────────────────────────────────────────────────── */}
      {tab === 'arp' && (
        <div className="animate-slide">
          {/* ARP Stat cards */}
          <div className="stat-grid" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', marginBottom:'20px' }}>
            <StatCard label="Total ARP"    value={arpStats.total}      color="blue"   icon="📡" />
            <StatCard label="Dynamic"      value={arpStats.dynamic}    color="cyan"   icon="🔵" />
            <StatCard label="Static"       value={arpStats.static}     color="green"  icon="🟢" />
            <StatCard label="Incomplete"   value={arpStats.incomplete}  color="red"   icon="🔴" />
            <StatCard label="Unique Vendors" value={arpStats.vendors}  color="purple" icon="🏢" />
          </div>

          {/* Chart + Refresh row */}
          {arpEntries.length > 0 && (
            <div className="card mb-24" style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:'24px', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:'13px', fontWeight:700, color:'var(--text-secondary)', marginBottom:'12px' }}>
                  Breakdown by Device Category
                </div>
                <ArpDonutChart entries={arpEntries} />
              </div>
              <div style={{ padding:'16px', background:'var(--bg-card-2)', borderRadius:'var(--radius-sm)' }}>
                {['networking','endpoint','printer','phone','iot','unknown'].map(cat => {
                  const count = arpEntries.filter(e => e.device_category === cat).length
                  if (!count) return null
                  const pct = ((count / arpEntries.length) * 100).toFixed(0)
                  const catColors = { networking:'var(--primary)', endpoint:'var(--success)', printer:'var(--warning)', phone:'var(--purple)', iot:'#f97316', unknown:'var(--text-muted)' }
                  return (
                    <div key={cat} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                      <span style={{ fontSize:'12px', color:'var(--text-secondary)', textTransform:'capitalize' }}>{cat}</span>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:'60px', height:'4px', background:'var(--border)', borderRadius:'2px', overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background:catColors[cat], borderRadius:'2px' }} />
                        </div>
                        <span style={{ fontSize:'12px', fontWeight:700, color:catColors[cat], width:'28px', textAlign:'right' }}>{count}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Refresh control */}
          <div className="flex-between mb-16">
            <RefreshControl
              onRefresh={handleArpRefresh}
              loading={arpLoading}
              lastFetched={arpFetched}
            />
          </div>

          {/* Table */}
          <ArpTable entries={arpEntries} />
        </div>
      )}

      {/* ── LLDP TAB ─────────────────────────────────────────────────────── */}
      {tab === 'lldp' && (
        <div className="animate-slide">
          {/* LLDP Stats */}
          <div className="stat-grid" style={{ gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', marginBottom:'20px' }}>
            <StatCard label="Total Neighbors"  value={lldpStats.total}      color="purple" icon="🔗" />
            <StatCard label="Networking"        value={lldpStats.networking} color="blue"   icon="🖥" />
            <StatCard label="Endpoints/Others"  value={lldpStats.total - lldpStats.networking} color="green" icon="💻" />
          </div>

          {/* Refresh control */}
          <div className="flex-between mb-16">
            <RefreshControl
              onRefresh={handleLldpRefresh}
              loading={lldpLoading}
              lastFetched={lldpFetched}
            />
          </div>

          {/* Table */}
          <LldpTable neighbors={lldpNeighbors} />
        </div>
      )}

      {/* ── CDP TAB ──────────────────────────────────────────────────────── */}
      {tab === 'cdp' && (
        <div className="animate-slide">
          <div className="flex-between mb-16">
            <RefreshControl
              onRefresh={handleCdpRefresh}
              loading={cdpLoading}
              lastFetched={cdpFetched}
            />
          </div>
          <CdpTable neighbors={cdpNeighbors} />
        </div>
      )}

      {/* ── ROUTING TAB ──────────────────────────────────────────────────── */}
      {tab === 'routing' && (
        <div className="animate-slide">
          <div className="flex-between mb-16">
            <RefreshControl
              onRefresh={handleRoutingRefresh}
              loading={routingLoading}
              lastFetched={routingFetched}
            />
          </div>
          <RoutingTable routes={routes} />
        </div>
      )}

      {/* ── MAC TABLE TAB ─────────────────────────────────────────────────── */}
      {tab === 'mac' && (
        <div className="animate-slide">
          {/* Refresh control */}
          <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <RefreshControl
              onRefresh={handleMacRefresh}
              loading={macLoading}
              lastFetched={macFetched}
            />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                className="form-control"
                style={{ width: '250px', height: '36px', fontSize: '13px' }}
                placeholder="Cari MAC, VLAN, Vendor, atau Port..."
                value={macSearch}
                onChange={e => setMacSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          <div className="card">
            {macLoading && macEntries.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', gap: '16px' }}>
                <div className="loading-spinner" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Membaca tabel MAC address perangkat...</span>
              </div>
            ) : macEntries.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Tidak ada data MAC Address. Klik tombol penyegaran di atas untuk menyelaraskan.
              </div>
            ) : (
              <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th>VLAN</th>
                      <th>MAC Address</th>
                      <th>Vendor</th>
                      <th>Entry Type</th>
                      <th>Interface / Port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macEntries
                      .filter(e => {
                        const s = macSearch.toLowerCase()
                        return (
                          e.mac_address?.toLowerCase().includes(s) ||
                          e.vlan?.toLowerCase().includes(s) ||
                          e.interface?.toLowerCase().includes(s) ||
                          e.entry_type?.toLowerCase().includes(s) ||
                          e.mac_vendor?.toLowerCase().includes(s)
                        )
                      })
                      .map((e, idx) => (
                        <tr key={e.id || idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ fontWeight: 600 }}>{e.vlan}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '13px', color: 'var(--primary)' }}>{e.mac_address}</td>
                          <td>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                              {e.mac_vendor || 'Unknown'}
                            </span>
                          </td>
                          <td>
                            <span 
                              className={`badge badge-${e.entry_type === 'dynamic' ? 'ssh' : 'telnet'}`}
                              style={{ textTransform: 'capitalize' }}
                            >
                              {e.entry_type}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{e.interface}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TERMINAL TAB ─────────────────────────────────────────────────── */}
      {tab === 'terminal' && (
        <div className="animate-slide">
          <WebCli deviceId={id} />
        </div>
      )}

      {/* ── SNMP TAB ─────────────────────────────────────────────────────── */}
      {tab === 'snmp' && (
        <div className="animate-slide">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            {/* SNMP Tester Card */}
            <div className="card p-24" style={{ height: 'fit-content' }}>
              <h3 className="font-bold text-lg mb-12 flex items-center gap-8" style={{ margin: 0, fontSize: '16px' }}>
                <Radio className="text-primary" size={18} /> SNMP Tester
              </h3>
              <p className="text-sm text-muted mb-20" style={{ fontSize: '13px', lineHeight: '1.5' }}>
                Fitur ini mengirimkan permintaan SNMP dasar ke perangkat untuk memastikan kredensial 
                Community yang digunakan valid dan agent SNMP merespons.
              </p>
              
              <button className="btn btn-primary" onClick={handleTestSnmp} disabled={snmpLoading} style={{ width: '100%', justifyContent: 'center' }}>
                {snmpLoading ? <span className="loading-spinner" style={{ width: 14, height: 14 }} /> : <Radio size={14} />}
                {snmpLoading ? 'Testing...' : 'Test SNMP Connection'}
              </button>

              {snmpData && (
                <div className="mt-20" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '4px', textTransform: 'uppercase' }}>System Uptime</div>
                    <div style={{ fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 600, fontSize: '13px' }}>{snmpData.sysUpTime || 'N/A'}</div>
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '4px', textTransform: 'uppercase' }}>System Description</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.4', wordBreak: 'break-all' }}>{snmpData.sysDescr || 'N/A'}</div>
                  </div>
                </div>
              )}
            </div>

            {/* SNMP Interfaces and Bandwidth Card */}
            <div className="card p-24" style={{ gridColumn: 'span 2', minWidth: 0 }}>
              <div className="flex-between mb-16">
                <h3 className="font-bold text-lg flex items-center gap-8" style={{ margin: 0, fontSize: '16px' }}>
                  🔌 SNMP Ports & Real-Time Bandwidth
                </h3>
                <button className="btn btn-ghost btn-sm" onClick={handleFetchInterfacesManual} disabled={ifLoading}>
                  <RefreshCw size={14} style={{ animation: ifLoading ? 'spin 1s linear infinite' : 'none' }} />
                  {ifLoading ? 'Calculating Delta...' : 'Refresh Bandwidth'}
                </button>
              </div>

              {ifLoading && interfaces.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', gap: '16px' }}>
                  <div className="loading-spinner" style={{ width: 32, height: 32 }} />
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Membaca counter SNMP & menghitung bandwidth...</span>
                </div>
              ) : interfaces.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  Tidak ada data interface. Pastikan SNMP Community dikonfigurasi dengan benar untuk perangkat ini.
                </div>
              ) : (
                <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Index</th>
                        <th style={{ minWidth: '180px' }}>Interface / Alias</th>
                        <th style={{ width: '80px' }}>Status</th>
                        <th style={{ minWidth: '150px' }}>Properties</th>
                        <th style={{ width: '140px' }}>MAC Address</th>
                        <th style={{ minWidth: '160px' }}>Throughput (Rx / Tx)</th>
                        <th style={{ minWidth: '160px' }}>Utilization (Rx / Tx)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interfaces.map(i => (
                        <tr key={i.index} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>#{i.index}</td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{i.name}</div>
                            {i.alias && (
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '2px' }}>
                                {i.alias}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`badge badge-${i.status === 'up' ? 'online' : 'offline'}`} style={{ padding: '2px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <span 
                                className="status-dot" 
                                style={{ 
                                  background: i.status === 'up' ? 'var(--success)' : 'var(--danger)',
                                  boxShadow: i.status === 'up' ? '0 0 6px var(--success)' : 'none',
                                  width: '6px', height: '6px'
                                }} 
                              />
                              {i.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: i.speed.includes('Gbps') ? 'var(--primary)' : 'var(--text)' }}>
                              {i.speed}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {i.type} (MTU {i.mtu})
                            </div>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)' }}>{i.mac || '—'}</td>
                          <td>
                            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                              <span style={{ color: 'var(--success)', display: 'inline-block' }}>📥</span> 
                              <span>{i.rx_rate}</span>
                            </div>
                            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', marginTop: '4px' }}>
                              <span style={{ color: 'var(--warning)', display: 'inline-block' }}>📤</span> 
                              <span>{i.tx_rate}</span>
                            </div>
                          </td>
                          <td>
                            {/* Rx Util Bar */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '60px' }}>In: {i.rx_util}</span>
                              <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div 
                                  style={{ 
                                    width: `${i.rx_util_val}%`, 
                                    height: '100%', 
                                    background: 'var(--success)',
                                    boxShadow: '0 0 4px var(--success)',
                                    borderRadius: '3px' 
                                  }} 
                                />
                              </div>
                            </div>
                            {/* Tx Util Bar */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', width: '60px' }}>Out: {i.tx_util}</span>
                              <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div 
                                  style={{ 
                                    width: `${i.tx_util_val}%`, 
                                    height: '100%', 
                                    background: 'var(--warning)',
                                    boxShadow: '0 0 4px var(--warning)',
                                    borderRadius: '3px' 
                                  }} 
                                />
                              </div>
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
        </div>
      )}

      {/* ── LAYER 2 TAB ──────────────────────────────────────────────────── */}
      {tab === 'l2' && (
        <div className="animate-slide">
          {/* Header Controls */}
          <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⛓️ Layer 2 Spanning Tree & VLANs
              </h3>
              {l2Data && (
                <span className={`badge badge-${l2Data.stp_enabled ? 'online' : 'offline'}`} style={{ textTransform: 'uppercase' }}>
                  {l2Data.stp_enabled ? 'STP Enabled' : 'STP Disabled'}
                </span>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleFetchL2Status} disabled={l2Loading}>
              <RefreshCw size={14} style={{ width: 14, height: 14, animation: l2Loading ? 'spin 1s linear infinite' : 'none' }} />
              {l2Loading ? 'Memuat...' : 'Refresh L2 Status'}
            </button>
          </div>

          {l2Loading && !l2Data ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', gap: '16px' }}>
              <div className="loading-spinner" style={{ width: 32, height: 32 }} />
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Membaca status Layer 2 via SNMP...</span>
            </div>
          ) : !l2Data ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Gagal memuat atau tidak ada data Layer 2. Pastikan SNMP terkonfigurasi dengan benar untuk perangkat ini.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* STP Global Stats Grid */}
              {l2Data.stp_enabled && l2Data.stp_global && Object.keys(l2Data.stp_global).length > 0 && (
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Spanning Tree Global Parameters
                  </div>
                  <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <StatCard 
                      label="STP Protocol" 
                      value={l2Data.stp_global.protocol} 
                      color="blue" 
                      icon="⚙️" 
                    />
                    <StatCard 
                      label="Bridge Priority" 
                      value={l2Data.stp_global.priority} 
                      color="cyan" 
                      icon="👑" 
                    />
                    <StatCard 
                      label="Root Bridge (Priority/MAC)" 
                      value={l2Data.stp_global.root_bridge} 
                      color="purple" 
                      icon="🌴" 
                    />
                    <StatCard 
                      label="Root Path Cost" 
                      value={l2Data.stp_global.root_cost} 
                      color="green" 
                      icon="📈" 
                    />
                    <StatCard 
                      label="Root Port" 
                      value={l2Data.stp_global.root_port !== "0" ? `Port ${l2Data.stp_global.root_port}` : 'This is Root Bridge'} 
                      color="indigo" 
                      icon="🔌" 
                    />
                    <StatCard 
                      label="Topology Changes" 
                      value={l2Data.stp_global.top_changes} 
                      color="red" 
                      icon="⚠️" 
                    />
                  </div>
                </div>
              )}

              {/* Two columns layout: STP Ports & VLANs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '24px' }}>
                
                {/* STP Ports Card */}
                <div className="card p-24" style={{ minWidth: 0 }}>
                  <h3 className="font-bold text-lg mb-16 flex items-center gap-8" style={{ margin: 0, fontSize: '16px' }}>
                    🌿 STP Port States & Costs
                  </h3>
                  
                  {!l2Data.stp_ports || l2Data.stp_ports.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Tidak ada informasi port STP.
                    </div>
                  ) : (
                    <div className="table-wrapper" style={{ maxHeight: '450px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th>Bridge Port</th>
                            <th>Interface Name</th>
                            <th>STP State</th>
                            <th>Path Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l2Data.stp_ports.map((port, idx) => {
                            const isBlocking = port.state === 'blocking' || port.state === 'broken';
                            const isForwarding = port.state === 'forwarding';
                            const stateBadgeColor = isForwarding ? 'success' : isBlocking ? 'danger' : 'warning';
                            
                            return (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>
                                  #{port.bridge_port}
                                </td>
                                <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {port.interface_name}
                                </td>
                                <td>
                                  <span 
                                    className={`badge badge-${stateBadgeColor}`} 
                                    style={{ 
                                      padding: '2px 8px', 
                                      fontSize: '11px', 
                                      display: 'inline-flex', 
                                      alignItems: 'center', 
                                      gap: '4px'
                                    }}
                                  >
                                    <span 
                                      className="status-dot" 
                                      style={{ 
                                        background: isForwarding ? 'var(--success)' : isBlocking ? 'var(--danger)' : 'var(--warning)',
                                        boxShadow: isForwarding ? '0 0 6px var(--success)' : isBlocking ? '0 0 6px var(--danger)' : 'none',
                                        width: '6px', height: '6px'
                                      }} 
                                    />
                                    {port.state}
                                  </span>
                                </td>
                                <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                  {port.path_cost}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* VLANs Database Card */}
                <div className="card p-24" style={{ minWidth: 0 }}>
                  <h3 className="font-bold text-lg mb-16 flex items-center gap-8" style={{ margin: 0, fontSize: '16px' }}>
                    🏷️ Configured VLANs
                  </h3>
                  
                  {!l2Data.vlans || l2Data.vlans.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      Tidak ada informasi VLAN static terdeteksi.
                    </div>
                  ) : (
                    <div className="table-wrapper" style={{ maxHeight: '450px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '100px' }}>VLAN ID</th>
                            <th>VLAN Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l2Data.vlans.map((vlan, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ fontWeight: 700, color: 'var(--primary)', fontFamily: 'monospace' }}>
                                VLAN {vlan.vlan_id}
                              </td>
                              <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                {vlan.name}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <AddDeviceModal
          editDevice={device}
          onClose={() => setShowEdit(false)}
          onSuccess={() => {
            setShowEdit(false)
            devicesApi.get(id).then(r => setDevice(r.data)).catch(() => {})
          }}
        />
      )}

      {/* Detect Options Modal */}
      {showDetectModal && (
        <div className="modal-overlay" onClick={() => setShowDetectModal(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '450px' }}>
            <div className="modal-header">
              <div className="modal-title">
                <Cpu size={18} /> Pilihan Deteksi Informasi
              </div>
              <button className="btn-close" onClick={() => setShowDetectModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p className="text-sm text-muted" style={{ fontSize: '13px', lineHeight: '1.5', marginBottom: '8px' }}>
                Pilih metode yang ingin digunakan untuk mendeteksi detail perangkat (Model, Versi OS, Serial Number, MAC Address):
              </p>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '12px 16px', gap: '12px' }} onClick={() => triggerDetectInfo('snmp')}>
                📡 Deteksi via SNMP Only
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: '12px 16px', gap: '12px' }} onClick={() => triggerDetectInfo('cli')}>
                💻 Deteksi via CLI Only
              </button>
              <button className="btn btn-primary" style={{ justifyContent: 'flex-start', padding: '12px 16px', gap: '12px' }} onClick={() => triggerDetectInfo('compare')}>
                ⚖️ Deteksi & Bandingkan Keduanya (Compare Both)
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDetectModal(false)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Compare Reconciliation Modal */}
      {showCompareModal && compareData && (
        <CompareModal
          data={compareData}
          onClose={() => setShowCompareModal(false)}
          onSave={handleSaveReconciled}
        />
      )}
    </div>
  )
}

function CompareModal({ data, onClose, onSave }) {
  const [os, setOs] = useState(data.snmp?.os_version || data.cli?.os_version || '')
  const [model, setModel] = useState(data.snmp?.hardware_model || data.cli?.hardware_model || '')
  const [sn, setSn] = useState(data.snmp?.serial_number || data.cli?.serial_number || '')
  const [mac, setMac] = useState(data.snmp?.mac_address || data.cli?.mac_address || '')

  const handleSave = () => {
    onSave({
      os_version: os,
      hardware_model: model,
      serial_number: sn,
      mac_address: mac,
      raw_info: data.cli?.raw_info || `SNMP System Description: ${data.snmp?.os_version}`
    })
  }

  const renderRow = (label, key, val, setVal, snmpVal, cliVal) => {
    const isMatch = snmpVal && cliVal && snmpVal.toLowerCase() === cliVal.toLowerCase()
    return (
      <div style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr', gap: '16px', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{label}</span>
          
          {/* SNMP Value */}
          <div 
            style={{ 
              padding: '8px 12px', background: 'var(--bg-card-2)', borderRadius: '6px', fontSize: '12px', 
              cursor: snmpVal ? 'pointer' : 'default', border: val === snmpVal ? '1px solid var(--primary)' : '1px solid transparent',
              overflow: 'hidden'
            }}
            onClick={() => snmpVal && setVal(snmpVal)}
          >
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>SNMP</div>
            <div style={{ fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={snmpVal}>{snmpVal || '—'}</div>
          </div>

          {/* CLI Value */}
          <div 
            style={{ 
              padding: '8px 12px', background: 'var(--bg-card-2)', borderRadius: '6px', fontSize: '12px', 
              cursor: cliVal ? 'pointer' : 'default', border: val === cliVal ? '1px solid var(--primary)' : '1px solid transparent',
              overflow: 'hidden'
            }}
            onClick={() => cliVal && setVal(cliVal)}
          >
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>CLI</div>
            <div style={{ fontFamily: 'monospace', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={cliVal}>{cliVal || '—'}</div>
          </div>
        </div>

        {/* Selected / Edited Value */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px', paddingLeft: '130px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Pilihan:</span>
          <input 
            className="form-control" 
            style={{ height: '32px', fontSize: '12px', padding: '4px 8px', flex: 1 }} 
            value={val} 
            onChange={e => setVal(e.target.value)} 
            placeholder={`Pilih SNMP, CLI atau ketik manual...`}
          />
          {isMatch ? (
            <span className="badge badge-online" style={{ fontSize: '11px', padding: '4px 8px' }}>✓ Cocok</span>
          ) : snmpVal && cliVal ? (
            <span className="badge badge-offline" style={{ fontSize: '11px', padding: '4px 8px' }}>⚠ Berbeda</span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-slide" style={{ maxWidth: '750px', width: '90%' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>⚖️ Rekonsiliasi Detail Perangkat</span>
          </div>
          <button className="btn-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <p className="text-sm text-muted" style={{ fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }}>
            Bandingkan nilai di bawah dari SNMP dan CLI. Klik salah satu kotak nilai untuk memilihnya, atau ketik langsung di kolom input untuk menyesuaikan. Klik <strong>Simpan</strong> untuk menerapkan ke database.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {renderRow("Model Perangkat", "model", model, setModel, data.snmp?.hardware_model, data.cli?.hardware_model)}
            {renderRow("Versi OS", "os", os, setOs, data.snmp?.os_version, data.cli?.os_version)}
            {renderRow("Serial Number", "sn", sn, setSn, data.snmp?.serial_number, data.cli?.serial_number)}
            {renderRow("MAC Address", "mac", mac, setMac, data.snmp?.mac_address, data.cli?.mac_address)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Batal</button>
          <button className="btn btn-primary" onClick={handleSave}>
            Simpan Hasil Rekonsiliasi
          </button>
        </div>
      </div>
    </div>
  )
}
