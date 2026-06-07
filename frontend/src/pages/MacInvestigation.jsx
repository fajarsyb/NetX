import { useState, useEffect } from 'react'
import {
  Search, Cpu, CheckCircle2, XCircle, Info, Network,
  ArrowRight, ShieldAlert, Sparkles, RefreshCw, Layers, MapPin, Eye, ExternalLink,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import { macApi, arpApi, lldpApi, groupsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useNavigate } from 'react-router-dom'

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

export default function MacInvestigation() {
  const [activeTab, setActiveTab] = useState('trace')
  const [macQuery, setMacQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [result, setResult] = useState(null)

  // Global lists state
  const [arpData, setArpData] = useState([])
  const [macData, setMacData] = useState([])
  const [lldpData, setLldpData] = useState([])
  const [loadingArp, setLoadingArp] = useState(false)
  const [loadingMac, setLoadingMac] = useState(false)
  const [loadingLldp, setLoadingLldp] = useState(false)

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  const toast = useToast()
  const navigate = useNavigate()

  // Live validation of MAC address
  const isValidMac = (mac) => {
    const clean = mac.replace(/[^a-fA-F0-9]/g, '')
    return clean.length === 12
  }

  // Live validation of IP address
  const isValidIp = (ip) => {
    const regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    if (!regex.test(ip)) return false
    const parts = ip.split('.')
    return parts.every(p => parseInt(p, 10) <= 255)
  }

  const isValidInput = (val) => {
    const trimmed = val.trim()
    return isValidMac(trimmed) || isValidIp(trimmed)
  }

  const handleInvestigate = async (e) => {
    if (e) e.preventDefault()
    
    const cleanQuery = macQuery.trim()
    if (!cleanQuery) {
      toast.error('Masukkan MAC Address atau IP Address terlebih dahulu.')
      return
    }

    setLoading(true)
    setResult(null)
    toast.info('Menelusuri lokasi di seluruh perangkat...')

    try {
      const res = await macApi.investigate(cleanQuery)
      setResult(res.data)
      if (res.data.locations.length === 0) {
        toast.warning('Hasil terdeteksi, namun tidak ditemukan di tabel MAC switch mana pun (kemungkinan port mati atau cache usang).')
      } else {
        toast.success('Lokasi berhasil ditemukan!')
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'Gagal melakukan investigasi.'
      toast.error(errMsg)
    } finally {
      setLoading(false)
    }
  }

  const handleLiveScanAll = async () => {
    setScanLoading(true)
    toast.info('Menjalankan pemindaian paralel tabel MAC di seluruh perangkat online... Mohon tunggu.')
    try {
      const res = await macApi.scanAll()
      toast.success(res.data.message || 'Penyegaran tabel MAC massal sukses!')
      
      // Refresh active tab data
      if (activeTab === 'trace' && macQuery.trim()) {
        handleInvestigate()
      } else if (activeTab === 'arp') {
        fetchArp()
      } else if (activeTab === 'mac') {
        fetchMac()
      } else if (activeTab === 'lldp') {
        fetchLldp()
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'Gagal menjalankan pemindaian massal.'
      toast.error(errMsg)
    } finally {
      setScanLoading(false)
    }
  }

  // Fetch API handlers
  const fetchArp = async () => {
    setLoadingArp(true)
    try {
      const res = await arpApi.getAll()
      setArpData(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      toast.error('Gagal mengambil data ARP global.')
      setArpData([])
    } finally {
      setLoadingArp(false)
    }
  }

  const fetchMac = async () => {
    setLoadingMac(true)
    try {
      const res = await macApi.getAll()
      setMacData(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      toast.error('Gagal mengambil data MAC global.')
      setMacData([])
    } finally {
      setLoadingMac(false)
    }
  }

  const fetchLldp = async () => {
    setLoadingLldp(true)
    try {
      const res = await lldpApi.getAll()
      setLldpData(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      toast.error('Gagal mengambil data LLDP global.')
      setLldpData([])
    } finally {
      setLoadingLldp(false)
    }
  }

  useEffect(() => {
    groupsApi.list().then(res => setGroups(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (activeTab === 'arp') fetchArp()
    if (activeTab === 'mac') fetchMac()
    if (activeTab === 'lldp') fetchLldp()
    
    // Clear filters on tab change
    setSearchQuery('')
    setDeviceFilter('')
    setSelectedGroup('')
    setPage(1)
  }, [activeTab])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, deviceFilter, selectedGroup])

  // Helper to extract unique devices list for dropdown filters
  const getUniqueDevices = (data) => {
    if (!Array.isArray(data)) return []
    const devices = new Set()
    
    // Filter data by selected group (and descendants) first
    const groupFiltered = selectedGroup ? data.filter(item => {
      const selectedGroupInt = parseInt(selectedGroup)
      const allowedGroupIds = getDescendantGroupIds(selectedGroupInt, groups)
      return item.group_id && allowedGroupIds.includes(item.group_id)
    }) : data

    groupFiltered.forEach(item => {
      if (item && item.device_name) {
        devices.add(item.device_name)
      }
    })
    return Array.from(devices).sort()
  }

  // Dynamic vendor badge colors
  const renderVendorBadge = (vendor, category) => {
    if (!vendor || vendor === 'Unknown') return <span className="vendor-badge unknown">Unknown</span>
    const catClass = category || 'unknown'
    return (
      <span className={`vendor-badge ${catClass}`} title={`${vendor} (${catClass})`}>
        {vendor}
      </span>
    )
  }

  const renderVendorBadgeSimple = (vendor) => {
    if (!vendor || vendor === 'Unknown') return <span className="vendor-badge unknown">Unknown</span>
    const lower = vendor.toLowerCase()
    let cat = 'unknown'
    if (lower.includes('cisco') || lower.includes('ruckus') || lower.includes('brocade') || lower.includes('huawei') || lower.includes('juniper') || lower.includes('aruba') || lower.includes('ubiquiti') || lower.includes('mikrotik')) {
      cat = 'networking'
    } else if (lower.includes('apple') || lower.includes('samsung') || lower.includes('intel') || lower.includes('dell') || lower.includes('hp') || lower.includes('lenovo')) {
      cat = 'endpoint'
    } else if (lower.includes('xerox') || lower.includes('canon') || lower.includes('epson')) {
      cat = 'printer'
    }
    return (
      <span className={`vendor-badge ${cat}`} title={vendor}>
        {vendor}
      </span>
    )
  }

  // Global filters logic
  const filteredArp = (Array.isArray(arpData) ? arpData : []).filter(item => {
    const matchSearch = searchQuery ? (
      (item.ip_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.mac_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.mac_vendor || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.interface || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.device_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    ) : true

    const matchDevice = deviceFilter ? item.device_name === deviceFilter : true

    const selectedGroupInt = selectedGroup ? parseInt(selectedGroup) : null
    const allowedGroupIds = selectedGroupInt ? getDescendantGroupIds(selectedGroupInt, groups) : []
    const matchGroup = selectedGroup === '' || (item.group_id && allowedGroupIds.includes(item.group_id))

    return matchSearch && matchDevice && matchGroup
  })

  const filteredMac = (Array.isArray(macData) ? macData : []).filter(item => {
    const matchSearch = searchQuery ? (
      (item.mac_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.mac_vendor || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.vlan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.interface || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.entry_type || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.device_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    ) : true

    const matchDevice = deviceFilter ? item.device_name === deviceFilter : true

    const selectedGroupInt = selectedGroup ? parseInt(selectedGroup) : null
    const allowedGroupIds = selectedGroupInt ? getDescendantGroupIds(selectedGroupInt, groups) : []
    const matchGroup = selectedGroup === '' || (item.group_id && allowedGroupIds.includes(item.group_id))

    return matchSearch && matchDevice && matchGroup
  })

  const filteredLldp = (Array.isArray(lldpData) ? lldpData : []).filter(item => {
    const matchSearch = searchQuery ? (
      (item.local_port || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.neighbor_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.neighbor_ip || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.neighbor_port || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.neighbor_platform || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.neighbor_vendor || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.device_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    ) : true

    const matchDevice = deviceFilter ? item.device_name === deviceFilter : true

    const selectedGroupInt = selectedGroup ? parseInt(selectedGroup) : null
    const allowedGroupIds = selectedGroupInt ? getDescendantGroupIds(selectedGroupInt, groups) : []
    const matchGroup = selectedGroup === '' || (item.group_id && allowedGroupIds.includes(item.group_id))

    return matchSearch && matchDevice && matchGroup
  })

  const totalArp = filteredArp.length
  const totalArpPages = pageSize === 'all' ? 1 : Math.ceil(totalArp / pageSize) || 1
  const displayedArp = pageSize === 'all' 
    ? filteredArp 
    : filteredArp.slice((page - 1) * pageSize, page * pageSize)

  const totalMac = filteredMac.length
  const totalMacPages = pageSize === 'all' ? 1 : Math.ceil(totalMac / pageSize) || 1
  const displayedMac = pageSize === 'all' 
    ? filteredMac 
    : filteredMac.slice((page - 1) * pageSize, page * pageSize)

  const totalLldp = filteredLldp.length
  const totalLldpPages = pageSize === 'all' ? 1 : Math.ceil(totalLldp / pageSize) || 1
  const displayedLldp = pageSize === 'all' 
    ? filteredLldp 
    : filteredLldp.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="page-container animate-fade">
      <div className="page-header flex-between">
        <div>
          <div className="page-title">
            <Layers size={22} style={{ color: 'var(--primary)' }} />
            Investigasi Jaringan
          </div>
          <div className="page-subtitle">
            Pantau IP, ARP, LLDP, dan MAC address secara terpadu di seluruh perangkat managed.
          </div>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={handleLiveScanAll}
          disabled={scanLoading}
          style={{ gap: '8px' }}
        >
          <RefreshCw size={14} className={scanLoading ? 'spin' : ''} />
          {scanLoading ? 'Memindai Semua...' : 'Pindai Ulang Seluruh Switch (Live)'}
        </button>
      </div>

      {/* Tabs Layout */}
      <div className="tab-bar">
        <button 
          className={`tab-btn ${activeTab === 'trace' ? 'active' : ''}`}
          onClick={() => setActiveTab('trace')}
        >
          <Search size={14} />
          Lacak MAC / IP
        </button>
        <button 
          className={`tab-btn ${activeTab === 'arp' ? 'active' : ''}`}
          onClick={() => setActiveTab('arp')}
        >
          <Cpu size={14} />
          Database IP & ARP
        </button>
        <button 
          className={`tab-btn ${activeTab === 'mac' ? 'active' : ''}`}
          onClick={() => setActiveTab('mac')}
        >
          <Layers size={14} />
          Database MAC Address
        </button>
        <button 
          className={`tab-btn ${activeTab === 'lldp' ? 'active' : ''}`}
          onClick={() => setActiveTab('lldp')}
        >
          <Network size={14} />
          Database LLDP
        </button>
      </div>

      {/* Tab Content: MAC & IP Tracer */}
      {activeTab === 'trace' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
          
          {/* Search Panel Card */}
          <div className="card p-24" style={{ background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-card-2) 100%)' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} className="text-primary" /> Mulai Investigasi Port
            </div>
            <form onSubmit={handleInvestigate} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '280px' }}>
                <label className="form-label" style={{ fontSize: '12px' }}>Input MAC Address atau IP Address (Mendukung format colon, hyphen, Cisco dot, atau pencarian IP langsung)</label>
                <div style={{ position: 'relative' }}>
                  <input 
                    className="form-control font-mono" 
                    style={{ paddingRight: '40px', fontSize: '14.5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                    placeholder="Contoh: 80:DB:17:CD:7A:2E atau 192.168.1.100" 
                    value={macQuery}
                    onChange={e => setMacQuery(e.target.value)}
                    required
                    disabled={loading}
                  />
                  <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
                    {macQuery && (
                      isValidInput(macQuery) ? 
                        <CheckCircle2 size={16} className="text-success" /> : 
                        <ShieldAlert size={16} className="text-warning" title="Format input belum valid (Gunakan 12 digit hex MAC atau IP Address)" />
                    )}
                  </div>
                </div>
              </div>
              
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ height: '38px', minWidth: '130px', justifyContent: 'center' }}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: '6px' }} />
                    Mencari...
                  </>
                ) : (
                  <>
                    <Search size={14} style={{ marginRight: '6px' }} />
                    Lacak
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Results Section */}
          {result && (
            <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Top Cards: Summary Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
                
                {/* Card 1: MAC & Vendor */}
                <div className="card p-20" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '110px' }}>
                  <div>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>
                      {result.query_ip ? `MAC (dari IP ${result.query_ip})` : 'MAC & Vendor'}
                    </span>
                    <div className="font-mono text-lg font-bold text-primary" style={{ marginTop: '6px', fontSize: '16px' }}>
                      {result.query_mac}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '8px' }}>
                    {result.vendor}
                  </div>
                </div>

                {/* Card 2: IP Address */}
                <div className="card p-20" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '110px' }}>
                  <div>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>Asosiasi IP Address</span>
                    <div className="font-mono text-lg font-bold" style={{ marginTop: '6px', fontSize: '16px', color: result.arp_info.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {result.arp_info.length > 0 ? result.arp_info[0].ip_address : 'Tidak Diketahui'}
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    {result.arp_info.length > 0 
                      ? `Terdeteksi di interface ${result.arp_info[0].interface} (via ${result.arp_info[0].device_name})` 
                      : 'Tidak ada cache ARP yang cocok'}
                  </div>
                </div>

                {/* Card 3: Final Access Port / Edge Location */}
                <div className="card p-20" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '110px', borderLeft: '4px solid var(--success)', background: 'var(--success-glow)' }}>
                  <div>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--success)', fontWeight: 700, letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MapPin size={11} /> Edge Port Terkoneksi
                    </span>
                    {result.edge_port ? (
                      <div className="font-bold text-lg" style={{ marginTop: '6px', fontSize: '15px', color: 'var(--text-primary)' }}>
                        {result.edge_port.device_name} — {result.edge_port.interface}
                      </div>
                    ) : (
                      <div className="font-bold text-lg text-muted" style={{ marginTop: '6px', fontSize: '15px' }}>
                        Tidak Ditemukan
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    {result.edge_port 
                      ? `VLAN: ${result.edge_port.vlan} | Tipe: ${result.edge_port.entry_type}` 
                      : 'MAC tidak terlihat di access port perangkat managed'}
                  </div>
                </div>
              </div>

              {/* Tracer Path (Visual Path Traversal) */}
              <div className="card p-24">
                <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Network size={16} className="text-primary" /> Visualisasi Penelusuran Jalur (Tracer Path)
                </div>

                {result.locations.length === 0 ? (
                  <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    Tidak ada jalur yang bisa ditelusuri. Pastikan perangkat online dan cache MAC table aktif.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', paddingLeft: '24px' }}>
                    
                    {/* Vertical connector line */}
                    <div style={{
                      position: 'absolute',
                      left: '7px',
                      top: '12px',
                      bottom: '12px',
                      width: '2px',
                      background: 'var(--border)',
                      zIndex: 0
                    }} />

                    {result.locations.map((loc, idx) => {
                      return (
                        <div key={idx} className="animate-slide" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                          
                          {/* Dot indicator */}
                          <div style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            background: loc.is_uplink ? 'var(--border)' : 'var(--success)',
                            border: '3px solid var(--bg-card)',
                            boxShadow: loc.is_uplink ? 'none' : '0 0 8px var(--success)',
                            marginTop: '4px',
                            flexShrink: 0
                          }} />

                          {/* Node Card details */}
                          <div className="card" style={{ flex: 1, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', margin: 0, borderColor: loc.is_uplink ? 'var(--border)' : 'var(--success)' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span 
                                  onClick={() => navigate(`/device/${loc.device_id}`)}
                                  style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                                  title="Klik untuk lihat detail perangkat"
                                >
                                  {loc.device_name}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({loc.device_ip} — {loc.device_role})</span>
                                
                                <span className={`badge badge-${loc.is_uplink ? 'telnet' : 'ssh'}`} style={{ fontSize: '10px' }}>
                                  {loc.is_uplink ? 'Trunk / Uplink' : 'Access / Edge Port'}
                                </span>
                              </div>

                              <div style={{ marginTop: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                <div><strong>Port:</strong> <span className="font-mono text-primary">{loc.interface}</span></div>
                                <div><strong>VLAN:</strong> {loc.vlan}</div>
                                <div><strong>Tipe:</strong> <span style={{ textTransform: 'capitalize' }}>{loc.entry_type}</span></div>
                                <div><strong>Terakhir Dilihat:</strong> {new Date(loc.fetched_at).toLocaleString('id-ID')}</div>
                              </div>
                            </div>

                            {/* Uplink connection arrow indicator */}
                            {loc.is_uplink && loc.neighbor && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-base)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: '12px', textAlign: 'right' }}>
                                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>Menghubungkan ke</div>
                                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{loc.neighbor.neighbor_name || loc.neighbor.neighbor_ip}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Port tetangga: {loc.neighbor.neighbor_port}</div>
                                </div>
                                <ArrowRight size={16} className="text-muted" />
                              </div>
                            )}

                            {!loc.is_uplink && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16,185,129,0.1)', color: 'var(--success)', padding: '8px 12px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600 }}>
                                <CheckCircle2 size={15} /> Klien Terkoneksi Langsung Disini
                              </div>
                            )}

                          </div>

                        </div>
                      )
                    })}

                  </div>
                )}
              </div>

              {/* Detailed Table view */}
              <div className="card p-0" style={{ overflow: 'hidden' }}>
                <div className="p-24" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)' }}>Tabel Penelusuran Semua Lokasi MAC</h3>
                  <span className="badge badge-neutral">{result.locations.length} lokasi</span>
                </div>
                <div className="table-wrapper">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: '24px' }}>Nama Switch</th>
                        <th>IP Address</th>
                        <th>Port</th>
                        <th>VLAN</th>
                        <th>Status Port</th>
                        <th>Metode</th>
                        <th style={{ paddingRight: '24px' }}>Tanggal Update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.locations.map((loc, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ paddingLeft: '24px', fontWeight: 600 }}>
                            <span 
                              onClick={() => navigate(`/device/${loc.device_id}`)}
                              style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              {loc.device_name}
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>{loc.device_role}</div>
                          </td>
                          <td>{loc.device_ip}</td>
                          <td className="font-mono" style={{ fontWeight: 600 }}>{loc.interface}</td>
                          <td>{loc.vlan}</td>
                          <td>
                            <span className={`badge badge-${loc.is_uplink ? 'telnet' : 'ssh'}`}>
                              {loc.is_uplink ? 'Uplink Trunk' : 'Access (Edge)'}
                            </span>
                          </td>
                          <td style={{ textTransform: 'capitalize' }}>{loc.entry_type}</td>
                          <td style={{ paddingRight: '24px', fontSize: '12px', color: 'var(--text-muted)' }}>
                            {new Date(loc.fetched_at).toLocaleString('id-ID')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

        </div>
      )}

      {/* Tab Content: ARP Database */}
      {activeTab === 'arp' && (
        <div className="card p-0" style={{ overflow: 'hidden' }}>
          <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
              <div className="search-box" style={{ maxWidth: '320px', width: '100%' }}>
                <Search className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Cari IP, MAC, vendor, interface..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Group Filter */}
              <select 
                className="form-control" 
                style={{ width: '200px' }}
                value={selectedGroup}
                onChange={e => { setSelectedGroup(e.target.value); setDeviceFilter(''); }}
              >
                <option value="">Semua Group</option>
                {buildHierarchicalGroups(groups).map(g => (
                  <option key={g.id} value={g.id}>{g.displayName}</option>
                ))}
              </select>

              <select 
                className="form-control" 
                style={{ width: '220px' }}
                value={deviceFilter}
                onChange={e => setDeviceFilter(e.target.value)}
              >
                <option value="">Semua Perangkat</option>
                {getUniqueDevices(arpData).map(dev => (
                  <option key={dev} value={dev}>{dev}</option>
                ))}
              </select>

              {(searchQuery || deviceFilter || selectedGroup) && (
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSearchQuery(''); setDeviceFilter(''); setSelectedGroup(''); }}
                >
                  Reset Filter
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Menampilkan <strong>{filteredArp.length}</strong> dari {arpData.length} entri
              </span>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={fetchArp}
                disabled={loadingArp}
                style={{ gap: '6px' }}
              >
                <RefreshCw size={12} className={loadingArp ? 'spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {loadingArp ? (
            <div className="loading-overlay" style={{ padding: '60px' }}>
              <div className="loading-spinner" />
              <span>Memuat database ARP global...</span>
            </div>
          ) : filteredArp.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📡</div>
              <div className="empty-title">Tidak ada data ARP</div>
              <div className="empty-desc">Tidak ada entri ARP cache yang ditemukan atau cocok dengan kriteria filter.</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: '20px' }}>Perangkat Asal</th>
                      <th>IP Address</th>
                      <th>MAC Address</th>
                      <th>Interface</th>
                      <th>Vendor</th>
                      <th>Tipe</th>
                      <th>Age (Menit)</th>
                      <th style={{ paddingRight: '20px' }}>Terakhir Diupdate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedArp.map((item) => (
                      <tr key={item.id}>
                        <td style={{ paddingLeft: '20px' }}>
                          <span 
                            onClick={() => navigate(`/device/${item.device_id}`)}
                            style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            {item.device_name}
                          </span>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.device_ip}</div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700 }}>{item.ip_address}</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{item.mac_address}</td>
                        <td>{item.interface || '-'}</td>
                        <td>{renderVendorBadge(item.mac_vendor, item.device_category)}</td>
                        <td>
                          <span className={`badge badge-${item.entry_type === 'static' ? 'telnet' : 'ssh'}`}>
                            {item.entry_type}
                          </span>
                        </td>
                        <td>{item.age_minutes ?? 0}</td>
                        <td style={{ paddingRight: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {new Date(item.fetched_at).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex-between mt-16" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>
                <div className="flex-center gap-12">
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Tampilkan:</span>
                  <select
                    className="form-control"
                    style={{ width: '90px', padding: '4px 8px', fontSize: '12.5px' }}
                    value={pageSize}
                    onChange={e => {
                      const val = e.target.value
                      setPageSize(val === 'all' ? 'all' : parseInt(val))
                      setPage(1)
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                    <option value="all">Semua</option>
                  </select>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Menampilkan {pageSize === 'all' ? (totalArp > 0 ? 1 : 0) : (totalArp > 0 ? (page - 1) * pageSize + 1 : 0)} s.d. {pageSize === 'all' ? totalArp : Math.min(page * pageSize, totalArp)} dari {totalArp} entri
                  </span>
                </div>
                
                {pageSize !== 'all' && totalArpPages > 1 && (
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.max(p - 1, 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft size={14} /> Sebelum
                    </button>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {page} dari {totalArpPages}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.min(p + 1, totalArpPages))}
                      disabled={page === totalArpPages}
                    >
                      Berikut <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab Content: MAC Address Database */}
      {activeTab === 'mac' && (
        <div className="card p-0" style={{ overflow: 'hidden' }}>
          <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
              <div className="search-box" style={{ maxWidth: '320px', width: '100%' }}>
                <Search className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Cari MAC, VLAN, port, vendor..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Group Filter */}
              <select 
                className="form-control" 
                style={{ width: '200px' }}
                value={selectedGroup}
                onChange={e => { setSelectedGroup(e.target.value); setDeviceFilter(''); }}
              >
                <option value="">Semua Group</option>
                {buildHierarchicalGroups(groups).map(g => (
                  <option key={g.id} value={g.id}>{g.displayName}</option>
                ))}
              </select>

              <select 
                className="form-control" 
                style={{ width: '220px' }}
                value={deviceFilter}
                onChange={e => setDeviceFilter(e.target.value)}
              >
                <option value="">Semua Perangkat</option>
                {getUniqueDevices(macData).map(dev => (
                  <option key={dev} value={dev}>{dev}</option>
                ))}
              </select>

              {(searchQuery || deviceFilter || selectedGroup) && (
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSearchQuery(''); setDeviceFilter(''); setSelectedGroup(''); }}
                >
                  Reset Filter
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Menampilkan <strong>{filteredMac.length}</strong> dari {macData.length} entri
              </span>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={fetchMac}
                disabled={loadingMac}
                style={{ gap: '6px' }}
              >
                <RefreshCw size={12} className={loadingMac ? 'spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {loadingMac ? (
            <div className="loading-overlay" style={{ padding: '60px' }}>
              <div className="loading-spinner" />
              <span>Memuat database MAC Address...</span>
            </div>
          ) : filteredMac.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-title">Tidak ada data MAC</div>
              <div className="empty-desc">Tidak ada entri MAC address yang ditemukan atau cocok dengan kriteria filter.</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: '20px' }}>Perangkat Asal</th>
                      <th>VLAN</th>
                      <th>MAC Address</th>
                      <th>Port / Interface</th>
                      <th>Vendor</th>
                      <th>Tipe</th>
                      <th style={{ paddingRight: '20px' }}>Terakhir Diupdate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedMac.map((item) => (
                      <tr key={item.id}>
                        <td style={{ paddingLeft: '20px' }}>
                          <span 
                            onClick={() => navigate(`/device/${item.device_id}`)}
                            style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            {item.device_name}
                          </span>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.device_ip}</div>
                        </td>
                        <td>{item.vlan || '1'}</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{item.mac_address}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{item.interface}</td>
                        <td>{renderVendorBadgeSimple(item.mac_vendor)}</td>
                        <td>
                          <span className={`badge badge-${item.entry_type === 'static' ? 'telnet' : 'ssh'}`}>
                            {item.entry_type}
                          </span>
                        </td>
                        <td style={{ paddingRight: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {new Date(item.fetched_at).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex-between mt-16" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>
                <div className="flex-center gap-12">
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Tampilkan:</span>
                  <select
                    className="form-control"
                    style={{ width: '90px', padding: '4px 8px', fontSize: '12.5px' }}
                    value={pageSize}
                    onChange={e => {
                      const val = e.target.value
                      setPageSize(val === 'all' ? 'all' : parseInt(val))
                      setPage(1)
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                    <option value="all">Semua</option>
                  </select>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Menampilkan {pageSize === 'all' ? (totalMac > 0 ? 1 : 0) : (totalMac > 0 ? (page - 1) * pageSize + 1 : 0)} s.d. {pageSize === 'all' ? totalMac : Math.min(page * pageSize, totalMac)} dari {totalMac} entri
                  </span>
                </div>
                
                {pageSize !== 'all' && totalMacPages > 1 && (
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.max(p - 1, 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft size={14} /> Sebelum
                    </button>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {page} dari {totalMacPages}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.min(p + 1, totalMacPages))}
                      disabled={page === totalMacPages}
                    >
                      Berikut <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab Content: LLDP Database */}
      {activeTab === 'lldp' && (
        <div className="card p-0" style={{ overflow: 'hidden' }}>
          <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
              <div className="search-box" style={{ maxWidth: '320px', width: '100%' }}>
                <Search className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Cari port, neighbor, IP tetangga..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Group Filter */}
              <select 
                className="form-control" 
                style={{ width: '200px' }}
                value={selectedGroup}
                onChange={e => { setSelectedGroup(e.target.value); setDeviceFilter(''); }}
              >
                <option value="">Semua Group</option>
                {buildHierarchicalGroups(groups).map(g => (
                  <option key={g.id} value={g.id}>{g.displayName}</option>
                ))}
              </select>

              <select 
                className="form-control" 
                style={{ width: '220px' }}
                value={deviceFilter}
                onChange={e => setDeviceFilter(e.target.value)}
              >
                <option value="">Semua Perangkat</option>
                {getUniqueDevices(lldpData).map(dev => (
                  <option key={dev} value={dev}>{dev}</option>
                ))}
              </select>

              {(searchQuery || deviceFilter || selectedGroup) && (
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setSearchQuery(''); setDeviceFilter(''); setSelectedGroup(''); }}
                >
                  Reset Filter
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Menampilkan <strong>{filteredLldp.length}</strong> dari {lldpData.length} entri
              </span>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={fetchLldp}
                disabled={loadingLldp}
                style={{ gap: '6px' }}
              >
                <RefreshCw size={12} className={loadingLldp ? 'spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {loadingLldp ? (
            <div className="loading-overlay" style={{ padding: '60px' }}>
              <div className="loading-spinner" />
              <span>Memuat database LLDP neighbors...</span>
            </div>
          ) : filteredLldp.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔗</div>
              <div className="empty-title">Tidak ada data LLDP</div>
              <div className="empty-desc">Tidak ada data tetangga LLDP yang ditemukan atau cocok dengan kriteria filter.</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: '20px' }}>Perangkat Asal</th>
                      <th>Port Lokal</th>
                      <th>Nama Tetangga (Neighbor)</th>
                      <th>IP Tetangga</th>
                      <th>Port Tetangga</th>
                      <th>Platform</th>
                      <th>Vendor Tetangga</th>
                      <th style={{ paddingRight: '20px' }}>Terakhir Diupdate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLldp.map((item) => (
                      <tr key={item.id}>
                        <td style={{ paddingLeft: '20px' }}>
                          <span 
                            onClick={() => navigate(`/device/${item.device_id}`)}
                            style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            {item.device_name}
                          </span>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.device_ip}</div>
                        </td>
                        <td className="mono" style={{ fontWeight: 700 }}>{item.local_port}</td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.neighbor_name || '-'}</td>
                        <td className="mono">{item.neighbor_ip || '-'}</td>
                        <td className="mono">{item.neighbor_port || '-'}</td>
                        <td>{item.neighbor_platform || '-'}</td>
                        <td>{renderVendorBadge(item.neighbor_vendor, item.device_category)}</td>
                        <td style={{ paddingRight: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {new Date(item.fetched_at).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex-between mt-16" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>
                <div className="flex-center gap-12">
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>Tampilkan:</span>
                  <select
                    className="form-control"
                    style={{ width: '90px', padding: '4px 8px', fontSize: '12.5px' }}
                    value={pageSize}
                    onChange={e => {
                      const val = e.target.value
                      setPageSize(val === 'all' ? 'all' : parseInt(val))
                      setPage(1)
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                    <option value="all">Semua</option>
                  </select>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Menampilkan {pageSize === 'all' ? (totalLldp > 0 ? 1 : 0) : (totalLldp > 0 ? (page - 1) * pageSize + 1 : 0)} s.d. {pageSize === 'all' ? totalLldp : Math.min(page * pageSize, totalLldp)} dari {totalLldp} entri
                  </span>
                </div>
                
                {pageSize !== 'all' && totalLldpPages > 1 && (
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.max(p - 1, 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft size={14} /> Sebelum
                    </button>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {page} dari {totalLldpPages}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage(p => Math.min(p + 1, totalLldpPages))}
                      disabled={page === totalLldpPages}
                    >
                      Berikut <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}
