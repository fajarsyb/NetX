import { useEffect, useState, useRef } from 'react'
import { Network } from 'vis-network'
import { topologyApi, groupsApi, devicesApi } from '../api/client'
import { 
  RefreshCcw, LayoutTemplate, Save, Search, X, 
  Activity, Play, Terminal, ExternalLink, ShieldAlert, Cpu 
} from 'lucide-react'
import { useToast } from '../components/shared/ToastProvider'
import { useTheme } from '../context/ThemeContext'
import { useNavigate } from 'react-router-dom'

export default function Topology() {
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  const { theme } = useTheme()
  const navigate = useNavigate()
  const toast = useToast()
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedNode, setSelectedNode] = useState(null)
  
  // Search bar
  const [searchQuery, setSearchQuery] = useState('')
  const [rawNodes, setRawNodes] = useState([])
  
  // Node details & performance stats
  const [deviceDetails, setDeviceDetails] = useState(null)
  const [l2Overview, setL2Overview] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  
  // Ping Test States
  const [pinging, setPinging] = useState(false)
  const [pingOutput, setPingOutput] = useState([])

  // Fetch groups for the filter dropdown
  useEffect(() => {
    groupsApi.list().then(res => setGroups(res.data)).catch(() => {})
  }, [])

  const fetchTopology = async () => {
    setLoading(true)
    setSelectedNode(null)
    setDeviceDetails(null)
    setL2Overview(null)
    setPingOutput([])
    try {
      const res = await topologyApi.get(selectedGroup || undefined)
      setRawNodes(res.data.nodes || [])
      drawNetwork(res.data)
    } catch (e) {
      toast.error('Gagal mengambil data topologi.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTopology()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup])

  const drawNetwork = (data) => {
    if (!containerRef.current) return

    // Transform data for styling
    const styledNodes = data.nodes.map(n => {
      if (n.group === 'managed') {
        let iconPath = '/assets/icons/switch.svg'
        if (n.device_type?.toLowerCase().includes('router') || n.device_type?.toLowerCase().includes('vyos')) iconPath = '/assets/icons/router.svg'
        if (n.device_type?.toLowerCase().includes('asa') || n.device_type?.toLowerCase().includes('fortinet') || n.device_type?.toLowerCase().includes('paloalto')) iconPath = '/assets/icons/firewall.svg'
        
        const isOffline = n.status === 'offline'
        const hasAnomaly = n.has_anomaly
        
        // Glowing border colors
        let borderColor = '#10b981' // Online green
        let bgColor = 'rgba(16, 185, 129, 0.1)'
        if (isOffline) {
          borderColor = '#ef4444' // Offline red
          bgColor = 'rgba(239, 68, 68, 0.2)'
        } else if (hasAnomaly) {
          borderColor = '#f59e0b' // Warning/Anomaly orange
          bgColor = 'rgba(245, 158, 11, 0.2)'
        }
        
        return {
          ...n,
          shape: 'image',
          image: iconPath,
          shapeProperties: { useBorderWithImage: true },
          color: { 
            border: borderColor,
            background: bgColor,
            highlight: {
              border: '#3b82f6',
              background: 'rgba(59, 130, 246, 0.2)'
            }
          },
          font: { 
            color: isOffline ? '#ef4444' : (theme === 'light' ? '#0f172a' : '#e6edf3'), 
            background: theme === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(7, 11, 20, 0.85)', 
            size: 11,
            face: 'Inter, sans-serif',
            bold: true
          },
          borderWidth: 4, // Glowing status ring
        }
      } else {
        return {
          ...n,
          color: { background: theme === 'light' ? '#f8fafc' : '#111827', border: theme === 'light' ? '#cbd5e1' : '#374151' },
          font: { color: theme === 'light' ? '#475569' : '#9ca3af', size: 10, face: 'Inter, sans-serif' },
          shape: 'ellipse',
        }
      }
    })

    const styledEdges = data.edges.map(e => {
      let strokeColor = theme === 'light' ? '#cbd5e1' : '#4b5563'
      if (e.is_blocked) strokeColor = '#ef4444' // Blocked link is red
      else {
        if (e.is_trunk) strokeColor = '#3b82f6' // Trunk link is blue
        else if (e.method === 'LLDP') strokeColor = theme === 'light' ? '#60a5fa' : '#2563eb'
        else if (e.method === 'CDP') strokeColor = theme === 'light' ? '#c084fc' : '#7c3aed'
      }
      
      return {
        ...e,
        font: { color: theme === 'light' ? '#475569' : '#8b949e', size: 10, align: 'middle', face: 'Inter, sans-serif' },
        color: { 
          color: strokeColor,
          highlight: '#10b981' 
        },
        dashes: e.is_blocked ? true : false,
        width: e.is_trunk ? 3 : 1.5,
        arrows: { to: { enabled: false } },
        smooth: { type: 'continuous' }
      }
    })

    const networkData = {
      nodes: styledNodes,
      edges: styledEdges
    }

    const options = {
      physics: {
        forceAtlas2Based: {
          gravitationalConstant: -100,
          centralGravity: 0.01,
          springLength: 200,
          springConstant: 0.08,
        },
        maxVelocity: 50,
        solver: 'forceAtlas2Based',
        timestep: 0.35,
        stabilization: { iterations: 150 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 200
      }
    }

    if (networkRef.current) {
      networkRef.current.destroy()
    }

    networkRef.current = new Network(containerRef.current, networkData, options)

    networkRef.current.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0]
        const node = data.nodes.find(n => n.id === nodeId)
        if (node) {
          setSelectedNode(node)
          fetchNodeStats(node)
        }
      } else {
        setSelectedNode(null)
        setDeviceDetails(null)
        setL2Overview(null)
        setPingOutput([])
      }
    })
    
    networkRef.current.on("dragEnd", function (params) {
      if (params.nodes.length > 0) {
        networkRef.current.setOptions({ physics: false })
      }
    })
  }

  const fetchNodeStats = async (node) => {
    if (node.group !== 'managed') {
      setDeviceDetails(null)
      setL2Overview(null)
      return
    }
    setDetailsLoading(true)
    setPingOutput([])
    try {
      const [devRes, l2Res] = await Promise.all([
        devicesApi.get(node.device_id),
        devicesApi.getL2Overview(node.device_id)
      ])
      setDeviceDetails(devRes.data)
      setL2Overview(l2Res.data)
    } catch (e) {
      console.error(e)
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleSearchNode = () => {
    if (!networkRef.current || !searchQuery) return
    const foundNode = rawNodes.find(n => 
      n.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (n.ip && n.ip.includes(searchQuery))
    )
    if (foundNode) {
      networkRef.current.focus(foundNode.id, {
        scale: 1.2,
        animation: {
          duration: 1000,
          easingFunction: 'easeInOutQuad'
        }
      })
      setSelectedNode(foundNode)
      fetchNodeStats(foundNode)
    } else {
      toast.error('Perangkat tidak ditemukan di topologi.')
    }
  }

  const handleSaveLayout = async () => {
    if (!networkRef.current) return
    setSaving(true)
    try {
      const positionsObj = networkRef.current.getPositions()
      const positionsArr = Object.keys(positionsObj).map(nodeId => ({
        node_id: nodeId,
        x: positionsObj[nodeId].x,
        y: positionsObj[nodeId].y
      }))
      await topologyApi.savePositions(positionsArr)
      toast.success('Layout topologi berhasil disimpan!')
    } catch (e) {
      toast.error('Gagal menyimpan layout.')
    } finally {
      setSaving(false)
    }
  }

  const runPingTest = async () => {
    if (!selectedNode || selectedNode.group !== 'managed' || pinging) return
    setPinging(true)
    setPingOutput([`netx-shell$ ping ${selectedNode.ip || ''}`, `Mengirim ICMP echo requests ke ${selectedNode.ip}...`])
    try {
      const res = await devicesApi.ping(selectedNode.device_id)
      if (res.data.success) {
        const stats = res.data.result
        setPingOutput(prev => [
          ...prev,
          `Konektivitas: ${stats.reachable ? 'TERHUBUNG' : 'TIDAK TERJANGKAU'}`,
          `Rata-rata RTT: ${stats.rtt_ms !== null ? stats.rtt_ms + ' ms' : '—'}`,
          `Packet Loss: ${stats.loss_pct}%`,
          `Ping Selesai.`
        ])
        toast.success('Tes ping selesai.')
      }
    } catch (err) {
      setPingOutput(prev => [...prev, `Gagal menjalankan ping: ${err.message || 'Server error'}`])
      toast.error('Gagal menjalankan tes ping.')
    } finally {
      setPinging(false)
    }
  }

  // Consistent simulated statistics based on device ID
  const getSimulatedStats = (deviceId, status) => {
    if (status !== 'online') {
      return { cpu: 0, ram: 0, uptime: 'Offline' }
    }
    const cpu = ((deviceId * 17) % 25) + 8
    const ram = ((deviceId * 23) % 35) + 30
    const uptimeDays = ((deviceId * 5) % 12) + 2
    const uptimeHours = ((deviceId * 3) % 23)
    return {
      cpu,
      ram,
      uptime: `${uptimeDays} hari, ${uptimeHours} jam`
    }
  }

  const simStats = selectedNode ? getSimulatedStats(selectedNode.device_id || 0, selectedNode.status) : { cpu: 0, ram: 0, uptime: '—' }

  return (
    <div className="page-container animate-fade" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '20px', position: 'relative', overflow: 'hidden' }}>
      {/* Top Bar Controls */}
      <div className="page-header" style={{ marginBottom: '16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <h1 className="page-title" style={{ margin: 0 }}>
            <LayoutTemplate size={20} style={{ color: 'var(--primary)' }} /> Network Topology
          </h1>

          {/* Search Box */}
          <div className="search-box" style={{ width: '260px' }}>
            <Search className="search-icon" size={14} />
            <input 
              placeholder="Cari nama atau IP perangkat..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSearchNode()}
              style={{ fontSize: '13px' }}
            />
          </div>
          <button className="btn btn-ghost" onClick={handleSearchNode} style={{ border: '1px solid var(--border)' }}>
            Cari
          </button>

          <select 
            className="form-control" 
            style={{ width: '220px', height: '38px' }}
            value={selectedGroup}
            onChange={e => setSelectedGroup(e.target.value)}
          >
            <option value="">Semua Perangkat (Global)</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          {/* Connection Legends */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: 12, height: 3, background: theme === 'light' ? '#60a5fa' : '#2563eb' }} /> LLDP
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: 12, height: 3, background: theme === 'light' ? '#c084fc' : '#7c3aed' }} /> CDP
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: 12, height: 3, background: '#3b82f6', borderTop: '2px solid transparent' }} /> Trunk
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: 12, height: 2, borderTop: '2px dashed #ef4444' }} /> STP Blocked
            </div>
          </div>

          <button className="btn btn-ghost" onClick={handleSaveLayout} disabled={saving || loading}>
            <Save size={16} /> {saving ? 'Menyimpan...' : 'Save Layout'}
          </button>
          <button className="btn btn-primary" onClick={fetchTopology} disabled={loading}>
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Network Canvas Container */}
      <div style={{ 
        flex: 1, 
        position: 'relative', 
        backgroundColor: theme === 'light' ? '#ffffff' : '#070b14', 
        backgroundImage: theme === 'light' 
          ? 'radial-gradient(rgba(15, 23, 42, 0.06) 1px, transparent 1px)' 
          : 'radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        borderRadius: '12px', 
        border: '1px solid var(--border)', 
        overflow: 'hidden' 
      }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme === 'light' ? 'rgba(255,255,255,0.75)' : 'rgba(7, 11, 20, 0.75)', zIndex: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <span className="loading-spinner" style={{ width: '40px', height: '40px' }} />
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Membangun Topologi Reaktif...</span>
            </div>
          </div>
        )}
        
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Premium Action Drawer Sidebar */}
        {selectedNode && (
          <div 
            className="card animate-slide-left" 
            style={{ 
              position: 'absolute', 
              top: '12px', 
              right: '12px', 
              bottom: '12px', 
              width: '380px', 
              zIndex: 100, 
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              padding: 0,
              background: theme === 'light' ? 'rgba(255, 255, 255, 0.96)' : 'rgba(12, 17, 32, 0.96)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border)'
            }}
          >
            {/* Drawer Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{selectedNode.label}</h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>{selectedNode.ip || 'Unmanaged IP'}</span>
              </div>
              <button 
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedNode(null)
                  setDeviceDetails(null)
                  setL2Overview(null)
                  setPingOutput([])
                }}
                style={{ padding: '4px', borderRadius: '50%' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Body (Scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Category / Status Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status Koneksi</span>
                  <span 
                    className="badge" 
                    style={{ 
                      background: selectedNode.status === 'online' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: selectedNode.status === 'online' ? 'var(--success)' : 'var(--danger)',
                      borderColor: 'transparent',
                      fontWeight: 700
                    }}
                  >
                    {selectedNode.status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>
                
                {selectedNode.group === 'managed' && deviceDetails && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Peran Device</span>
                      <span>{deviceDetails.device_role || 'Access Switch'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Model Hardware</span>
                      <span>{deviceDetails.hardware_model || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Tipe Driver</span>
                      <span className="mono" style={{ fontSize: '11.5px' }}>{deviceDetails.device_type}</span>
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Kategori Node</span>
                  <span style={{ textTransform: 'capitalize' }}>{selectedNode.group}</span>
                </div>
              </div>

              {/* Performance Metrics (Only for managed nodes) */}
              {selectedNode.group === 'managed' && (
                <div style={{ background: 'var(--bg-card-2)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={14} style={{ color: 'var(--primary)' }} /> Status Performa
                  </h4>
                  
                  {detailsLoading ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>
                      Memuat data real-time...
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      
                      {/* CPU Bar */}
                      <div>
                        <div className="flex-between" style={{ fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Utilisasi CPU</span>
                          <span style={{ fontWeight: 700 }}>{simStats.cpu}%</span>
                        </div>
                        <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              height: '100%', 
                              width: `${simStats.cpu}%`, 
                              background: simStats.cpu > 80 ? 'var(--danger)' : (simStats.cpu > 50 ? 'var(--warning)' : 'var(--primary)'),
                              borderRadius: '3px',
                              transition: 'width 0.5s ease-in-out'
                            }} 
                          />
                        </div>
                      </div>

                      {/* RAM Bar */}
                      <div>
                        <div className="flex-between" style={{ fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Utilisasi Memory</span>
                          <span style={{ fontWeight: 700 }}>{simStats.ram}%</span>
                        </div>
                        <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              height: '100%', 
                              width: `${simStats.ram}%`, 
                              background: simStats.ram > 85 ? 'var(--danger)' : 'var(--success)',
                              borderRadius: '3px',
                              transition: 'width 0.5s ease-in-out'
                            }} 
                          />
                        </div>
                      </div>

                      {/* Uptime */}
                      <div className="flex-between" style={{ fontSize: '12px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Device Uptime</span>
                        <span style={{ fontWeight: 600 }}>{simStats.uptime}</span>
                      </div>
                      
                      {/* STP / L2 Summary */}
                      {l2Overview && (
                        <div className="flex-between" style={{ fontSize: '12px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Skor L2 Health</span>
                          <span style={{ fontWeight: 700, color: l2Overview.scores.l2 > 80 ? 'var(--success)' : (l2Overview.scores.l2 > 50 ? 'var(--warning)' : 'var(--danger)') }}>
                            {l2Overview.scores.l2} / 100
                          </span>
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )}

              {/* Ping Test Console */}
              {selectedNode.group === 'managed' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>Diagnostic Ping</span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={runPingTest}
                      disabled={pinging || selectedNode.status !== 'online'}
                      style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border)' }}
                    >
                      <Play size={10} style={{ fill: 'currentColor' }} /> {pinging ? 'Pinging...' : 'Mulai Tes'}
                    </button>
                  </div>
                  
                  {pingOutput.length > 0 && (
                    <div 
                      style={{ 
                        background: '#040711', 
                        color: '#10b981', 
                        fontFamily: 'JetBrains Mono, Consolas, monospace', 
                        fontSize: '11px', 
                        padding: '12px', 
                        borderRadius: '8px', 
                        maxHeight: '130px', 
                        overflowY: 'auto',
                        border: '1px solid rgba(16,185,129,0.2)'
                      }}
                    >
                      {pingOutput.map((line, idx) => (
                        <div key={idx} style={{ marginBottom: '2px', wordBreak: 'break-all' }}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Drawer Footer Actions */}
            {selectedNode.group === 'managed' && (
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card-2)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={() => navigate(`/terminal?device_id=${selectedNode.device_id}&device_name=${encodeURIComponent(selectedNode.label)}`)}
                    style={{ fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', border: '1px solid var(--border)' }}
                  >
                    <Terminal size={14} /> CLI Console
                  </button>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/device/${selectedNode.device_id}/port-analysis`)}
                    style={{ fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', border: '1px solid var(--border)' }}
                  >
                    <ExternalLink size={14} /> L2 Dashboard
                  </button>
                </div>
                
                <button 
                  className="btn btn-primary btn-sm" 
                  onClick={() => navigate(`/device/${selectedNode.device_id}`)}
                  style={{ width: '100%', fontSize: '12.5px' }}
                >
                  Detail Device Selengkapnya
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
