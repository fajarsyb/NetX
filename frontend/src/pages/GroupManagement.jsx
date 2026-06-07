import { useState, useEffect } from 'react'
import { FolderGit2, Plus, Trash2, Edit2, Zap, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import { groupsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

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

const getVisibleGroupRows = (groupsList, collapsed) => {
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
      ...node,
      depth,
      hasChildren: node.children.length > 0
    })
    
    if (!collapsed[node.id]) {
      node.children.forEach(child => traverse(child, depth + 1))
    }
  }
  
  roots.forEach(root => traverse(root, 0))
  return result
}

export default function GroupManagement() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editGroup, setEditGroup] = useState(null)
  
  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState('')
  const [refreshingGroups, setRefreshingGroups] = useState({})
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const toggleCollapse = (groupId) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  const fetchGroups = async () => {
    setLoading(true)
    try {
      const res = await groupsApi.list()
      setGroups(res.data)
    } catch (err) {
      toast.error('Gagal mengambil data group.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [])

  const handleRefreshGroup = async (groupId) => {
    setRefreshingGroups(prev => ({ ...prev, [groupId]: true }))
    try {
      const res = await groupsApi.refresh(groupId)
      if (res.data.success) {
        toast.success(res.data.message || 'Penyegaran data grup berhasil.')
      } else {
        toast.error('Penyegaran data grup gagal.')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Penyegaran data grup gagal.')
    } finally {
      setRefreshingGroups(prev => ({ ...prev, [groupId]: false }))
    }
  }

  const openAdd = () => {
    setEditGroup(null)
    setName('')
    setDescription('')
    setParentId('')
    setShowModal(true)
  }

  const openEdit = (g) => {
    setEditGroup(g)
    setName(g.name)
    setDescription(g.description || '')
    setParentId(g.parent_id || '')
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      name,
      description,
      parent_id: parentId ? parseInt(parentId) : null
    }
    try {
      if (editGroup) {
        await groupsApi.update(editGroup.id, payload)
        toast.success('Group berhasil diupdate.')
      } else {
        await groupsApi.create(payload)
        toast.success('Group berhasil dibuat.')
      }
      setShowModal(false)
      fetchGroups()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan group.')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus group ini? Device di dalamnya tidak akan terhapus.')) return
    try {
      await groupsApi.remove(id)
      toast.success('Group berhasil dihapus.')
      fetchGroups()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus group.')
    }
  }

  const isViewer = currentUser?.role === 'viewer';
  const visibleRows = getVisibleGroupRows(groups, collapsedGroups);

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <FolderGit2 size={22} style={{ color: 'var(--primary)' }} />
            Manajemen Group
          </div>
          <div className="page-subtitle">Kelola pengelompokan device jaringan Anda</div>
        </div>
        {!isViewer && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Tambah Group
          </button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay"><div className="loading-spinner" /></div>
        ) : groups.length === 0 ? (
           <div className="empty-state" style={{ minHeight: '200px' }}>
             <FolderGit2 size={32} className="text-muted" style={{ marginBottom: '16px' }} />
             <div>Belum ada group yang dibuat.</div>
           </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Group</th>
                  <th>Grup Induk</th>
                  <th>Deskripsi</th>
                  <th>Jumlah Device</th>
                  {!isViewer && <th style={{ textAlign: 'right' }}>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(g => {
                  const isCollapsed = !!collapsedGroups[g.id];
                  return (
                    <tr key={g.id}>
                      <td style={{ 
                        paddingLeft: `${g.depth * 24 + 12}px`, 
                        fontWeight: 600, 
                        color: 'var(--text-primary)' 
                      }}>
                        <div className="flex-center" style={{ gap: '6px', justifyContent: 'flex-start' }}>
                          {g.hasChildren ? (
                            <button 
                              type="button"
                              className="btn btn-ghost btn-sm" 
                              style={{ padding: '2px', minWidth: 'auto', height: 'auto', marginRight: '2px', color: 'var(--text-muted)' }}
                              onClick={() => toggleCollapse(g.id)}
                            >
                              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                            </button>
                          ) : (
                            <span style={{ width: '20px', display: 'inline-block' }} />
                          )}
                          <FolderGit2 size={16} style={{ color: 'var(--primary)' }} />
                          <span>{g.name}</span>
                        </div>
                      </td>
                      <td>{g.parent_name || '—'}</td>
                      <td>{g.description || '—'}</td>
                      <td>
                        <span className="badge badge-online">
                          {g.device_count} device
                        </span>
                      </td>
                      {!isViewer && (
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ color: 'var(--warning)' }}
                              onClick={() => handleRefreshGroup(g.id)}
                              disabled={refreshingGroups[g.id]}
                              title="Refresh ARP, LLDP, CDP untuk group ini"
                            >
                              {refreshingGroups[g.id] ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <Zap size={14} />
                              )}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(g)} title="Edit Group">
                              <Edit2 size={14} />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(g.id)} title="Hapus Group">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal animate-slide">
            <div className="modal-header">
              <div className="modal-title">
                {editGroup ? 'Edit Group' : 'Tambah Group Baru'}
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nama Group</label>
                  <input className="form-control" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Grup Induk</label>
                  <select 
                    className="form-control" 
                    value={parentId} 
                    onChange={e => setParentId(e.target.value)}
                  >
                    <option value="">(Tanpa Grup Induk / Grup Utama)</option>
                    {buildHierarchicalGroups(groups.filter(g => !editGroup || g.id !== editGroup.id)).map(g => (
                      <option key={g.id} value={g.id}>
                        {g.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group mb-16">
                  <label className="form-label">Deskripsi</label>
                  <textarea className="form-control" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
