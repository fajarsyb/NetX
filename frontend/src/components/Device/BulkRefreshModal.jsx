import { useState, useEffect, useRef } from 'react'
import { X, RefreshCw, CheckCircle2, AlertCircle, Play, Info, Search } from 'lucide-react'
import { devicesApi, groupsApi } from '../../api/client'
import { useToast } from '../shared/ToastProvider'

export default function BulkRefreshModal({ onClose, onSuccess, preselectedIds = null }) {
  const [devices, setDevices] = useState([])
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [search, setSearch] = useState('')
  
  // Selection states
  const [selectedDevices, setSelectedDevices] = useState({})
  const [selectedComponents, setSelectedComponents] = useState({
    info: true,
    arp: true,
    lldp: true,
    cdp: true,
    mac: true
  })

  // Task execution states
  const [taskId, setTaskId] = useState(null)
  const [taskStatus, setTaskStatus] = useState(null) // 'running' | 'completed' | 'failed'
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState({})
  const [executing, setExecuting] = useState(false)
  
  const toast = useToast()
  const pollTimerRef = useRef(null)

  useEffect(() => {
    // Load devices and groups
    devicesApi.list().then(res => {
      setDevices(res.data)
      const initialDevs = {}
      if (preselectedIds && preselectedIds.length > 0) {
        // Pre-select only the passed ids
        preselectedIds.forEach(id => { initialDevs[id] = true })
      } else {
        // Default: check all devices
        res.data.forEach(d => { initialDevs[d.id] = true })
      }
      setSelectedDevices(initialDevs)
    }).catch(() => toast.error('Gagal mengambil data perangkat.'))

    groupsApi.list().then(res => setGroups(res.data)).catch(() => {})

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  const handleDeviceCheck = (id) => {
    setSelectedDevices(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleComponentCheck = (comp) => {
    setSelectedComponents(prev => ({ ...prev, [comp]: !prev[comp] }))
  }

  const handleSelectAll = (select) => {
    const updated = {}
    filteredDevices.forEach(d => {
      updated[d.id] = select
    })
    setSelectedDevices(prev => ({ ...prev, ...updated }))
  }

  // Filter devices in list
  const filteredDevices = devices.filter(d => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase()) || d.ip.includes(search)
    const matchGroup = selectedGroup === '' || d.group_id === parseInt(selectedGroup)
    return matchSearch && matchGroup
  })

  // Start the bulk refresh background task
  const handleStartRefresh = async () => {
    const targetDeviceIds = Object.keys(selectedDevices)
      .filter(id => selectedDevices[id])
      .map(id => parseInt(id))

    if (targetDeviceIds.length === 0) {
      toast.error('Harap pilih minimal satu perangkat.')
      return
    }

    const targetComponents = Object.keys(selectedComponents).filter(c => selectedComponents[c])
    if (targetComponents.length === 0) {
      toast.error('Harap pilih minimal satu komponen untuk direfresh.')
      return
    }

    setExecuting(true)
    setTaskStatus('running')
    setProgress({ current: 0, total: targetDeviceIds.length * targetComponents.length })

    try {
      const res = await devicesApi.bulkRefresh({
        device_ids: targetDeviceIds,
        components: targetComponents
      })
      if (res.data.success) {
        setTaskId(res.data.task_id)
        toast.success(res.data.message)
        // Start polling
        startPolling(res.data.task_id)
      } else {
        toast.error('Gagal memulai refresh massal.')
        setExecuting(false)
        setTaskStatus(null)
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal memulai refresh massal.')
      setExecuting(false)
      setTaskStatus(null)
    }
  }

  const startPolling = (tid) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await devicesApi.getBulkRefreshStatus(tid)
        const data = res.data
        setProgress({ current: data.current, total: data.total })
        setResults(data.results)
        setTaskStatus(data.status)

        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollTimerRef.current)
          setExecuting(false)
          toast.success('Penyegaran massal telah selesai diproses!')
          onSuccess?.()
        }
      } catch (err) {
        clearInterval(pollTimerRef.current)
        setExecuting(false)
        toast.error('Gagal mengambil status progress refresh.')
      }
    }, 1000)
  }

  // Calculate percentage
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !executing && onClose()}>
      <div className="modal animate-slide" style={{ width: '850px', maxWidth: '95%' }}>
        <div className="modal-header">
          <div className="modal-title">
            <RefreshCw size={18} className={executing ? 'spin' : ''} />
            Penyegaran Massal Perangkat
          </div>
          {!executing && (
            <button className="btn-close" onClick={onClose}><X size={18} /></button>
          )}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
          
          {/* STEP 1: Selections (Only show when not executing) */}
          {!executing && taskStatus !== 'completed' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
              
              {/* Left Column: Device Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>1. Pilih Perangkat Target</span>
                
                {/* Search & Group */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div className="search-box" style={{ flex: 1 }}>
                    <Search className="search-icon" size={14} />
                    <input 
                      style={{ height: '32px', fontSize: '12px' }}
                      placeholder="Cari..." 
                      value={search} 
                      onChange={e => setSearch(e.target.value)} 
                    />
                  </div>
                  <select 
                    className="form-control" 
                    style={{ flex: '0 0 130px', height: '32px', padding: '0 8px', fontSize: '12px' }}
                    value={selectedGroup} 
                    onChange={e => setSelectedGroup(e.target.value)}
                  >
                    <option value="">Semua Group</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>

                {/* Device List with Checkboxes */}
                <div className="card" style={{ padding: '8px', maxHeight: '280px', overflowY: 'auto', background: 'var(--bg-card-2)' }}>
                  <div className="flex-between" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{filteredDevices.length} Perangkat</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: '10px', padding: '2px 6px' }} onClick={() => handleSelectAll(true)}>Semua</button>
                      <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: '10px', padding: '2px 6px' }} onClick={() => handleSelectAll(false)}>Kosongkan</button>
                    </div>
                  </div>
                  {filteredDevices.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>Tidak ada perangkat cocok.</div>
                  ) : (
                    filteredDevices.map(d => (
                      <label key={d.id} className="flex-between" style={{ padding: '6px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12.5px', hover: { background: 'var(--bg-hover)' } }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input 
                            type="checkbox" 
                            checked={!!selectedDevices[d.id]} 
                            onChange={() => handleDeviceCheck(d.id)} 
                          />
                          <span style={{ fontWeight: 600 }}>{d.name}</span>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.ip}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Component Selection & Information */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>2. Pilih Komponen Sinkronisasi</span>
                  <div className="card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-card-2)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={selectedComponents.info} onChange={() => handleComponentCheck('info')} />
                      <div>
                        <strong>Detail Hardware</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>OS Version, Serial Number, dan Hardware Model</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={selectedComponents.arp} onChange={() => handleComponentCheck('arp')} />
                      <div>
                        <strong>Tabel ARP</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pemetaan alamat IP-ke-MAC</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={selectedComponents.lldp} onChange={() => handleComponentCheck('lldp')} />
                      <div>
                        <strong>Tabel LLDP</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Informasi tetangga link perangkat</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={selectedComponents.cdp} onChange={() => handleComponentCheck('cdp')} />
                      <div>
                        <strong>Tabel CDP</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Protokol penemuan Cisco Neighbors</div>
                      </div>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={selectedComponents.mac} onChange={() => handleComponentCheck('mac')} />
                      <div>
                        <strong>Tabel MAC Address</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Cache FDB MAC dan resolusi vendor (OUI)</div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="card" style={{ borderLeft: '3px solid var(--primary)', background: 'var(--bg-secondary)', padding: '12px 14px', fontSize: '12px', lineHeight: '1.6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--primary)', marginBottom: '4px' }}>
                    <Info size={14} /> Pemuatan Cerdas (Sequential)
                  </div>
                  Untuk menghindari beban CPU berlebih dan kegagalan login SSH simultan pada switch, pemindaian berjalan secara berurutan per-perangkat satu demi satu.
                </div>
              </div>

            </div>
          ) : (
            
            /* STEP 2: Progress Mode */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Progress Summary */}
              <div className="card p-20" style={{ background: 'var(--bg-card-2)' }}>
                <div className="flex-between mb-8" style={{ fontSize: '13.5px', fontWeight: 700 }}>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {taskStatus === 'running' ? 'Sedang Memproses Penyelarasan...' : 'Proses Sinkronisasi Selesai!'}
                  </span>
                  <span style={{ color: 'var(--primary)' }}>{pct}% ({progress.current}/{progress.total})</span>
                </div>
                
                {/* Progress bar container */}
                <div style={{ width: '100%', height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)', transition: 'width 0.3s ease' }} />
                </div>
              </div>

              {/* Progress List */}
              <div className="card" style={{ padding: '0', maxHeight: '350px', overflowY: 'auto' }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                  Log Progress Perangkat
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {Object.entries(results).map(([devId, devRes]) => {
                    return (
                      <div key={devId} style={{ display: 'flex', flexDirection: 'column', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                          {devRes.name}
                        </div>
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                          {Object.keys(selectedComponents).filter(c => selectedComponents[c]).map(comp => {
                            const status = devRes[comp] // { success: true } or { success: false, error: '...' } or undefined (waiting)
                            
                            let badgeClass = 'badge-neutral'
                            let statusText = 'Antri'
                            let icon = <span className="loading-spinner" style={{ width: 10, height: 10, margin: 0, border: '1.5px solid var(--text-muted)', borderTopColor: 'transparent' }} />

                            if (status) {
                              if (status.success) {
                                badgeClass = 'badge-online'
                                statusText = 'Sukses'
                                icon = <CheckCircle2 size={11} className="text-success" />
                              } else {
                                badgeClass = 'badge-offline'
                                statusText = 'Gagal'
                                icon = <AlertCircle size={11} className="text-danger" />
                              }
                            } else if (taskStatus === 'running' && !status) {
                              // If running and this device has some active task, or wait
                              const isCurrentDevice = Object.keys(devRes).length > 1 // has some status resolved already or is running
                              if (isCurrentDevice) {
                                statusText = 'Proses'
                                badgeClass = 'badge-warning'
                                icon = <span className="loading-spinner" style={{ width: 10, height: 10, margin: 0 }} />
                              }
                            }

                            return (
                              <div key={comp} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                <span style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-secondary)' }}>{comp}:</span>
                                <span className={`badge ${badgeClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '11px' }} title={status?.error || ''}>
                                  {icon}
                                  {statusText}
                                </span>
                                {status?.error && (
                                  <span style={{ fontSize: '10.5px', color: 'var(--danger)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status.error}>
                                    ({status.error})
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          )}

        </div>

        <div className="modal-footer">
          {!executing ? (
            taskStatus === 'completed' || taskStatus === 'failed' ? (
              <button className="btn btn-primary" onClick={onClose}>Selesai & Tutup</button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={onClose}>Batal</button>
                <button className="btn btn-primary" onClick={handleStartRefresh} style={{ gap: '6px' }}>
                  <Play size={14} />
                  Mulai Refresh Massal
                </button>
              </>
            )
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
              <span className="loading-spinner" style={{ width: 14, height: 14 }} />
              Sedang memproses penyegaran di backend... Jangan tutup halaman ini.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
