import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Plus, Trash2, Edit2, Play, RefreshCw, Search, Download, Upload } from 'lucide-react'
import { devicesApi, groupsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'
import AddDeviceModal from '../components/Device/AddDeviceModal'
import BulkRefreshModal from '../components/Device/BulkRefreshModal'
import ExportModal from '../components/Device/ExportModal'
import ImportModal from '../components/Device/ImportModal'

export default function DeviceManagement() {
  const [devices, setDevices] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [testingDevices, setTestingDevices] = useState({})
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false)
  const [editDevice, setEditDevice] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  
  const toast = useToast()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const isViewer = currentUser?.role === 'viewer'

  const fetchData = async () => {
    setLoading(true)
    try {
      const [devRes, grpRes] = await Promise.all([
        devicesApi.list(),
        groupsApi.list()
      ])
      setDevices(devRes.data)
      setGroups(grpRes.data)
    } catch (err) {
      toast.error('Gagal mengambil data perangkat atau group jaringan.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleTestConnection = async (id) => {
    setTestingDevices(prev => ({ ...prev, [id]: true }))
    try {
      const res = await devicesApi.testConnection(id)
      if (res.data.success) {
        toast.success(res.data.message)
      } else {
        toast.error(res.data.message)
      }
      // Reload devices to update status and last seen
      const devRes = await devicesApi.list()
      setDevices(devRes.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal melakukan uji koneksi.')
    } finally {
      setTestingDevices(prev => ({ ...prev, [id]: false }))
    }
  }

  const handleDeleteDevice = async (id, name) => {
    if (!confirm(`Yakin ingin menghapus perangkat "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return
    try {
      await devicesApi.remove(id)
      toast.success('Perangkat berhasil dihapus.')
      fetchData()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus perangkat.')
    }
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

  const openAdd = () => {
    setEditDevice(null)
    setShowAddModal(true)
  }

  const openEdit = (d) => {
    setEditDevice(d)
    setShowAddModal(true)
  }

  // Filter devices by search term and selected group
  const filteredDevices = devices.filter(d => {
    const s = search.toLowerCase()
    const matchSearch = d.name.toLowerCase().includes(s) || 
                        d.ip.includes(s) ||
                        (d.os_version && d.os_version.toLowerCase().includes(s)) ||
                        (d.hardware_model && d.hardware_model.toLowerCase().includes(s)) ||
                        (d.serial_number && d.serial_number.toLowerCase().includes(s)) ||
                        (d.mac_address && d.mac_address.toLowerCase().includes(s)) ||
                        (d.device_role && d.device_role.toLowerCase().includes(s))
    const matchGroup = selectedGroup === '' || d.group_id === parseInt(selectedGroup)
    return matchSearch && matchGroup
  })

  const STATUS_DOT_STYLE = {
    online:  { background: 'var(--success)', boxShadow: '0 0 6px var(--success)' },
    offline: { background: 'var(--danger)' },
    unknown: { background: 'var(--text-muted)' },
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Server size={22} style={{ color: 'var(--primary)' }} />
            Manajemen Device
          </div>
          <div className="page-subtitle">Kelola dan pantau seluruh perangkat jaringan yang terdaftar</div>
        </div>
        <div className="flex-center gap-12">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExportModal(true)}>
            <Download size={14} /> Export CSV
          </button>
          {!isViewer && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)} style={{ gap: '6px' }}>
                <Upload size={13} /> Impor Massal (CSV)
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkModal(true)} style={{ gap: '6px' }}>
                <RefreshCw size={13} /> Penyegaran Massal
              </button>
              <button className="btn btn-primary" onClick={openAdd}>
                <Plus size={15} /> Tambah Device
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filter Card */}
      <div className="card mb-16" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Box */}
          <div className="search-box" style={{ flex: '1 1 240px' }}>
            <Search className="search-icon" />
            <input 
              placeholder="Cari nama atau IP device..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>

          {/* Group Filter */}
          <div style={{ flex: '0 0 200px' }}>
            <select 
              className="form-control"
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
              style={{ padding: '8px 12px' }}
            >
              <option value="">Semua Group</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="card">
        {loading ? (
          <div className="loading-overlay" style={{ minHeight: '300px' }}>
            <div className="loading-spinner" />
            Memuat data perangkat...
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '300px' }}>
            <Server size={32} className="text-muted" style={{ marginBottom: '16px' }} />
            <div className="empty-title">Tidak ada perangkat ditemukan</div>
            <div className="empty-desc">Tambahkan perangkat baru atau sesuaikan filter pencarian Anda.</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Device</th>
                  <th>IP Address</th>
                  <th>Kategori</th>
                  <th>Protokol</th>
                  <th>Tipe Vendor</th>
                  <th>Group</th>
                  <th>Status</th>
                  <th>Terakhir Dilihat</th>
                  {!isViewer && <th style={{ textAlign: 'right' }}>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filteredDevices.map(d => {
                  const st = d.status || 'unknown'
                  return (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        <span 
                          onClick={() => navigate(`/device/${d.id}`)}
                          style={{ cursor: 'pointer', textDecoration: 'underline' }}
                        >
                          {d.name}
                        </span>
                        {d.hardware_model && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '2px' }}>
                            {d.hardware_model}
                          </div>
                        )}
                      </td>
                      <td className="mono">{d.ip}</td>
                      <td>
                        <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>
                          {d.device_role || 'Access Switch'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${d.protocol}`}>
                          {d.protocol?.toUpperCase()} ({d.port})
                        </span>
                      </td>
                      <td>
                        <span className="vendor-badge networking">
                          {d.device_type}
                        </span>
                      </td>
                      <td>
                        {d.group_name ? (
                          <span className="badge badge-online" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                            {d.group_name}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${st}`}>
                          <span className="status-dot" style={STATUS_DOT_STYLE[st] || STATUS_DOT_STYLE.unknown} />
                          {st}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: '11.5px' }}>
                        {d.last_seen ? new Date(d.last_seen).toLocaleString('id-ID') : '—'}
                      </td>
                      {!isViewer && (
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                            <button 
                              className="btn btn-ghost btn-sm" 
                              style={{ color: 'var(--accent)' }}
                              onClick={() => handleTestConnection(d.id)}
                              disabled={testingDevices[d.id]}
                              title="Test Koneksi (SSH/Telnet)"
                            >
                              {testingDevices[d.id] ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <Play size={13} />
                              )}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)} title="Edit Device">
                              <Edit2 size={13} />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteDevice(d.id, d.name)} title="Hapus Device">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAddModal && (
        <AddDeviceModal 
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); fetchData(); }}
          editDevice={editDevice}
        />
      )}

      {showBulkModal && (
        <BulkRefreshModal 
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => { fetchData(); }}
        />
      )}

      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExport={handleExportCsv}
        />
      )}

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => { fetchData(); }}
        />
      )}
    </div>
  )
}
