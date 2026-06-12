import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, Plus, Trash2, Edit2, Play, RefreshCw, Search, Download, Upload,
  ChevronLeft, ChevronRight, CheckSquare, Square, X, Zap, CheckCheck, Layers, Wifi
} from 'lucide-react'
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
  const [pingingDevices, setPingingDevices] = useState({})
  const [bulkPinging, setBulkPinging] = useState(false)
  const [bulkPingProgress, setBulkPingProgress] = useState(null)
  const [page, setPage] = useState(1)
  const limit = 20

  // ── Bulk selection state ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkBar, setShowBulkBar] = useState(false)
  const [bulkRefreshing, setBulkRefreshing] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)  // { current, total, done }

  useEffect(() => {
    setPage(1)
  }, [search, selectedGroup])

  useEffect(() => {
    setShowBulkBar(selectedIds.size > 0)
  }, [selectedIds])
  
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
      const devRes = await devicesApi.list()
      setDevices(devRes.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal melakukan uji koneksi.')
    } finally {
      setTestingDevices(prev => ({ ...prev, [id]: false }))
    }
  }

  const handlePingDevice = async (id) => {
    setPingingDevices(prev => ({ ...prev, [id]: true }))
    try {
      const res = await devicesApi.ping(id)
      if (res.data.success) {
        const result = res.data.result
        if (result.reachable) {
          toast.success(`Ping ke ${res.data.ip} sukses! RTT: ${result.rtt_ms}ms, Loss: ${result.loss_pct}%`)
        } else {
          toast.error(`Ping ke ${res.data.ip} gagal (100% loss)`)
        }
      } else {
        toast.error(res.data.message || 'Gagal melakukan ping.')
      }
      const devRes = await devicesApi.list()
      setDevices(devRes.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal melakukan ping.')
    } finally {
      setPingingDevices(prev => ({ ...prev, [id]: false }))
    }
  }

  const handleBulkPingSelected = async () => {
    if (selectedIds.size === 0) { toast.warning('Pilih minimal 1 perangkat.'); return }
    setBulkPinging(true)
    setBulkPingProgress({ current: 0, total: selectedIds.size, done: false })
    try {
      const res = await devicesApi.bulkPing({
        device_ids: Array.from(selectedIds),
      })
      if (!res.data.success) { toast.error('Gagal memulai bulk ping.'); setBulkPinging(false); return }
      toast.success(`Bulk ping dimulai untuk ${selectedIds.size} perangkat...`)
      const taskId = res.data.task_id
      
      const poll = setInterval(async () => {
        try {
          const sr = await devicesApi.getBulkPingStatus(taskId)
          setBulkPingProgress({ current: sr.data.current, total: sr.data.total, done: false })
          if (sr.data.status === 'completed' || sr.data.status === 'failed') {
            clearInterval(poll)
            setBulkPinging(false)
            setBulkPingProgress(p => ({ ...p, done: true }))
            toast.success('Bulk ping selesai!')
            fetchData()
            setTimeout(() => setBulkPingProgress(null), 3000)
          }
        } catch {
          clearInterval(poll)
          setBulkPinging(false)
          setBulkPingProgress(null)
        }
      }, 1200)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal memulai bulk ping.')
      setBulkPinging(false)
      setBulkPingProgress(null)
    }
  }

  const handleDeleteDevice = async (id, name) => {
    if (!confirm(`Yakin ingin menghapus perangkat "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return
    try {
      await devicesApi.remove(id)
      toast.success('Perangkat berhasil dihapus.')
      setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
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

  const openAdd = () => { setEditDevice(null); setShowAddModal(true) }
  const openEdit = (d) => { setEditDevice(d); setShowAddModal(true) }

  // ── Filtering + Pagination ────────────────────────────────────────────────
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

  const startIndex = (page - 1) * limit
  const paginatedDevices = filteredDevices.slice(startIndex, startIndex + limit)
  const totalPages = Math.ceil(filteredDevices.length / limit) || 1

  // ── Bulk selection helpers ────────────────────────────────────────────────
  const toggleRow = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const isPageAllSelected = paginatedDevices.length > 0 && paginatedDevices.every(d => selectedIds.has(d.id))
  const isPagePartialSelected = paginatedDevices.some(d => selectedIds.has(d.id)) && !isPageAllSelected

  const togglePageAll = () => {
    if (isPageAllSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        paginatedDevices.forEach(d => next.delete(d.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        paginatedDevices.forEach(d => next.add(d.id))
        return next
      })
    }
  }

  const selectAll = () => setSelectedIds(new Set(filteredDevices.map(d => d.id)))
  const clearSelection = () => setSelectedIds(new Set())

  // ── Bulk Refresh Inline ───────────────────────────────────────────────────
  const handleBulkRefreshSelected = async (components = ['info', 'arp', 'lldp', 'cdp', 'mac']) => {
    if (selectedIds.size === 0) { toast.warning('Pilih minimal 1 perangkat.'); return }
    setBulkRefreshing(true)
    setBulkProgress({ current: 0, total: selectedIds.size, done: false })
    try {
      const res = await devicesApi.bulkRefresh({
        device_ids: Array.from(selectedIds),
        components,
      })
      if (!res.data.success) { toast.error('Gagal memulai bulk refresh.'); setBulkRefreshing(false); return }
      toast.success(`Bulk refresh dimulai untuk ${selectedIds.size} perangkat...`)
      const taskId = res.data.task_id
      // Poll until done
      const poll = setInterval(async () => {
        try {
          const sr = await devicesApi.getBulkRefreshStatus(taskId)
          setBulkProgress({ current: sr.data.current, total: sr.data.total, done: false })
          if (sr.data.status === 'completed' || sr.data.status === 'failed') {
            clearInterval(poll)
            setBulkRefreshing(false)
            setBulkProgress(p => ({ ...p, done: true }))
            toast.success('Bulk refresh selesai!')
            fetchData()
            setTimeout(() => setBulkProgress(null), 3000)
          }
        } catch {
          clearInterval(poll)
          setBulkRefreshing(false)
          setBulkProgress(null)
        }
      }, 1200)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal memulai bulk refresh.')
      setBulkRefreshing(false)
      setBulkProgress(null)
    }
  }

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

      {/* ── Filter Card ────────────────────────────────────── */}
      <div className="card mb-16" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: '1 1 240px' }}>
            <Search className="search-icon" />
            <input 
              placeholder="Cari nama, IP, model, serial..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
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
          {/* Select All helpers */}
          {!isViewer && filteredDevices.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={selectAll}
                style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                title="Pilih semua perangkat terfilter"
              >
                <CheckCheck size={13} /> Pilih Semua ({filteredDevices.length})
              </button>
              {selectedIds.size > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={clearSelection}
                  style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}
                >
                  <X size={12} /> Hapus Pilihan
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Bulk Action Bar ───────────────────────────────── */}
      {showBulkBar && !isViewer && (
        <div style={{
          position: 'sticky',
          top: 70,
          zIndex: 50,
          background: 'linear-gradient(135deg, #1a2a4a, #132035)',
          border: '1px solid var(--primary)',
          borderRadius: 10,
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 16,
          boxShadow: '0 4px 20px rgba(79,142,247,0.2)',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <Layers size={16} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>
              {selectedIds.size} perangkat dipilih
            </span>
            {(bulkProgress || bulkPingProgress) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                <div style={{ width: 120, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(bulkProgress || bulkPingProgress).total > 0 ? Math.round(((bulkProgress || bulkPingProgress).current / (bulkProgress || bulkPingProgress).total) * 100) : 0}%`,
                    height: '100%',
                    background: (bulkProgress || bulkPingProgress).done ? 'var(--success)' : 'var(--primary)',
                    transition: 'width 0.4s ease',
                    borderRadius: 3,
                  }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {(bulkProgress || bulkPingProgress).done ? '✓ Selesai' : `${(bulkProgress || bulkPingProgress).current}/${(bulkProgress || bulkPingProgress).total}`}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={bulkRefreshing}
              onClick={() => handleBulkRefreshSelected(['info'])}
              style={{ fontSize: 11, padding: '5px 12px' }}
              title="Refresh Hardware Info saja"
            >
              {bulkRefreshing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
              Info
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={bulkRefreshing}
              onClick={() => handleBulkRefreshSelected(['arp', 'mac'])}
              style={{ fontSize: 11, padding: '5px 12px' }}
              title="Refresh ARP + MAC Table"
            >
              {bulkRefreshing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
              ARP + MAC
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={bulkRefreshing}
              onClick={() => handleBulkRefreshSelected(['info', 'arp', 'lldp', 'cdp', 'mac'])}
              style={{ fontSize: 11, padding: '5px 12px', background: 'linear-gradient(135deg,#10b981,#059669)' }}
              title="Refresh semua komponen"
            >
              {bulkRefreshing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh Semua
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={bulkPinging}
              onClick={handleBulkPingSelected}
              style={{ fontSize: 11, padding: '5px 12px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}
              title="Ping semua perangkat terpilih"
            >
              {bulkPinging ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} />}
              Ping Terpilih
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setShowBulkModal(true)}
              style={{ fontSize: 11, padding: '5px 12px' }}
              title="Buka dialog penyegaran massal lanjutan"
            >
              <RefreshCw size={12} /> Lanjutan...
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={clearSelection}
              style={{ fontSize: 11, padding: '5px 10px' }}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ── Table Card ────────────────────────────────────── */}
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
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    {!isViewer && (
                      <th style={{ width: 40, textAlign: 'center', padding: '10px 8px' }}>
                        <button
                          onClick={togglePageAll}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: isPageAllSelected ? 'var(--primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title={isPageAllSelected ? 'Deselect page' : 'Select page'}
                        >
                          {isPageAllSelected
                            ? <CheckSquare size={15} style={{ color: 'var(--primary)' }} />
                            : isPagePartialSelected
                              ? <CheckSquare size={15} style={{ color: 'var(--warning)', opacity: 0.7 }} />
                              : <Square size={15} />
                          }
                        </button>
                      </th>
                    )}
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
                  {paginatedDevices.map(d => {
                    const st = d.status || 'unknown'
                    const isSelected = selectedIds.has(d.id)
                    return (
                      <tr
                        key={d.id}
                        style={{
                          background: isSelected ? 'rgba(79,142,247,0.06)' : undefined,
                          borderLeft: isSelected ? '2px solid var(--primary)' : '2px solid transparent',
                          transition: 'background 0.1s, border-color 0.1s',
                        }}
                      >
                        {!isViewer && (
                          <td style={{ width: 40, textAlign: 'center', padding: '10px 8px' }}>
                            <button
                              onClick={() => toggleRow(d.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: isSelected ? 'var(--primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {isSelected
                                ? <CheckSquare size={15} style={{ color: 'var(--primary)' }} />
                                : <Square size={15} />
                              }
                            </button>
                          </td>
                        )}
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
                          <span className={`badge badge-${st}`} style={{ gap: '6px' }}>
                            <span className="status-dot" style={STATUS_DOT_STYLE[st] || STATUS_DOT_STYLE.unknown} />
                            <span style={{ textTransform: 'capitalize' }}>{st}</span>
                            {d.ping_rtt_ms !== null && d.ping_rtt_ms !== undefined && (
                              <span 
                                style={{ 
                                  fontSize: '11px', 
                                  marginLeft: '4px',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  background: 'rgba(255,255,255,0.08)',
                                  color: d.ping_rtt_ms < 50 ? '#10b981' : d.ping_rtt_ms < 150 ? '#f59e0b' : '#ef4444',
                                  fontWeight: '600'
                                }}
                                title={`Ping checked at: ${d.ping_checked_at ? new Date(d.ping_checked_at).toLocaleString('id-ID') : '—'}`}
                              >
                                {d.ping_rtt_ms}ms / {d.ping_loss_pct}%
                              </span>
                            )}
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
                              <button 
                                className="btn btn-ghost btn-sm" 
                                style={{ color: 'var(--primary)' }}
                                onClick={() => handlePingDevice(d.id)}
                                disabled={pingingDevices[d.id]}
                                title="Ping Device"
                              >
                                {pingingDevices[d.id] ? (
                                  <RefreshCw size={14} className="animate-spin" />
                                ) : (
                                  <Wifi size={13} />
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

            {/* Pagination Controls */}
            <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="text-muted" style={{ fontSize: '12.5px' }}>
                  Menampilkan ke-{filteredDevices.length === 0 ? 0 : startIndex + 1} s.d. {Math.min(page * limit, filteredDevices.length)} dari {filteredDevices.length} perangkat
                </div>
                {selectedIds.size > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', background: 'var(--primary-dim)', padding: '2px 8px', borderRadius: 10 }}>
                    {selectedIds.size} dipilih
                  </span>
                )}
              </div>
              <div className="flex-center gap-12">
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page === 1 || loading}
                >
                  <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                </button>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Halaman {page} dari {totalPages}
                </span>
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                  disabled={page === totalPages || loading}
                >
                  Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                </button>
              </div>
            </div>
          </>
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
          preselectedIds={selectedIds.size > 0 ? Array.from(selectedIds) : null}
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
