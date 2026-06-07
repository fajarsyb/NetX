import { useState, useEffect } from 'react'
import { 
  Server, Calendar, History, Plus, Play, FileCode, Trash2, GitCompare, 
  CheckCircle, XCircle, Clock, Copy, Info, AlertTriangle, ToggleLeft, ToggleRight,
  Eye, Download, RefreshCw, X, Search, ChevronLeft, ChevronRight
} from 'lucide-react'
import { deviceBackupApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

export default function DeviceBackup() {
  const [activeTab, setActiveTab] = useState('backups') // backups | schedules | logs
  const [devices, setDevices] = useState([])
  const [schedules, setSchedules] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Backups tab state
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [versions, setVersions] = useState([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [selectedVersionsForDiff, setSelectedVersionsForDiff] = useState([]) // holds backup IDs
  const [activeConfig, setActiveConfig] = useState(null) // holds specific backup config details
  const [activeDiff, setActiveDiff] = useState(null) // holds diff details
  
  // Schedules tab state
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [schedName, setSchedName] = useState('')
  const [schedTarget, setSchedTarget] = useState('all') // all | custom
  const [schedTargetDevices, setSchedTargetDevices] = useState([]) // list of selected device IDs
  const [schedFreq, setSchedFreq] = useState('daily') // hourly | daily | weekly
  const [schedTime, setSchedTime] = useState('02:00')
  const [schedDayOfWeek, setSchedDayOfWeek] = useState(0) // 0-6
  const [savingSchedule, setSavingSchedule] = useState(false)

  // Search and Pagination States
  const limit = 20
  const [searchDevice, setSearchDevice] = useState('')
  const [pageDevice, setPageDevice] = useState(1)
  const [searchSchedule, setSearchSchedule] = useState('')
  const [pageSchedule, setPageSchedule] = useState(1)
  const [searchLog, setSearchLog] = useState('')
  const [pageLog, setPageLog] = useState(1)

  useEffect(() => {
    setPageDevice(1)
  }, [searchDevice])

  useEffect(() => {
    setPageSchedule(1)
  }, [searchSchedule])

  useEffect(() => {
    setPageLog(1)
  }, [searchLog])

  // System states
  const [backingUpDevices, setBackingUpDevices] = useState({})
  
  // Right Panel resizing logic
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('netx_backup_right_panel_width')
    return saved ? parseInt(saved, 10) : 380
  })
  const [isResizingRight, setIsResizingRight] = useState(false)

  const startResizingRight = (e) => {
    e.preventDefault()
    setIsResizingRight(true)
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRight) return
      const newWidth = Math.max(280, Math.min(window.innerWidth - e.clientX, 600))
      setRightPanelWidth(newWidth)
      localStorage.setItem('netx_backup_right_panel_width', newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingRight(false)
    }

    if (isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingRight])

  const toast = useToast()
  const { user: currentUser } = useAuth()
  const isViewer = currentUser?.role === 'viewer'

  const fetchData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'backups') {
        const res = await deviceBackupApi.listDevices()
        setDevices(res.data)
      } else if (activeTab === 'schedules') {
        const [schedRes, devRes] = await Promise.all([
          deviceBackupApi.listSchedules(),
          deviceBackupApi.listDevices()
        ])
        setSchedules(schedRes.data)
        setDevices(devRes.data)
      } else if (activeTab === 'logs') {
        const res = await deviceBackupApi.list()
        setLogs(res.data)
      }
    } catch (err) {
      toast.error('Gagal memuat data dari server.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [activeTab])

  // Manual device backup
  const handleBackupNow = async (deviceId, name) => {
    setBackingUpDevices(prev => ({ ...prev, [deviceId]: true }))
    try {
      const res = await deviceBackupApi.create(deviceId)
      if (res.data.success) {
        if (res.data.skipped) {
          toast.info(`Backup untuk perangkat "${name}" dilewati karena tidak ada perubahan konfigurasi.`)
        } else {
          toast.success(`Backup untuk perangkat "${name}" versi ${res.data.version} berhasil dibuat.`)
        }
        fetchData()
        if (selectedDevice && selectedDevice.id === deviceId) {
          fetchVersions(deviceId)
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || `Gagal mencadangkan konfigurasi perangkat "${name}".`)
    } finally {
      setBackingUpDevices(prev => ({ ...prev, [deviceId]: false }))
    }
  }

  // Fetch versions of a device
  const fetchVersions = async (deviceId) => {
    setLoadingVersions(true)
    try {
      const res = await deviceBackupApi.listVersions(deviceId)
      setVersions(res.data)
      setSelectedVersionsForDiff([])
    } catch (e) {
      toast.error('Gagal memuat riwayat versi.')
    } finally {
      setLoadingVersions(false)
    }
  }

  const handleOpenDeviceVersions = (device) => {
    setSelectedDevice(device)
    fetchVersions(device.id)
  }

  // View specific config content
  const handleViewConfig = async (backupId) => {
    try {
      const res = await deviceBackupApi.get(backupId)
      setActiveConfig(res.data)
    } catch (e) {
      toast.error('Gagal mengambil isi konfigurasi.')
    }
  }

  // Checkbox select for diff comparison
  const handleSelectVersionForDiff = (backupId) => {
    setSelectedVersionsForDiff(prev => {
      if (prev.includes(backupId)) {
        return prev.filter(id => id !== backupId)
      }
      if (prev.length >= 2) {
        return [prev[1], backupId] // keep only last two
      }
      return [...prev, backupId]
    })
  }

  // Compare backups
  const handleCompare = async () => {
    if (selectedVersionsForDiff.length !== 2) return
    try {
      const [id1, id2] = selectedVersionsForDiff
      // Sort them so we compare older version to newer version
      // Let's get the version numbers to sort properly
      const v1 = versions.find(v => v.id === id1)
      const v2 = versions.find(v => v.id === id2)
      
      let olderId = id1
      let newerId = id2
      if (v1 && v2 && v1.version > v2.version) {
        olderId = id2
        newerId = id1
      }

      const res = await deviceBackupApi.diff(olderId, newerId)
      setActiveDiff(res.data)
    } catch (e) {
      toast.error('Gagal membandingkan konfigurasi.')
    }
  }

  // Delete version
  const handleDeleteVersion = async (backupId, versionNum) => {
    if (isViewer) return
    if (!confirm(`Yakin ingin menghapus cadangan versi ${versionNum}?`)) return
    try {
      await deviceBackupApi.remove(backupId)
      toast.success('Cadangan versi berhasil dihapus.')
      if (selectedDevice) {
        fetchVersions(selectedDevice.id)
      }
      fetchData()
    } catch (e) {
      toast.error('Gagal menghapus cadangan.')
    }
  }

  // Copy config content to clipboard
  const handleCopyContent = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Konfigurasi disalin ke clipboard.')
  }

  // Download config file
  const handleDownloadConfig = (deviceName, version, content) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${deviceName.toLowerCase()}_config_v${version}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('File konfigurasi berhasil diunduh.')
  }

  // Schedule Modal
  const handleOpenScheduleModal = (sched = null) => {
    if (isViewer) return
    if (sched) {
      setEditingSchedule(sched)
      setSchedName(sched.name)
      if (sched.device_ids === 'all') {
        setSchedTarget('all')
        setSchedTargetDevices([])
      } else {
        setSchedTarget('custom')
        setSchedTargetDevices(sched.device_ids.split(',').map(x => parseInt(x.trim(), 10)))
      }
      setSchedFreq(sched.frequency)
      setSchedTime(sched.time)
      setSchedDayOfWeek(sched.day_of_week)
    } else {
      setEditingSchedule(null)
      setSchedName('')
      setSchedTarget('all')
      setSchedTargetDevices([])
      setSchedFreq('daily')
      setSchedTime('02:00')
      setSchedDayOfWeek(0)
    }
    setShowScheduleModal(true)
  }

  const handleToggleDeviceTargetSelection = (deviceId) => {
    setSchedTargetDevices(prev => {
      if (prev.includes(deviceId)) {
        return prev.filter(id => id !== deviceId)
      }
      return [...prev, deviceId]
    })
  }

  // Save Schedule
  const handleSaveSchedule = async (e) => {
    e.preventDefault()
    if (isViewer || savingSchedule) return
    if (!schedName.trim()) {
      toast.error('Masukkan nama jadwal.')
      return
    }
    if (schedTarget === 'custom' && schedTargetDevices.length === 0) {
      toast.error('Pilih minimal satu perangkat target.')
      return
    }

    const payload = {
      name: schedName,
      device_ids: schedTarget === 'all' ? 'all' : schedTargetDevices.join(','),
      frequency: schedFreq,
      time: schedFreq !== 'hourly' ? schedTime : '',
      day_of_week: schedFreq === 'weekly' ? schedDayOfWeek : 0,
      is_active: editingSchedule ? editingSchedule.is_active : 1
    }

    setSavingSchedule(true)
    try {
      if (editingSchedule) {
        await deviceBackupApi.updateSchedule(editingSchedule.id, payload)
        toast.success('Jadwal backup berhasil diperbarui.')
      } else {
        await deviceBackupApi.createSchedule(payload)
        toast.success('Jadwal backup baru berhasil dibuat.')
      }
      setShowScheduleModal(false)
      fetchData()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan jadwal backup.')
    } finally {
      setSavingSchedule(false)
    }
  }

  // Delete Schedule
  const handleDeleteSchedule = async (schedId, name) => {
    if (isViewer) return
    if (!confirm(`Yakin ingin menghapus jadwal backup "${name}"?`)) return
    try {
      await deviceBackupApi.removeSchedule(schedId)
      toast.success('Jadwal backup berhasil dihapus.')
      fetchData()
    } catch (e) {
      toast.error('Gagal menghapus jadwal.')
    }
  }

  // Toggle Schedule is_active status
  const handleToggleScheduleActive = async (sched) => {
    if (isViewer) return
    const newStatus = sched.is_active === 1 ? 0 : 1
    try {
      await deviceBackupApi.updateSchedule(sched.id, { is_active: newStatus })
      toast.success(`Jadwal "${sched.name}" ${newStatus === 1 ? 'diaktifkan' : 'dinonaktifkan'}.`)
      fetchData()
    } catch (e) {
      toast.error('Gagal mengubah status jadwal.')
    }
  }

  // Trigger Schedule manually now
  const handleRunScheduleNow = async (schedId, name) => {
    if (isViewer) return
    try {
      await deviceBackupApi.runSchedule(schedId)
      toast.success(`Jadwal "${name}" mulai dieksekusi di latar belakang.`)
    } catch (e) {
      toast.error('Gagal menjalankan jadwal.')
    }
  }

  // Helper date parsing
  const formatTime = (isoString) => {
    if (!isoString) return '—'
    return new Date(isoString).toLocaleString('id-ID')
  }

  // Helper format day
  const getDayName = (dayIndex) => {
    const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
    return days[dayIndex] || 'Senin'
  }

  // Filter & Slice Devices
  const filteredDevices = devices.filter(d => {
    const s = searchDevice.toLowerCase()
    return d.name.toLowerCase().includes(s) || 
           d.ip.includes(s) || 
           (d.device_type && d.device_type.toLowerCase().includes(s))
  })
  const startIndexDevice = (pageDevice - 1) * limit
  const paginatedDevices = filteredDevices.slice(startIndexDevice, startIndexDevice + limit)
  const totalPagesDevice = Math.ceil(filteredDevices.length / limit) || 1

  // Filter & Slice Schedules
  const filteredSchedules = schedules.filter(s => {
    const q = searchSchedule.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.frequency.toLowerCase().includes(q)
  })
  const startIndexSchedule = (pageSchedule - 1) * limit
  const paginatedSchedules = filteredSchedules.slice(startIndexSchedule, startIndexSchedule + limit)
  const totalPagesSchedule = Math.ceil(filteredSchedules.length / limit) || 1

  // Filter & Slice Logs
  const filteredLogs = logs.filter(log => {
    const q = searchLog.toLowerCase()
    return log.device_name.toLowerCase().includes(q) || 
           log.device_ip.includes(q) || 
           (log.error_message && log.error_message.toLowerCase().includes(q))
  })
  const startIndexLog = (pageLog - 1) * limit
  const paginatedLogs = filteredLogs.slice(startIndexLog, startIndexLog + limit)
  const totalPagesLog = Math.ceil(filteredLogs.length / limit) || 1

  return (
    <div className="page-container animate-fade">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <Server size={22} style={{ color: 'var(--primary)' }} />
            Backup Konfigurasi Perangkat
          </div>
          <div className="page-subtitle">
            Cadangkan konfigurasi perangkat jaringan secara manual atau terjadwal.
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="tab-bar">
        <button 
          className={`tab-btn ${activeTab === 'backups' ? 'active' : ''}`}
          onClick={() => setActiveTab('backups')}
        >
          <Server size={14} /> Perangkat Jaringan
        </button>
        <button 
          className={`tab-btn ${activeTab === 'schedules' ? 'active' : ''}`}
          onClick={() => setActiveTab('schedules')}
        >
          <Calendar size={14} /> Jadwal Backup
        </button>
        <button 
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <History size={14} /> Log Eksekusi
        </button>
      </div>

      {/* ─── TAB CONTENT: BACKUPS ─── */}
      {activeTab === 'backups' && (
        <div className="grid-layout" style={{ display: 'grid', gridTemplateColumns: selectedDevice ? `1fr ${rightPanelWidth}px` : '1fr', gap: '20px' }}>
          {/* Main Device List */}
          <div className="card">
            <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Daftar Perangkat Jaringan</h3>
              <button className="btn btn-ghost btn-sm" onClick={fetchData} disabled={loading}>
                <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
              </button>
            </div>

            {/* Search Box */}
            <div className="search-box mb-16" style={{ maxWidth: '320px' }}>
              <Search className="search-icon" size={14} />
              <input 
                placeholder="Cari nama atau IP perangkat..." 
                value={searchDevice} 
                onChange={e => setSearchDevice(e.target.value)} 
                style={{ fontSize: '12.5px' }}
              />
            </div>

            {loading ? (
              <div className="loading-overlay" style={{ minHeight: '200px' }}>
                <div className="loading-spinner" />
                Memuat perangkat...
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="empty-state" style={{ minHeight: '200px' }}>
                <Server size={32} className="text-muted" />
                <div className="empty-title">Tidak ada perangkat ditemukan</div>
                <div className="empty-desc">Tambahkan perangkat atau sesuaikan filter pencarian Anda.</div>
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Nama Device</th>
                        <th>IP Address</th>
                        <th>Status Backup Terakhir</th>
                        <th>Waktu Backup Terakhir</th>
                        <th>Versi Terakhir</th>
                        <th style={{ textAlign: 'right' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedDevices.map(d => {
                        const isSelected = selectedDevice?.id === d.id
                        const st = d.last_backup_status || 'unknown'
                        return (
                          <tr key={d.id} className={isSelected ? 'active-row' : ''} style={{ background: isSelected ? 'var(--primary-dim)' : 'transparent' }}>
                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span 
                                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={() => handleOpenDeviceVersions(d)}
                                >
                                  {d.name}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                  {d.device_type?.replace('_', ' ')}
                                </span>
                              </div>
                            </td>
                            <td className="mono">{d.ip}</td>
                            <td>
                              {d.last_backup_status ? (
                                <span className={`badge ${st === 'success' ? 'badge-online' : 'badge-offline'}`}>
                                  {st === 'success' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                  {st === 'success' ? 'Berhasil' : 'Gagal'}
                                </span>
                              ) : (
                                <span className="badge badge-unknown">Belum Ada</span>
                              )}
                            </td>
                            <td className="mono" style={{ fontSize: '11.5px' }}>
                              {d.last_backup_time ? formatTime(d.last_backup_time) : '—'}
                            </td>
                            <td className="mono" style={{ fontWeight: 'bold' }}>
                              {d.latest_version ? `v${d.latest_version}` : '—'}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                                <button 
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleOpenDeviceVersions(d)}
                                >
                                  <Eye size={12} /> Versi
                                </button>
                                {!isViewer && (
                                  <button 
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleBackupNow(d.id, d.name)}
                                    disabled={backingUpDevices[d.id]}
                                  >
                                    {backingUpDevices[d.id] ? (
                                      <span className="loading-spinner" style={{ width: 12, height: 12, borderTopColor: '#fff' }} />
                                    ) : (
                                      <Play size={11} />
                                    )}
                                    Backup
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <div className="text-muted" style={{ fontSize: '12.5px' }}>
                    Menampilkan perangkat ke-{filteredDevices.length === 0 ? 0 : startIndexDevice + 1} s.d. {Math.min(pageDevice * limit, filteredDevices.length)} dari {filteredDevices.length} perangkat
                  </div>
                  <div className="flex-center gap-12">
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPageDevice(p => Math.max(p - 1, 1))}
                      disabled={pageDevice === 1 || loading}
                    >
                      <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                    </button>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Halaman {pageDevice} dari {totalPagesDevice}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPageDevice(p => Math.min(p + 1, totalPagesDevice))}
                      disabled={pageDevice === totalPagesDevice || loading}
                    >
                      Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Panel: Versions List */}
          {selectedDevice && (
            <div className="card animate-slide" style={{ position: 'relative' }}>
              {/* Resize Handle */}
              <div 
                className={`right-panel-resizer ${isResizingRight ? 'resizing' : ''}`} 
                onMouseDown={startResizingRight}
                title="Geser untuk mengatur lebar panel"
              />
              <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Riwayat: {selectedDevice.name}</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pilih 2 versi untuk dikomparasi</p>
                </div>
                <button className="btn-close" onClick={() => setSelectedDevice(null)}>
                  <X size={16} />
                </button>
              </div>

              {loadingVersions ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                  <div className="loading-spinner" />
                </div>
              ) : versions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  Belum ada konfigurasi yang dicadangkan untuk perangkat ini.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button 
                    className="btn btn-ghost btn-sm"
                    disabled={selectedVersionsForDiff.length !== 2}
                    onClick={handleCompare}
                    style={{ width: '100%', justifyContent: 'center', borderColor: 'var(--accent-glow)', color: 'var(--accent)' }}
                  >
                    <GitCompare size={14} /> Bandingkan Versi ({selectedVersionsForDiff.length}/2)
                  </button>

                  <div style={{ maxHeight: '450px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {versions.map(v => {
                      const isSuccess = v.status === 'success'
                      const isChecked = selectedVersionsForDiff.includes(v.id)
                      return (
                        <div 
                          key={v.id} 
                          style={{ 
                            background: 'var(--bg-input)', 
                            border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '10px 12px'
                          }}
                        >
                          <div className="flex-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {isSuccess && (
                                <input 
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleSelectVersionForDiff(v.id)}
                                  style={{ cursor: 'pointer' }}
                                />
                              )}
                              <span style={{ fontWeight: 700, fontSize: '13px', color: isSuccess ? 'var(--text-primary)' : 'var(--danger)' }}>
                                {isSuccess ? `Versi ${v.version}` : 'Gagal'}
                              </span>
                            </div>
                            <div className="flex-center" style={{ gap: '4px' }}>
                              {isSuccess && (
                                <>
                                  <button 
                                    className="btn btn-ghost btn-sm" 
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                    onClick={() => handleViewConfig(v.id)}
                                    title="Lihat isi file"
                                  >
                                    <Eye size={10} />
                                  </button>
                                </>
                              )}
                              {!isViewer && (
                                <button 
                                  className="btn btn-danger btn-sm"
                                  style={{ padding: '2px 6px', fontSize: '10px' }}
                                  onClick={() => handleDeleteVersion(v.id, v.version)}
                                  title="Hapus versi"
                                >
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{formatTime(v.created_at)}</span>
                            {isSuccess ? (
                              <span className="mono">{(v.size / 1024).toFixed(1)} KB</span>
                            ) : (
                              <span 
                                className="text-danger" 
                                style={{ textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px' }}
                                onClick={() => alert(v.error_message)}
                              >
                                <Info size={10} /> Error Info
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB CONTENT: SCHEDULES ─── */}
      {activeTab === 'schedules' && (
        <div className="card">
          <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Jadwal Backup Otomatis</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Cadangkan konfigurasi secara berkala di latar belakang.</p>
            </div>
            {!isViewer && (
              <button className="btn btn-primary btn-sm" onClick={() => handleOpenScheduleModal(null)}>
                <Plus size={14} /> Buat Jadwal Baru
              </button>
            )}
          </div>

          {/* Search Box */}
          <div className="search-box mb-16" style={{ maxWidth: '320px' }}>
            <Search className="search-icon" size={14} />
            <input 
              placeholder="Cari nama jadwal..." 
              value={searchSchedule} 
              onChange={e => setSearchSchedule(e.target.value)} 
              style={{ fontSize: '12.5px' }}
            />
          </div>

          {loading ? (
            <div className="loading-overlay" style={{ minHeight: '200px' }}>
              <div className="loading-spinner" />
              Memuat jadwal...
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '200px' }}>
              <Calendar size={32} className="text-muted" />
              <div className="empty-title">Tidak ada jadwal ditemukan</div>
              <div className="empty-desc">Jalankan jadwal baru atau sesuaikan filter pencarian Anda.</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Nama Jadwal</th>
                      <th>Frekuensi</th>
                      <th>Detail Waktu</th>
                      <th>Target Perangkat</th>
                      <th>Waktu Terakhir</th>
                      <th>Waktu Berikutnya</th>
                      <th style={{ textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSchedules.map(s => {
                      const isActive = s.is_active === 1
                      return (
                        <tr key={s.id}>
                          <td>
                            <button 
                              style={{ background: 'none', border: 'none', cursor: isViewer ? 'default' : 'pointer' }}
                              onClick={() => handleToggleScheduleActive(s)}
                              disabled={isViewer}
                            >
                              {isActive ? (
                                <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <ToggleRight size={24} /> <span style={{ fontSize: '11px', fontWeight: 700 }}>AKTIF</span>
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <ToggleLeft size={24} /> <span style={{ fontSize: '11px', fontWeight: 700 }}>NONAKTIF</span>
                                </span>
                              )}
                            </button>
                          </td>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</td>
                          <td style={{ textTransform: 'capitalize' }}>
                            <span className="badge badge-ssh">{s.frequency}</span>
                          </td>
                          <td>
                            {s.frequency === 'hourly' && 'Setiap jam'}
                            {s.frequency === 'daily' && `Setiap hari jam ${s.time}`}
                            {s.frequency === 'weekly' && `Setiap hari ${getDayName(s.day_of_week)} jam ${s.time}`}
                          </td>
                          <td>
                            {s.device_ids === 'all' ? (
                              <span className="badge badge-online" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>Semua Perangkat</span>
                            ) : (
                              <span>{s.device_ids.split(',').length} Perangkat</span>
                            )}
                          </td>
                          <td className="mono" style={{ fontSize: '11.5px' }}>
                            {s.last_run ? formatTime(s.last_run) : '—'}
                          </td>
                          <td className="mono" style={{ fontSize: '11.5px', color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>
                            {isActive ? formatTime(s.next_run) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                              {!isViewer && (
                                <>
                                  <button 
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleRunScheduleNow(s.id, s.name)}
                                    title="Jalankan instan di latar belakang"
                                  >
                                    <Play size={12} />
                                  </button>
                                  <button 
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleOpenScheduleModal(s)}
                                  >
                                    Edit
                                  </button>
                                  <button 
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleDeleteSchedule(s.id, s.name)}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <div className="text-muted" style={{ fontSize: '12.5px' }}>
                  Menampilkan {startIndexSchedule + 1} - {Math.min(pageSchedule * limit, filteredSchedules.length)} dari {filteredSchedules.length} jadwal
                </div>
                <div className="flex-center gap-12">
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPageSchedule(p => Math.max(p - 1, 1))}
                    disabled={pageSchedule === 1 || loading}
                  >
                    <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Halaman {pageSchedule} dari {totalPagesSchedule}
                  </span>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPageSchedule(p => Math.min(p + 1, totalPagesSchedule))}
                    disabled={pageSchedule === totalPagesSchedule || loading}
                  >
                    Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── TAB CONTENT: LOGS ─── */}
      {activeTab === 'logs' && (
        <div className="card">
          <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Log Eksekusi Backup</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Daftar riwayat seluruh eksekusi backup konfigurasi.</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={fetchData} disabled={loading}>
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
            </button>
          </div>

          {/* Search Box */}
          <div className="search-box mb-16" style={{ maxWidth: '320px' }}>
            <Search className="search-icon" size={14} />
            <input 
              placeholder="Cari nama device, IP, atau pesan error..." 
              value={searchLog} 
              onChange={e => setSearchLog(e.target.value)} 
              style={{ fontSize: '12.5px' }}
            />
          </div>

          {loading ? (
            <div className="loading-overlay" style={{ minHeight: '200px' }}>
              <div className="loading-spinner" />
              Memuat log...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '200px' }}>
              <History size={32} className="text-muted" />
              <div className="empty-title">Tidak ada log ditemukan</div>
              <div className="empty-desc">Jalankan backup manual atau aktifkan jadwal backup, atau sesuaikan filter pencarian.</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Nama Device</th>
                      <th>IP Address</th>
                      <th>Status</th>
                      <th>Detail Versi / Pesan Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLogs.map(log => {
                      const isSuccess = log.status === 'success'
                      return (
                        <tr key={log.id}>
                          <td className="mono" style={{ fontSize: '11.5px' }}>{formatTime(log.created_at)}</td>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.device_name}</td>
                          <td className="mono">{log.device_ip}</td>
                          <td>
                            <span className={`badge ${isSuccess ? 'badge-online' : 'badge-offline'}`}>
                              {isSuccess ? <CheckCircle size={10} /> : <XCircle size={10} />}
                              {isSuccess ? 'Berhasil' : 'Gagal'}
                            </span>
                          </td>
                          <td>
                            {isSuccess ? (
                              <span className="mono" style={{ fontWeight: 'bold' }}>v{log.version} ({(log.size / 1024).toFixed(1)} KB)</span>
                            ) : (
                              <span className="text-danger" style={{ fontSize: '12px' }}>{log.error_message}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex-between mt-16" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <div className="text-muted" style={{ fontSize: '12.5px' }}>
                  Menampilkan {startIndexLog + 1} - {Math.min(pageLog * limit, filteredLogs.length)} dari {filteredLogs.length} entri log
                </div>
                <div className="flex-center gap-12">
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPageLog(p => Math.max(p - 1, 1))}
                    disabled={pageLog === 1 || loading}
                  >
                    <ChevronLeft size={14} style={{ marginRight: '4px' }} /> Sebelum
                  </button>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Halaman {pageLog} dari {totalPagesLog}
                  </span>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPageLog(p => Math.min(p + 1, totalPagesLog))}
                    disabled={pageLog === totalPagesLog || loading}
                  >
                    Berikut <ChevronRight size={14} style={{ marginLeft: '4px' }} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── MODAL: VIEW CONFIG CONTENT ─── */}
      {activeConfig && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setActiveConfig(null)}>
          <div className="modal animate-slide" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="modal-header">
              <div className="modal-title">
                <FileCode size={16} /> Konfigurasi {activeConfig.device_name} (Versi {activeConfig.version})
              </div>
              <button className="btn-close" onClick={() => setActiveConfig(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleCopyContent(activeConfig.config_content)}
                >
                  <Copy size={12} /> Salin Teks
                </button>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => handleDownloadConfig(activeConfig.device_name, activeConfig.version, activeConfig.config_content)}
                >
                  <Download size={12} /> Unduh File TXT
                </button>
              </div>

              <pre 
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  maxHeight: '450px',
                  overflowY: 'auto',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  lineHeight: '1.6',
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {activeConfig.config_content}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setActiveConfig(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: DIFF COMPARISON VIEWER ─── */}
      {activeDiff && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setActiveDiff(null)}>
          <div className="modal animate-slide" style={{ maxWidth: '960px', width: '95%' }}>
            <div className="modal-header">
              <div className="modal-title">
                <GitCompare size={16} /> Komparasi Konfigurasi: {activeDiff.device_name}
              </div>
              <button className="btn-close" onClick={() => setActiveDiff(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', padding: '0 8px' }}>
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>(-) Model Lama (Versi {activeDiff.version1})</span>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>(+) Model Baru (Versi {activeDiff.version2})</span>
              </div>

              <div 
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '16px',
                  maxHeight: '480px',
                  overflowY: 'auto',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  lineHeight: '1.6',
                }}
              >
                {activeDiff.diff.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    Tidak ada perbedaan konfigurasi terdeteksi di antara kedua versi ini.
                  </div>
                ) : (
                  activeDiff.diff.map((line, idx) => {
                    let lineStyle = { 
                      padding: '2px 8px', 
                      whiteSpace: 'pre-wrap', 
                      borderRadius: '4px', 
                      margin: '1px 0' 
                    }
                    if (line.type === 'added') {
                      lineStyle.background = 'rgba(16, 185, 129, 0.15)'
                      lineStyle.color = 'var(--success)'
                    } else if (line.type === 'removed') {
                      lineStyle.background = 'rgba(239, 68, 68, 0.15)'
                      lineStyle.color = 'var(--danger)'
                    } else if (line.type === 'header') {
                      lineStyle.color = 'var(--purple)'
                      lineStyle.fontWeight = 'bold'
                    } else {
                      lineStyle.color = 'var(--text-secondary)'
                    }
                    return (
                      <div key={idx} style={lineStyle}>
                        {line.text}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setActiveDiff(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: ADD / EDIT SCHEDULE ─── */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !savingSchedule && setShowScheduleModal(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '500px' }}>
            <form onSubmit={handleSaveSchedule}>
              <div className="modal-header">
                <div className="modal-title">
                  <Calendar size={16} /> {editingSchedule ? 'Edit Jadwal Backup' : 'Buat Jadwal Backup Baru'}
                </div>
                <button type="button" className="btn-close" onClick={() => setShowScheduleModal(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nama Jadwal</label>
                  <input 
                    className="form-control"
                    placeholder="Contoh: Backup Harian Juniper"
                    value={schedName}
                    onChange={e => setSchedName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Target Perangkat</label>
                  <select 
                    className="form-control"
                    value={schedTarget}
                    onChange={e => setSchedTarget(e.target.value)}
                  >
                    <option value="all">Semua Perangkat Jaringan</option>
                    <option value="custom">Pilih Perangkat Secara Manual</option>
                  </select>
                </div>

                {schedTarget === 'custom' && (
                  <div className="form-group">
                    <label className="form-label" style={{ marginBottom: '8px' }}>Pilih Perangkat Target</label>
                    <div 
                      style={{ 
                        border: '1px solid var(--border)', 
                        borderRadius: 'var(--radius-sm)', 
                        padding: '10px', 
                        maxHeight: '140px', 
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        background: 'var(--bg-input)'
                      }}
                    >
                      {devices.length === 0 ? (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tidak ada perangkat tersedia.</span>
                      ) : (
                        devices.map(d => (
                          <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px' }}>
                            <input 
                              type="checkbox"
                              checked={schedTargetDevices.includes(d.id)}
                              onChange={() => handleToggleDeviceTargetSelection(d.id)}
                            />
                            <span>{d.name} ({d.ip})</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Frekuensi Eksekusi</label>
                  <select 
                    className="form-control"
                    value={schedFreq}
                    onChange={e => setSchedFreq(e.target.value)}
                  >
                    <option value="hourly">Setiap Jam</option>
                    <option value="daily">Setiap Hari</option>
                    <option value="weekly">Setiap Minggu</option>
                  </select>
                </div>

                {schedFreq !== 'hourly' && (
                  <div className="form-group">
                    <label className="form-label">Jam Eksekusi (format 24 jam)</label>
                    <input 
                      type="time" 
                      className="form-control"
                      value={schedTime}
                      onChange={e => setSchedTime(e.target.value)}
                      required
                    />
                  </div>
                )}

                {schedFreq === 'weekly' && (
                  <div className="form-group">
                    <label className="form-label">Hari Eksekusi</label>
                    <select 
                      className="form-control"
                      value={schedDayOfWeek}
                      onChange={e => setSchedDayOfWeek(parseInt(e.target.value))}
                    >
                      <option value={0}>Senin</option>
                      <option value={1}>Selasa</option>
                      <option value={2}>Rabu</option>
                      <option value={3}>Kamis</option>
                      <option value={4}>Jumat</option>
                      <option value={5}>Sabtu</option>
                      <option value={6}>Minggu</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowScheduleModal(false)} disabled={savingSchedule}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingSchedule}>
                  {savingSchedule ? (
                    <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />
                  ) : null}
                  {savingSchedule ? 'Menyimpan...' : 'Simpan Jadwal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
