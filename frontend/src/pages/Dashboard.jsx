import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Network, Radio, ChevronRight, RefreshCw, Wifi, Shield, Download, Zap, Sliders, CheckSquare, Square, X } from 'lucide-react'
import { arpApi, lldpApi, groupsApi, devicesApi, macApi } from '../api/client'
import AddDeviceModal from '../components/Device/AddDeviceModal'
import ExportModal from '../components/Device/ExportModal'
import { useToast } from '../components/shared/ToastProvider'

const buildHierarchicalGroups = (groupsList) => {
  const map = {}
  const roots = []
  
  groupsList.forEach(g => {
    map[g.id] = { ...g, children: [] }
  })
  
  groupsList.forEach(g => {
    if (g.parent_id && map[g.parent_id]) {
      map[g.parent_id].children.push(map[g.id])
    } else {
      roots.push(map[g.id])
    }
  })
  
  const sortTree = (nodes) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    nodes.forEach(node => {
      if (node.children.length > 0) {
        sortTree(node.children)
      }
    })
  }
  sortTree(roots)
  
  const result = []
  const traverse = (node, depth = 0) => {
    result.push({
      id: node.id,
      name: node.name,
      depth: depth,
      displayName: '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└─ ' : '') + node.name
    })
    node.children.forEach(child => traverse(child, depth + 1))
  }
  
  roots.forEach(root => traverse(root, 0))
  return result
}

const getDescendantGroupIds = (parentGroupId, groupsList) => {
  const ids = [parentGroupId]
  const toVisit = [parentGroupId]
  
  while (toVisit.length > 0) {
    const curr = toVisit.shift()
    const children = groupsList.filter(g => g.parent_id === curr).map(g => g.id)
    children.forEach(childId => {
      if (!ids.includes(childId)) {
        ids.push(childId)
        toVisit.push(childId)
      }
    })
  }
  return ids
}

