import { useState, useEffect } from 'react'
import { 
  FileCode, Upload, Trash2, Eye, CheckCircle, XCircle, Info, RefreshCw, X, Search, 
  ToggleLeft, ToggleRight, ChevronRight, ChevronDown, Folder, Cpu, 
  ArrowLeft, Save, RotateCcw, Layers, ChevronLeft
} from 'lucide-react'
import { mibsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

const SUPPORTED_VENDORS = [
  { value: 'all', label: 'Semua Vendor (Global)' },
  { value: 'cisco_ios', label: 'Cisco IOS' },
  { value: 'cisco_xe', label: 'Cisco XE' },
  { value: 'cisco_nxos', label: 'Cisco NX-OS' },
  { value: 'cisco_asa', label: 'Cisco ASA' },
  { value: 'juniper_junos', label: 'Juniper Junos' },
  { value: 'allied_telesis', label: 'Allied Telesis AW+' },
  { value: 'ruijie_os', label: 'Ruijie RGOS' },
  { value: 'ruckus_fastiron', label: 'Ruckus FastIron' },
  { value: 'mikrotik_routeros', label: 'MikroTik RouterOS' },
  { value: 'huawei', label: 'Huawei VRP' },
  { value: 'hp_procurve', label: 'HP ProCurve' },
  { value: 'hp_comware', label: 'HP Comware' },
  { value: 'fortinet', label: 'Fortinet FortiOS' },
  { value: 'aruba_os', label: 'ArubaOS' },
  { value: 'extreme_exos', label: 'Extreme EXOS' },
  { value: 'dell_os10', label: 'Dell OS10' },
  { value: 'paloalto_panos', label: 'Palo Alto PAN-OS' },
  { value: 'vyos', label: 'VyOS' }
]

// Interactive tree node component
function MibTreeNode({ node, selectedNodeId, onSelect, expandedKeys, onToggleExpand }) {
  const isExpanded = expandedKeys[node.name] || false;
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNodeId === node.id;

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(node.name);
  };

  const handleSelect = () => {
    if (!node.isMibRoot) {
      onSelect(node);
    }
  };

  return (
    <div className="tree-node" style={{ paddingLeft: node.isMibRoot ? '0' : '14px' }}>
      <div 
        className={`tree-node-content ${isSelected ? 'selected' : ''}`}
        onClick={handleSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px',
          borderRadius: '6px',
          cursor: node.isMibRoot ? 'default' : 'pointer',
          background: isSelected ? 'var(--primary-dim)' : 'transparent',
          borderLeft: isSelected ? '3px solid var(--primary)' : 'none',
          color: isSelected ? 'var(--primary-bright)' : 'var(--text-primary)',
          fontSize: '13px',
          margin: '2px 0',
          transition: 'all 0.15s'
        }}
      >
        {hasChildren ? (
          <button 
            type="button"
            onClick={handleToggle}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '2px',
              marginRight: '6px',
              display: 'flex',
              alignItems: 'center',
              transform: isExpanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s'
            }}
          >
            <ChevronRight size={14} />
          </button>
        ) : (
          <div style={{ width: '20px' }} />
        )}
        
        {/* Icon representation */}
        {node.isMibRoot ? (
          <FileCode size={15} style={{ color: 'var(--primary)', marginRight: '8px' }} />
        ) : hasChildren ? (
          <Folder size={15} style={{ color: '#d97706', marginRight: '8px' }} />
        ) : (
          <Cpu size={15} style={{ color: 'var(--success)', marginRight: '8px' }} />
        )}

        <span style={{ 
          fontWeight: hasChildren || node.isMibRoot ? '600' : '400', 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          color: isSelected ? 'var(--primary-bright)' : (node.isMibRoot ? 'var(--text-primary)' : 'var(--text-primary)')
        }}>
          {node.name}
          {!node.isMibRoot && node.syntax && (
            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginLeft: '6px', fontStyle: 'italic', fontWeight: 'normal' }}>
              ({node.syntax})
            </span>
          )}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div className="tree-node-children" style={{ borderLeft: '1px dashed var(--border)', marginLeft: '8px' }}>
          {node.children.map(child => (
            <MibTreeNode 
              key={child.id || child.name}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MibManagement() {
  const [mibs, setMibs] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Upload state
  const [file, setFile] = useState(null)
  const [desc, setDesc] = useState('')
  const [vendor, setVendor] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  // Selected MIB & objects state
  const [selectedMib, setSelectedMib] = useState(null)
  const [objects, setObjects] = useState([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [searchObj, setSearchObj] = useState('')
  
  // Tree & expansion states
  const [expandedKeys, setExpandedKeys] = useState({})
  
  // Selected Tree Node (MIB Object) form states
  const [selectedNode, setSelectedNode] = useState(null)
  const [isDirty, setIsDirty] = useState(false)
  const [formState, setFormState] = useState({
    name: '',
    parent: '',
    kind: 'Single',
    oid: '',
    syntax: '',
    is_unsigned: 0,
    is_64bit: 0,
    is_float: 0,
    unit: 'Custom',
    unit_custom: '',
    indicator: '',
    scale: 1.0,
    scale_mode: 'Divide',
    description: '',
    lookup: ''
  })

  // Search and Pagination for MIB List
  const limit = 20
  const [searchMib, setSearchMib] = useState('')
  const [pageMib, setPageMib] = useState(1)

  useEffect(() => {
    setPageMib(1)
  }, [searchMib])

  const toast = useToast()
  const { user } = useAuth()
  const isViewer = user?.role === 'viewer'

  const fetchMibs = async () => {
    setLoading(true)
    try {
      const res = await mibsApi.list()
      setMibs(res.data)
    } catch (err) {
      toast.error('Gagal memuat daftar MIB.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMibs()
  }, [])

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleUploadMib = async (e) => {
    e.preventDefault()
    if (isViewer || uploading) return
    if (!file) {
      toast.error('Pilih berkas MIB terlebih dahulu.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('description', desc)
    formData.append('vendor', vendor)

    setUploading(true)
    try {
      const res = await mibsApi.import(formData)
      if (res.data.success) {
        toast.success(res.data.message)
        setFile(null)
        setDesc('')
        setVendor('all')
        fetchMibs()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengimpor berkas MIB.')
    } finally {
      setUploading(false)
    }
  }

  const handleToggleMib = async (mib) => {
    if (isViewer) return
    const newStatus = mib.is_active === 1 ? 0 : 1
    try {
      await mibsApi.update(mib.id, { is_active: newStatus })
      toast.success(`MIB "${mib.name}" ${newStatus === 1 ? 'diaktifkan' : 'dinonaktifkan'}.`)
      setMibs(prev => prev.map(m => m.id === mib.id ? { ...m, is_active: newStatus } : m))
    } catch (err) {
      toast.error('Gagal mengubah status MIB.')
    }
  }

  const handleUpdateMibVendor = async (mibId, newVendor) => {
    if (isViewer) return
    try {
      await mibsApi.update(mibId, { vendor: newVendor })
      toast.success('Asosiasi vendor berhasil diperbarui.')
      setMibs(prev => prev.map(m => m.id === mibId ? { ...m, vendor: newVendor } : m))
    } catch (err) {
      toast.error('Gagal memperbarui vendor MIB.')
    }
  }

  const handleDeleteMib = async (mib) => {
    if (isViewer) return
    if (!confirm(`Apakah Anda yakin ingin menghapus MIB "${mib.name}" beserta seluruh objek OID di dalamnya?`)) return
    try {
      await mibsApi.remove(mib.id)
      toast.success(`MIB "${mib.name}" berhasil dihapus.`)
      fetchMibs()
      if (selectedMib?.id === mib.id) {
        setSelectedMib(null)
      }
    } catch (err) {
      toast.error('Gagal menghapus MIB.')
    }
  }

  const handleOpenObjects = async (mib) => {
    setSelectedMib(mib)
    setLoadingObjects(true)
    setSearchObj('')
    setSelectedNode(null)
    setExpandedKeys({ [mib.name]: true }) // expand root by default
    try {
      const res = await mibsApi.listObjects(mib.id)
      setObjects(res.data)
    } catch (err) {
      toast.error('Gagal memuat objek MIB.')
    } finally {
      setLoadingObjects(false)
    }
  }

  const getVendorLabel = (val) => {
    const found = SUPPORTED_VENDORS.find(v => v.value === val)
    return found ? found.label : val
  }

  // Tree management functions
  const buildMibTree = (mibName, mibObjects) => {
    const map = {};
    mibObjects.forEach(obj => {
      map[obj.name] = { ...obj, children: [] };
    });

    const roots = [];
    mibObjects.forEach(obj => {
      const node = map[obj.name];
      if (obj.parent && map[obj.parent]) {
        map[obj.parent].children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Recursively sort children to ensure deterministic ordering
    const sortTree = (nodes) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach(n => {
        if (n.children && n.children.length > 0) {
          sortTree(n.children);
        }
      });
    };
    sortTree(roots);

    return {
      name: mibName,
      isMibRoot: true,
      children: roots,
      oid: ''
    };
  };

  const filterMibTree = (node, query) => {
    if (!query) return node;

    const lowercaseQuery = query.toLowerCase();
    
    // Check if current node matches search
    const matchesSelf = !node.isMibRoot && (
      node.name.toLowerCase().includes(lowercaseQuery) ||
      node.oid.toLowerCase().includes(lowercaseQuery)
    );

    // Filter children recursively
    const filteredChildren = node.children
      ? node.children.map(child => filterMibTree(child, query)).filter(Boolean)
      : [];

    if (matchesSelf || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren
      };
    }

    return null;
  };

  const collectParentNodeNames = (node, acc = []) => {
    if (node.children && node.children.length > 0) {
      acc.push(node.name);
      node.children.forEach(child => collectParentNodeNames(child, acc));
    }
    return acc;
  };

  const handleToggleExpand = (nodeName) => {
    setExpandedKeys(prev => ({
      ...prev,
      [nodeName]: !prev[nodeName]
    }));
  };

  // Node selection and form wiring
  const handleSelectNode = (node) => {
    setSelectedNode(node);
    setFormState({
      name: node.name || '',
      parent: node.parent || '',
      kind: node.kind || 'Single',
      oid: node.oid || '',
      syntax: node.syntax || '',
      is_unsigned: node.is_unsigned || 0,
      is_64bit: node.is_64bit || 0,
      is_float: node.is_float || 0,
      unit: node.unit || 'Custom',
      unit_custom: node.unit_custom || '',
      indicator: node.indicator || node.name || '',
      scale: node.scale !== undefined ? node.scale : 1.0,
      scale_mode: node.scale_mode || 'Divide',
      description: node.description || '',
      lookup: node.lookup || ''
    });
    setIsDirty(false);
  };

  const handleInputChange = (field, val) => {
    setFormState(prev => ({ ...prev, [field]: val }));
    setIsDirty(true);
  };

  const handleCancelEdit = () => {
    if (selectedNode) {
      handleSelectNode(selectedNode);
    }
  };

  const handleApplyEdit = async (e) => {
    e.preventDefault();
    if (isViewer) return;
    if (!selectedNode) return;

    try {
      const res = await mibsApi.updateObject(selectedNode.id, formState);
      if (res.data.success) {
        toast.success(res.data.message || 'Objek MIB berhasil diperbarui.');
        setIsDirty(false);
        
        // Update objects list locally so the tree updates immediately
        setObjects(prev => prev.map(obj => obj.id === selectedNode.id ? { ...obj, ...formState } : obj));
        
        // Update selectedNode state
        setSelectedNode(prev => ({ ...prev, ...formState }));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan pembaruan objek MIB.');
    }
  };

  // Construct filtered tree based on search
  const originalTree = selectedMib ? buildMibTree(selectedMib.name, objects) : null;
  const filteredTree = originalTree ? filterMibTree(originalTree, searchObj) : null;

  // Auto-expand search results when query is active
  useEffect(() => {
    if (searchObj && filteredTree) {
      const parentNames = collectParentNodeNames(filteredTree);
      const newExpansions = {};
      parentNames.forEach(name => {
        newExpansions[name] = true;
      });
      setExpandedKeys(prev => ({ ...prev, ...newExpansions }));
    }
  }, [searchObj]);

  // Filter & Slice MIBs List
  const filteredMibs = mibs.filter(m => {
    const s = searchMib.toLowerCase()
    return m.name.toLowerCase().includes(s) || 
           (m.description && m.description.toLowerCase().includes(s)) ||
           m.vendor.toLowerCase().includes(s)
  })
  const startIndexMib = (pageMib - 1) * limit
  const paginatedMibs = filteredMibs.slice(startIndexMib, startIndexMib + limit)
  const totalPagesMib = Math.ceil(filteredMibs.length / limit) || 1

  return (
    <div className="page-container animate-fade">
      {/* Dynamic embedded vanilla styles for tree and editing panels */}
      <style>{`
        .mib-workspace {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 20px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          height: calc(100vh - 200px);
          min-height: 600px;
          overflow: hidden;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.25);
          margin-top: 15px;
        }
        
        .mib-pane-left {
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.01);
          height: 100%;
        }
        
        .mib-pane-right {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }
        
        .mib-tree-header {
          padding: 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .mib-tree-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 12px;
        }
        
        .tree-node-children {
          padding-top: 2px;
          padding-bottom: 2px;
        }
        
        .tree-node-content {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
          margin: 1px 0;
          transition: all 0.15s ease;
          user-select: none;
        }
        
        .tree-node-content:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        
        .tree-node-content.selected {
          background: var(--primary-dim) !important;
          color: var(--primary-bright) !important;
          box-shadow: inset 3px 0 0 0 var(--primary);
        }
        
        .mib-form-header {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255, 255, 255, 0.01);
        }
        
        .mib-form-body {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }
        
        .mib-form-section {
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 18px;
          margin-bottom: 20px;
        }
        
        .mib-form-section-title {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 16px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          border-bottom: 1px dashed var(--border);
          padding-bottom: 6px;
        }
        
        .mib-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        
        .mib-form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        
        .mib-checkbox-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-top: 10px;
        }
        
        .mib-checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          cursor: pointer;
          color: var(--text-primary);
        }
        
        .mib-checkbox-label input {
          cursor: pointer;
        }
        
        .mib-form-footer {
          padding: 16px 24px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: rgba(255, 255, 255, 0.01);
        }
        
        .lookup-textarea {
          font-family: monospace;
          font-size: 11.5px;
          line-height: 1.5;
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <FileCode size={22} style={{ color: 'var(--primary)' }} />
            Manajemen MIB SNMP
          </div>
          <div className="page-subtitle">
            Impor, telusuri pohon MIB, dan sesuaikan parameter OID kustom untuk kueri berkala vendor perangkat.
          </div>
        </div>
      </div>

      {!selectedMib ? (
        /* List Mode View */
        <div className="grid-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
          
          {/* MIB Registry Table */}
          <div className="card">
            <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Daftar MIB Terdaftar</h3>
              <button className="btn btn-ghost btn-sm" onClick={fetchMibs} disabled={loading}>
                <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
              </button>
            </div>

            {/* Search Box */}
            <div className="search-box mb-16" style={{ maxWidth: '320px' }}>
              <Search className="search-icon" size={14} />
              <input 
                placeholder="Cari nama MIB, deskripsi, atau vendor..." 
                value={searchMib} 
                onChange={e => setSearchMib(e.target.value)} 
                style={{ fontSize: '12.5px' }}
              />
            </div>

            {loading ? (
              <div className="loading-overlay" style={{ minHeight: '200px' }}>
                <div className="loading-spinner" />
                Memuat MIB...
              </div>
            ) : filteredMibs.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '200px' }}>
                <FileCode size={32} className="text-muted" />
                <div className="empty-title">Tidak ada MIB ditemukan</div>
                <div className="empty-desc">Impor MIB baru atau sesuaikan filter pencarian Anda.</div>
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Aktif</th>
                        <th>Nama MIB</th>
                        <th>Asosiasi Vendor</th>
                        <th>Deskripsi</th>
                        <th style={{ textAlign: 'center' }}>Jumlah Objek</th>
                        <th style={{ textAlign: 'right' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedMibs.map(mib => (
                        <tr key={mib.id}>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleToggleMib(mib)}
                              disabled={isViewer}
                              style={{ background: 'none', border: 'none', cursor: isViewer ? 'default' : 'pointer', color: mib.is_active ? 'var(--success)' : 'var(--text-muted)' }}
                            >
                              {mib.is_active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                            </button>
                          </td>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>{mib.name}</span>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                                Diimpor: {new Date(mib.created_at).toLocaleDateString('id-ID')}
                              </span>
                            </div>
                          </td>
                          <td>
                            {isViewer ? (
                              <span className="badge badge-ssh">{getVendorLabel(mib.vendor)}</span>
                            ) : (
                              <select
                                value={mib.vendor}
                                onChange={(e) => handleUpdateMibVendor(mib.id, e.target.value)}
                                className="select-input"
                                style={{ padding: '3px 8px', fontSize: '11px', width: 'auto', background: 'var(--bg-input)' }}
                              >
                                {SUPPORTED_VENDORS.map(v => (
                                  <option key={v.value} value={v.value}>{v.label}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{mib.description || 'Tidak ada deskripsi'}</td>
                          <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                            <span className="badge badge-online" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                              {mib.objects_count}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleOpenObjects(mib)}
                                title="Jelajahi dan edit struktur pohon MIB"
                              >
                                <Eye size={12} style={{ marginRight: '4px' }} /> Pohon OID
                              </button>
                              {!isViewer && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleDeleteMib(mib)}
                                  title="Hapus MIB"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <div className="text-muted" style={{ fontSize: '12.5px' }}>
                    Menampilkan MIB ke-{filteredMibs.length === 0 ? 0 : startIndexMib + 1} s.d. {Math.min(pageMib * limit, filteredMibs.length)} dari {filteredMibs.length} MIB
                  </div>
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPageMib(p => Math.max(p - 1, 1))}
                      disabled={pageMib === 1 || loading}
                    >
                      <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {pageMib} dari {totalPagesMib}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPageMib(p => Math.min(p + 1, totalPagesMib))}
                      disabled={pageMib === totalPagesMib || loading}
                    >
                      Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* New MIB Upload Panel */}
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '14px' }}>
              Impor MIB Baru
            </h3>
            <form onSubmit={handleUploadMib} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div 
                className={`upload-zone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('mib-file-input').click()}
                style={{
                  border: dragActive ? '2px dashed var(--primary)' : '2px dashed var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragActive ? 'var(--primary-dim)' : 'var(--bg-input)',
                  transition: 'all 0.2s'
                }}
              >
                <input 
                  id="mib-file-input"
                  type="file" 
                  onChange={handleFileChange} 
                  accept=".mib,.my,.txt"
                  style={{ display: 'none' }}
                />
                <Upload size={32} className="text-muted" style={{ margin: '0 auto 8px', display: 'block' }} />
                <span style={{ fontSize: '12.5px', display: 'block', fontWeight: 600 }}>
                  {file ? file.name : 'Klik atau seret berkas MIB ke sini'}
                </span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  Format yang didukung: .mib, .my, .txt
                </span>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '12px' }}>Deskripsi Singkat</label>
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Misal: MIB vendor Fortigate Core v3.0"
                  className="form-control"
                  style={{ fontSize: '12px' }}
                />
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '12px' }}>Kustomisasi untuk Vendor</label>
                <select
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                >
                  {SUPPORTED_VENDORS.map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginTop: '4px', lineHeight: '1.4' }}>
                  OID dari MIB akan disesuaikan secara dinamis saat melakukan SNMP Query pada perangkat dengan vendor yang cocok.
                </span>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isViewer || uploading || !file}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {uploading ? (
                  <>
                    <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: 8 }} />
                    Memproses MIB...
                  </>
                ) : (
                  <>
                    <Upload size={14} style={{ marginRight: 8 }} /> Unggah & Parse
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Interactive Tree Explorer Workspace (Split Screen View) */
        <div className="workspace-container">
          {/* Back Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <button className="btn btn-ghost" onClick={() => setSelectedMib(null)} style={{ paddingLeft: 0 }}>
              <ArrowLeft size={16} style={{ marginRight: '8px' }} /> Kembali ke Daftar MIB
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Asosiasi Vendor:</span>
              <span className="badge badge-ssh" style={{ fontWeight: 600 }}>{getVendorLabel(selectedMib.vendor)}</span>
            </div>
          </div>

          <div className="mib-workspace">
            {/* Left Column: Interactive Tree Explorer */}
            <div className="mib-pane-left">
              <div className="mib-tree-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Pohon MIB</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{objects.length} objek</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={searchObj}
                    onChange={(e) => setSearchObj(e.target.value)}
                    placeholder="Cari objek atau OID..."
                    className="form-control"
                    style={{ paddingLeft: '32px', fontSize: '12px', height: '32px' }}
                  />
                  <Search size={13} className="text-muted" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>

              <div className="mib-tree-body">
                {loadingObjects ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                    <div className="loading-spinner" />
                  </div>
                ) : filteredTree && filteredTree.children && filteredTree.children.length > 0 ? (
                  <MibTreeNode 
                    node={filteredTree}
                    selectedNodeId={selectedNode ? selectedNode.id : null}
                    onSelect={handleSelectNode}
                    expandedKeys={expandedKeys}
                    onToggleExpand={handleToggleExpand}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '12px' }}>
                    {searchObj ? 'Pencarian tidak cocok.' : 'Pohon MIB kosong.'}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Properties Details Form */}
            <div className="mib-pane-right">
              {selectedNode ? (
                <form onSubmit={handleApplyEdit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="mib-form-header">
                    <div>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)' }}>
                        Detail OID: {selectedNode.name}
                      </h4>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Oleh Agen MIB: {selectedMib.name}
                      </p>
                    </div>
                    {isDirty && (
                      <div className="badge badge-online" style={{ background: '#f59e0b22', color: '#f59e0b', fontSize: '10.5px' }}>
                        Perubahan belum disimpan
                      </div>
                    )}
                  </div>

                  <div className="mib-form-body">
                    {/* Identification Section */}
                    <div className="mib-form-section">
                      <div className="mib-form-section-title">Identification</div>
                      <div className="mib-form-grid">
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Agent</label>
                          <input 
                            type="text" 
                            value={selectedMib.name} 
                            disabled 
                            className="form-control"
                            style={{ fontSize: '12px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}
                          />
                        </div>
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Group</label>
                          <input 
                            type="text" 
                            value={formState.parent} 
                            disabled 
                            className="form-control"
                            style={{ fontSize: '12px', background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}
                          />
                        </div>
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Name</label>
                          <input 
                            type="text" 
                            value={formState.name} 
                            onChange={(e) => handleInputChange('name', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px' }}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Source Section */}
                    <div className="mib-form-section">
                      <div className="mib-form-section-title">Source</div>
                      <div className="mib-form-grid">
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Kind</label>
                          <select 
                            value={formState.kind}
                            onChange={(e) => handleInputChange('kind', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                          >
                            <option value="Single">Single Value</option>
                            <option value="Table">Table</option>
                            <option value="Table Entry">Table Entry</option>
                            <option value="Table Column">Table Column</option>
                            <option value="Notification">Notification</option>
                          </select>
                        </div>
                        <div className="mib-form-group" style={{ gridColumn: 'span 2' }}>
                          <label className="form-label" style={{ fontSize: '11px' }}>OID</label>
                          <input 
                            type="text" 
                            value={formState.oid} 
                            onChange={(e) => handleInputChange('oid', e.target.value)}
                            className="form-control mono text-primary"
                            style={{ fontSize: '12px' }}
                            required
                          />
                        </div>
                      </div>

                      <div className="mib-form-grid" style={{ marginTop: '16px' }}>
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Type / Syntax</label>
                          <select 
                            value={formState.syntax}
                            onChange={(e) => handleInputChange('syntax', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                          >
                            <option value="">(None / Abstract Group)</option>
                            <option value="DisplayString">DisplayString (Text)</option>
                            <option value="Integer32">Integer32 (Signed 32-bit Integer)</option>
                            <option value="Counter32">Counter32 (Unsigned Incremental 32-bit)</option>
                            <option value="Counter64">Counter64 (Unsigned Incremental 64-bit)</option>
                            <option value="Gauge32">Gauge32 (Unsigned Metric 32-bit)</option>
                            <option value="TimeTicks">TimeTicks (Duration hundredths of second)</option>
                            <option value="IpAddress">IpAddress (IPv4 Address)</option>
                            <option value="OBJECT IDENTIFIER">OBJECT IDENTIFIER (OID Node)</option>
                            <option value="OctetString">OctetString (Raw byte stream)</option>
                          </select>
                        </div>

                        <div className="mib-form-group">
                          <div className="mib-checkbox-row">
                            <label className="mib-checkbox-label">
                              <input 
                                type="checkbox"
                                checked={formState.is_unsigned === 1}
                                onChange={(e) => handleInputChange('is_unsigned', e.target.checked ? 1 : 0)}
                              />
                              Unsigned
                            </label>
                            <label className="mib-checkbox-label">
                              <input 
                                type="checkbox"
                                checked={formState.is_64bit === 1}
                                onChange={(e) => handleInputChange('is_64bit', e.target.checked ? 1 : 0)}
                              />
                              64-bit
                            </label>
                            <label className="mib-checkbox-label">
                              <input 
                                type="checkbox"
                                checked={formState.is_float === 1}
                                onChange={(e) => handleInputChange('is_float', e.target.checked ? 1 : 0)}
                              />
                              Float
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Value Customization Section */}
                    <div className="mib-form-section">
                      <div className="mib-form-section-title">Value customization</div>
                      <div className="mib-form-grid">
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Unit</label>
                          <select 
                            value={formState.unit}
                            onChange={(e) => handleInputChange('unit', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                          >
                            <option value="Custom">Custom Unit</option>
                            <option value="Seconds">Seconds (s)</option>
                            <option value="Percent">Percent (%)</option>
                            <option value="Bytes">Bytes (B)</option>
                            <option value="Bits">Bits (b)</option>
                            <option value="Celsius">Celsius (°C)</option>
                            <option value="Hertz">Hertz (Hz)</option>
                          </select>
                        </div>

                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Custom Unit Symbol</label>
                          <input 
                            type="text" 
                            value={formState.unit_custom} 
                            placeholder="#"
                            onChange={(e) => handleInputChange('unit_custom', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px' }}
                            disabled={formState.unit !== 'Custom'}
                          />
                        </div>
                      </div>

                      <div className="mib-form-grid" style={{ marginTop: '16px' }}>
                        <div className="mib-form-group">
                          <label className="form-label" style={{ fontSize: '11px' }}>Indicator / Label</label>
                          <input 
                            type="text" 
                            value={formState.indicator} 
                            onChange={(e) => handleInputChange('indicator', e.target.value)}
                            className="form-control"
                            style={{ fontSize: '12px' }}
                          />
                        </div>

                        <div className="mib-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div className="mib-form-group">
                            <label className="form-label" style={{ fontSize: '11px' }}>Scale factor</label>
                            <input 
                              type="number" 
                              step="any"
                              value={formState.scale} 
                              onChange={(e) => handleInputChange('scale', parseFloat(e.target.value) || 1)}
                              className="form-control"
                              style={{ fontSize: '12px' }}
                            />
                          </div>

                          <div className="mib-form-group">
                            <label className="form-label" style={{ fontSize: '11px' }}>Operation</label>
                            <select 
                              value={formState.scale_mode}
                              onChange={(e) => handleInputChange('scale_mode', e.target.value)}
                              className="form-control"
                              style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                            >
                              <option value="Divide">Divide</option>
                              <option value="Multiply">Multiply</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Description Section */}
                    <div className="mib-form-section">
                      <div className="mib-form-section-title">Description</div>
                      <div className="mib-form-group">
                        <textarea 
                          rows="4"
                          value={formState.description}
                          onChange={(e) => handleInputChange('description', e.target.value)}
                          placeholder="Deskripsi fungsi dan tipe variable OID ini..."
                          className="form-control"
                          style={{ fontSize: '12px', resize: 'vertical' }}
                        />
                      </div>
                    </div>

                    {/* Value Lookups Map Section */}
                    <div className="mib-form-section">
                      <div className="mib-form-section-title">Lookup table mapping</div>
                      <div className="mib-form-group">
                        <textarea 
                          rows="3"
                          value={formState.lookup}
                          onChange={(e) => handleInputChange('lookup', e.target.value)}
                          placeholder="1: up, 2: down, 3: testing (Satu entri per baris)"
                          className="form-control lookup-textarea"
                          style={{ resize: 'vertical' }}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                          Konfigurasikan baris integer ke deskripsi teks (misal: 1=up) untuk mendekode status output query SNMP secara visual.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="mib-form-footer">
                    <button 
                      type="button" 
                      onClick={handleCancelEdit} 
                      className="btn btn-ghost"
                      disabled={!isDirty}
                    >
                      <RotateCcw size={14} style={{ marginRight: '6px' }} /> Batal
                    </button>
                    <button 
                      type="submit" 
                      className="btn btn-primary"
                      disabled={isViewer || !isDirty}
                    >
                      <Save size={14} style={{ marginRight: '6px' }} /> Apply
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px', color: 'var(--text-muted)' }}>
                  <Layers size={40} style={{ marginBottom: '14px', opacity: 0.3 }} />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Tidak ada objek terpilih</span>
                  <span style={{ fontSize: '11.5px', marginTop: '4px', textAlign: 'center', maxWidth: '280px' }}>
                    Pilih salah satu variabel OID (ikon gear hijau atau folder) dari struktur pohon di panel kiri untuk melihat properti dan mengeditnya.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
