import { useEffect, useState, useRef } from 'react'
import { Network } from 'vis-network'
import { topologyApi, groupsApi } from '../api/client'
import { RefreshCcw, LayoutTemplate, Save } from 'lucide-react'
import { useToast } from '../components/shared/ToastProvider'

export default function Topology() {
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedNode, setSelectedNode] = useState(null)
  
  const toast = useToast()

  // Fetch groups for the filter dropdown
  useEffect(() => {
    groupsApi.list().then(res => setGroups(res.data)).catch(() => {})
  }, [])

  const fetchTopology = async () => {
    setLoading(true)
    setSelectedNode(null)
    try {
      const res = await topologyApi.get(selectedGroup || undefined)
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
        if (n.device_type?.includes('router') || n.device_type?.includes('vyos')) iconPath = '/assets/icons/router.svg'
        if (n.device_type?.includes('asa') || n.device_type?.includes('fortinet') || n.device_type?.includes('paloalto')) iconPath = '/assets/icons/firewall.svg'
        
        const isOffline = n.status === 'offline'
        
        return {
          ...n,
          shape: 'image',
          image: iconPath,
          shapeProperties: { useBorderWithImage: true },
          color: { 
            border: isOffline ? '#ef4444' : '#4f8ef7',
            background: isOffline ? 'rgba(239,68,68,0.2)' : 'transparent'
          },
          font: { color: isOffline ? '#ef4444' : '#e6edf3', background: 'rgba(0,0,0,0.6)', size: 12 },
          borderWidth: isOffline ? 3 : 0,
        }
      } else {
        return {
          ...n,
          color: { background: '#1a2235', border: '#4b6180' },
          font: { color: '#94a3b8', size: 10 },
          shape: 'ellipse',
        }
      }
    })

    const styledEdges = data.edges.map(e => ({
      ...e,
      font: { color: '#8b949e', size: 10, align: 'middle' },
      color: { color: '#484f58', highlight: '#58a6ff' },
      arrows: { to: { enabled: false } },
      smooth: { type: 'continuous' }
    }))

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
        }
      } else {
        setSelectedNode(null)
      }
    })
    
    // Once stabilized or dragged, we can optionally stop physics to let it rest
    networkRef.current.on("dragEnd", function (params) {
      if (params.nodes.length > 0) {
        networkRef.current.setOptions({ physics: false })
      }
    })
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

  return (
    <div className="page-container animate-fade" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '20px' }}>
      {/* Top Bar Controls */}
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 className="page-title">
            <LayoutTemplate size={20} style={{ color: 'var(--primary)' }} /> Network Topology
          </h1>
          <select 
            className="form-control" 
            style={{ width: '200px' }}
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
          <button className="btn btn-ghost" onClick={handleSaveLayout} disabled={saving || loading}>
            <Save size={16} /> {saving ? 'Menyimpan...' : 'Save Layout'}
          </button>
          <button className="btn btn-primary" onClick={fetchTopology} disabled={loading}>
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Network Canvas */}
      <div style={{ 
        flex: 1, 
        position: 'relative', 
        backgroundColor: '#070b14', 
        backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        borderRadius: '12px', 
        border: '1px solid var(--border)', 
        overflow: 'hidden' 
      }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <span className="loading-spinner" style={{ width: '40px', height: '40px' }} />
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Membangun Topologi...</span>
            </div>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Node Detail Popup Overlay */}
        {selectedNode && (
          <div className="card animate-slide" style={{ position: 'absolute', bottom: '24px', right: '24px', width: '320px', zIndex: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>{selectedNode.label}</h3>
              <button 
                className="btn-close"
                onClick={() => setSelectedNode(null)}
              >
                ✕
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>IP Address</span>
                <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--primary)' }}>{selectedNode.ip || 'Unknown'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Kategori</span>
                <span style={{ textTransform: 'capitalize' }}>{selectedNode.group}</span>
              </div>
              {selectedNode.title && (
                <div style={{ marginTop: '8px', padding: '12px', background: 'var(--bg-hover)', borderRadius: '8px' }}>
                  <div dangerouslySetInnerHTML={{ __html: selectedNode.title }} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