function StatCard({ label, value, color = 'blue', sub }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {

  const [arpSummary,  setArpSummary]  = useState([])
  const [lldpSummary, setLldpSummary] = useState([])
  const [macSummary,  setMacSummary]  = useState([])
  const [groups, setGroups]           = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [loading, setLoading]         = useState(true)
  const [showAdd, setShowAdd]         = useState(false)
  const [refreshingGroup, setRefreshingGroup] = useState(false)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [visibleWidgets, setVisibleWidgets] = useState(() => {
    const saved = localStorage.getItem('netx_dashboard_widgets')
    if (saved) {
      try { return JSON.parse(saved) } catch (_) {}
    }
    return {
      totalDevices: true,
      onlineDevices: true,
      totalArp: true,
      totalMac: true,
      lldpNeighbors: true,
    }
  })

  const toast = useToast()
  const navigate = useNavigate()

  const handleToggleWidget = (key) => {
    const updated = { ...visibleWidgets, [key]: !visibleWidgets[key] }
    setVisibleWidgets(updated)
    localStorage.setItem('netx_dashboard_widgets', JSON.stringify(updated))
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [arpRes, lldpRes, groupsRes, macRes] = await Promise.all([
        arpApi.getSummary(),
        lldpApi.getSummary(),
        groupsApi.list(),
        macApi.getSummary(),
      ])
      setArpSummary(arpRes.data)
      setLldpSummary(lldpRes.data)
      setGroups(groupsRes.data)
      setMacSummary(macRes.data)
    } catch (_) {}
    setLoading(false)
  }

  const handleExportCsv = async (columns) => {
    setShowExportModal(false)
    try {
      const res = await devicesApi.exportCsv({ columns })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'netx_devices.csv')
      document.body.appendChild(link)
      link.click()
      link.parentNode.removeChild(link)
      toast.success('Daftar perangkat berhasil diekspor ke CSV.')
    } catch (e) {
      toast.error('Gagal mengekspor CSV.')
    }
  }

  const handleRefreshGroup = async () => {
    if (!selectedGroup) return
    setRefreshingGroup(true)
    try {
      const res = await groupsApi.refresh(parseInt(selectedGroup))
      if (res.data.success) {
        toast.success(res.data.message || 'Penyegaran data grup berhasil.')
        fetchData()
      } else {
        toast.error('Penyegaran data grup gagal.')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Penyegaran data grup gagal.')
    } finally {
      setRefreshingGroup(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // Merge ARP, LLDP, and MAC data
  const mergedDevices = arpSummary.map(d => {
    const lldp = lldpSummary.find(l => l.id === d.id)
    const mac = macSummary.find(m => m.id === d.id)
    return { 
      ...d, 
      neighbor_count: lldp?.neighbor_count || 0,
      mac_count: mac?.mac_count || 0,
      mac_addresses_list: mac?.mac_addresses || []
    }
  })

  // Apply group filter recursively
  const selectedGroupInt = selectedGroup ? parseInt(selectedGroup) : null
  const allowedGroupIds = selectedGroupInt ? getDescendantGroupIds(selectedGroupInt, groups) : []

  const devices = mergedDevices.filter(d => 
    selectedGroup === '' || (d.group_id && allowedGroupIds.includes(d.group_id))
  )

  // Deduplicated ARP count
  const allArpMacs = new Set()
  devices.forEach(d => {
    if (d.mac_addresses) {
      d.mac_addresses.forEach(mac => allArpMacs.add(mac.toUpperCase()))
    }
  })
  const totalArp = allArpMacs.size

  // Deduplicated MAC count
  const allMacs = new Set()
  devices.forEach(d => {
    if (d.mac_addresses_list) {
      d.mac_addresses_list.forEach(mac => allMacs.add(mac.toUpperCase()))
    }
  })
  const totalMac = allMacs.size

  const onlineCount = devices.filter(d => d.status === 'online').length
  const totalNeighbors = devices.reduce((s, d) => s + (d.neighbor_count || 0), 0)

  const STATUS_DOT_STYLE = {
    online:  { background:'var(--success)', boxShadow:'0 0 6px var(--success)' },
    offline: { background:'var(--danger)' },
    unknown: { background:'var(--text-muted)' },
  }

  return (
    <div className="page-container animate-fade">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <Network size={22} style={{ color:'var(--primary)' }} />
            NetX Dashboard
          </div>
          <div className="page-subtitle">Monitoring & manajemen perangkat jaringan</div>
        </div>
        <div className="flex-center gap-12">
          {/* Group Filter */}
          <select 
            className="form-control" 
            style={{ width: '180px', padding: '6px 10px', fontSize: '13px' }}
            value={selectedGroup} 
            onChange={e => setSelectedGroup(e.target.value)}
          >
            <option value="">Semua Group</option>
            {buildHierarchicalGroups(groups).map(g => (
              <option key={g.id} value={g.id}>
                {g.displayName}
              </option>
            ))}
          </select>

          {selectedGroup && (
            <button 
              className="btn btn-ghost btn-sm" 
              style={{ color: 'var(--warning)', borderColor: 'var(--warning-glow)' }}
              onClick={handleRefreshGroup}
              disabled={refreshingGroup || loading}
              title="Refresh ARP, LLDP, CDP untuk group ini beserta sub-groupnya"
            >
              {refreshingGroup ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              Refresh Group
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCustomize(true)} style={{ color: 'var(--primary)', borderColor: 'var(--primary-glow)' }}>
            <Sliders size={14} /> Kustomisasi Dashboard
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExportModal(true)}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Tambah Device
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {visibleWidgets.totalDevices && (
          <StatCard label="Total Devices"    value={devices.length}  color="blue"   sub="Terdaftar" />
        )}
        {visibleWidgets.onlineDevices && (
          <StatCard label="Online"           value={onlineCount}     color="green"  sub={`dari ${devices.length} device`} />
        )}
        {visibleWidgets.totalArp && (
          <StatCard label="Total ARP"        value={totalArp}        color="cyan"   sub="MAC unik seluruh device" />
        )}
        {visibleWidgets.totalMac && (
          <StatCard label="Total MAC Table"  value={totalMac}        color="amber"  sub="MAC unik seluruh device" />
        )}
        {visibleWidgets.lldpNeighbors && (
          <StatCard label="LLDP Neighbors"   value={totalNeighbors}  color="purple" sub="Seluruh device" />
        )}
      </div>

      {/* Device Grid */}
      {loading && devices.length === 0 ? (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          Memuat data perangkat...
        </div>
      ) : devices.length === 0 ? (
        <div className="empty-state" style={{ border:'1px dashed var(--border)', borderRadius:'var(--radius)', minHeight:'300px' }}>
          <div className="empty-icon">🌐</div>
          <div className="empty-title">Belum ada perangkat terdaftar</div>
          <div className="empty-desc">
            Tambahkan perangkat jaringan Anda untuk mulai memonitor ARP table dan LLDP neighbors.
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> Tambah Device Pertama
          </button>
        </div>
      ) : (
        <div className="device-grid">
          {devices.map(d => {
            const st = d.status || 'unknown'
            return (
              <div
                key={d.id}
                className="card card-clickable"
                onClick={() => navigate(`/device/${d.id}`)}
              >
                {/* Card header */}
                <div className="device-card-header">
                  <div>
                    <div className="device-card-name">{d.name}</div>
                    <div className="device-card-ip">{d.ip}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px' }}>
                    <span className={`badge badge-${st}`}>
                      <span className="status-dot" style={STATUS_DOT_STYLE[st] || STATUS_DOT_STYLE.unknown} />
                      {st}
                    </span>
                    <span className={`badge badge-${d.protocol}`}>{d.protocol?.toUpperCase()}</span>
                  </div>
                </div>

                {/* Type & Group badges */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px' }}>
                  <div style={{ fontSize:'11px', color:'var(--text-muted)' }}>
                    {d.device_type}
                  </div>
                  {d.group_name && (
                    <div style={{ fontSize:'10px', color:'var(--primary)', background:'var(--primary-transparent)', padding:'2px 6px', borderRadius:'10px', fontWeight:600 }}>
                      {d.group_name}
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="device-card-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
                  <div className="device-card-stat">
                    <span className="device-card-stat-val" style={{ color:'var(--accent)', fontSize: '18px' }}>
                      {d.arp_count || 0}
                    </span>
                    <span className="device-card-stat-label" style={{ fontSize: '9px' }}>ARP</span>
                  </div>
                  <div className="device-card-stat" style={{ textAlign: 'center' }}>
                    <span className="device-card-stat-val" style={{ color:'var(--warning)', fontSize: '18px' }}>
                      {d.mac_count || 0}
                    </span>
                    <span className="device-card-stat-label" style={{ fontSize: '9px' }}>MAC</span>
                  </div>
                  <div className="device-card-stat" style={{ textAlign: 'right' }}>
                    <span className="device-card-stat-val" style={{ color:'var(--purple)', fontSize: '18px' }}>
                      {d.neighbor_count || 0}
                    </span>
                    <span className="device-card-stat-label" style={{ fontSize: '9px' }}>LLDP</span>
                  </div>
                </div>

                {d.last_fetched && (
                  <div style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'10px' }}>
                    Terakhir: {new Date(d.last_fetched).toLocaleString('id-ID')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); fetchData() }}
        />
      )}

      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExport={handleExportCsv}
        />
      )}

      {showCustomize && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <div className="modal-title">
                <Sliders size={18} style={{ color: 'var(--primary)' }} />
                Kustomisasi Dashboard
              </div>
              <button className="btn-close" onClick={() => setShowCustomize(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Pilih widget statistik mana saja yang ingin Anda tampilkan di Dashboard:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  { key: 'totalDevices', label: 'Total Devices', desc: 'Menampilkan jumlah seluruh perangkat terdaftar' },
                  { key: 'onlineDevices', label: 'Perangkat Online', desc: 'Menampilkan perangkat dengan status online' },
                  { key: 'totalArp', label: 'Total ARP Entries', desc: 'Menampilkan total entri ARP unik (tanpa duplikasi)' },
                  { key: 'totalMac', label: 'Total MAC Addresses', desc: 'Menampilkan total alamat MAC unik dari perangkat' },
                  { key: 'lldpNeighbors', label: 'LLDP Neighbors', desc: 'Menampilkan total neighbor LLDP yang terdeteksi' },
                ].map((item) => {
                  const isChecked = visibleWidgets[item.key]
                  return (
                    <div 
                      key={item.key} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card-2)',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                      onClick={() => handleToggleWidget(item.key)}
                    >
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{item.desc}</div>
                      </div>
                      <span style={{ color: isChecked ? 'var(--primary)' : 'var(--text-muted)' }}>
                        {isChecked ? <CheckSquare size={18} /> : <Square size={18} />}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowCustomize(false)}>
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
