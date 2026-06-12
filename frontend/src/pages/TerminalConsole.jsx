import { useState, useEffect, useRef } from 'react'
import { Terminal, Plus, X, Monitor, ShieldAlert, BookOpen, PanelRight, PanelRightClose, Search } from 'lucide-react'
import api from '../api/client'
import WebCli from '../components/Terminal/WebCli'
import ShellNotes from '../components/Terminal/ShellNotes'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function TerminalConsole() {
  const [tabs, setTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState(null)
  const [showSelectModal, setShowSelectModal] = useState(false)
  const [devices, setDevices] = useState([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [showNotes, setShowNotes] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const { user } = useAuth()
  const toast = useToast()

  // Map: tabId -> ref for WebCli
  const cliRefs = useRef({})

  // Load allowed SSH & Serial devices
  const fetchDevices = async () => {
    setLoadingDevices(true)
    try {
      const res = await api.get('/devices')
      // Allow SSH and Serial protocol devices
      const supported = res.data.filter(d => {
        const proto = (d.protocol || '').toLowerCase()
        return proto === 'ssh' || proto === 'serial'
      })
      setDevices(supported)
    } catch (err) {
      toast.error('Gagal mengambil daftar perangkat.')
    } finally {
      setLoadingDevices(false)
    }
  }

  useEffect(() => {
    fetchDevices()
    
    // Check if redirect has device_id to auto-open
    const queryParams = new URLSearchParams(window.location.search)
    const autoDeviceId = queryParams.get('device_id')
    const autoDeviceName = queryParams.get('device_name')
    if (autoDeviceId) {
      addTab(parseInt(autoDeviceId), autoDeviceName || `Device #${autoDeviceId}`)
      // Clean up URL query parameters
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  const addTab = (deviceId, deviceName) => {
    if (tabs.length >= 8) {
      toast.warning('Maksimal 8 tab terminal aktif dapat dibuka secara bersamaan.')
      return
    }

    const newTabId = `tab_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    const newTab = {
      id: newTabId,
      deviceId,
      name: deviceName || `Device #${deviceId}`
    }

    setTabs([...tabs, newTab])
    setActiveTabId(newTabId)
    setShowSelectModal(false)
  }

  const closeTab = (tabId, e) => {
    e.stopPropagation()
    const tabIndex = tabs.findIndex(t => t.id === tabId)
    const newTabs = tabs.filter(t => t.id !== tabId)
    setTabs(newTabs)
    // Cleanup ref
    delete cliRefs.current[tabId]

    if (activeTabId === tabId) {
      if (newTabs.length > 0) {
        const nextActiveIndex = Math.max(0, tabIndex - 1)
        setActiveTabId(newTabs[nextActiveIndex].id)
      } else {
        setActiveTabId(null)
      }
    }
  }

  const handleOpenAdd = () => {
    if (tabs.length >= 8) {
      toast.warning('Maksimal 8 tab terminal aktif dapat dibuka secara bersamaan.')
      return
    }
    setSearchQuery('')
    setShowSelectModal(true)
  }

  // Execute command on the active terminal from Notes
  const handleExecuteFromNotes = (cmd) => {
    if (!activeTabId) {
      toast.warning('No active terminal tab. Open a device connection first.')
      return
    }
    const ref = cliRefs.current[activeTabId]
    if (ref?.executeCommand) {
      ref.executeCommand(cmd)
    } else {
      toast.error('Terminal not ready yet.')
    }
  }

  // Check user permission for SSH access
  const allowSsh = user?.role === 'admin' || user?.permissions?.allow_ssh === true

  if (!allowSsh) {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state">
          <ShieldAlert size={48} className="text-danger" />
          <h2 className="mt-16">Akses SSH Ditolak</h2>
          <p className="text-muted">Anda tidak memiliki izin untuk menggunakan fitur Web CLI Terminal.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade" style={{ height: 'calc(100vh - 110px)', display: 'flex', flexDirection: 'column', padding: 0 }}>
      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: '12px', flexShrink: 0, padding: '0 20px' }}>
        <div>
          <div className="page-title">
            <Terminal size={22} style={{ color: 'var(--primary)' }} />
            Web CLI Terminal Console
          </div>
          <div className="page-subtitle">SSH & Serial Multi-tab interactive sessions (max 8 connections)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setShowNotes(n => !n)}
            className={`btn btn-sm ${showNotes ? 'btn-primary' : 'btn-ghost'}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            title={showNotes ? 'Hide Notes Panel' : 'Show Notes Panel'}
          >
            {showNotes ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
            <BookOpen size={14} />
            Notes
          </button>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────── */}
      <div style={{ flexGrow: 1, display: 'flex', gap: 0, minHeight: 0, padding: '0 20px 20px 20px' }}>
        {/* ── Terminal Section ──────────────────────────────── */}
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: showNotes ? 12 : 0 }}>
          {/* Tabs Bar */}
          <div className="flex" style={{ borderBottom: '1px solid var(--border)', gap: '4px', paddingBottom: '0px', flexShrink: 0, overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {tabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  padding: '8px 16px',
                  borderTopLeftRadius: 'var(--radius-sm)',
                  borderTopRightRadius: 'var(--radius-sm)',
                  background: activeTabId === tab.id ? 'var(--bg-card)' : 'transparent',
                  border: activeTabId === tab.id ? '1px solid var(--border)' : '1px solid transparent',
                  borderBottom: activeTabId === tab.id ? '1px solid var(--bg-card)' : 'none',
                  marginBottom: activeTabId === tab.id ? '-1px' : '0px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontWeight: activeTabId === tab.id ? 600 : 500,
                  fontSize: '13px',
                  color: activeTabId === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
                  transition: 'all 0.15s ease',
                  zIndex: activeTabId === tab.id ? 2 : 1
                }}
              >
                <Monitor size={14} />
                <span>{tab.name}</span>
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '2px',
                    color: 'var(--text-muted)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease'
                  }}
                  onMouseEnter={(e) => e.target.style.color = 'var(--danger)'}
                  onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            <button
              onClick={handleOpenAdd}
              style={{
                padding: '8px 12px',
                borderTopLeftRadius: 'var(--radius-sm)',
                borderTopRightRadius: 'var(--radius-sm)',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderBottom: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginLeft: '4px',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary)'
                e.currentTarget.style.color = 'var(--primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              <Plus size={13} />
              Open Terminal
            </button>
          </div>

          {/* Terminal Workspace */}
          <div style={{ flexGrow: 1, position: 'relative', background: '#0d1117', border: '1px solid var(--border)', borderTop: 'none', borderBottomLeftRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius)', overflow: 'hidden' }}>
            {tabs.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', padding: '24px', textAlign: 'center' }}>
                <Terminal size={48} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No active terminals.</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Click "Open Terminal" to connect to a device via SSH or Serial.</div>
                </div>
                <button className="btn btn-primary" onClick={handleOpenAdd}>
                  <Plus size={14} /> Connect Device
                </button>
              </div>
            ) : (
              tabs.map(tab => (
                <div
                  key={tab.id}
                  style={{
                    display: activeTabId === tab.id ? 'block' : 'none',
                    height: '100%',
                    width: '100%'
                  }}
                >
                  <div style={{ height: '100%', width: '100%' }}>
                    <WebCli
                      ref={el => { if (el) cliRefs.current[tab.id] = el; else delete cliRefs.current[tab.id] }}
                      deviceId={tab.deviceId}
                      isActive={activeTabId === tab.id}
                      height="100%"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Notes Panel ───────────────────────────────────── */}
        {showNotes && (
          <div style={{
            width: 700,
            minWidth: 560,
            maxWidth: '45%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-card)',
            overflow: 'hidden'
          }}>
            <ShellNotes onExecuteCommand={handleExecuteFromNotes} />
          </div>
        )}
      </div>

      {/* ── Select Device Modal ────────────────────────────── */}
      {showSelectModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowSelectModal(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="modal-title">Connect New Device</div>
            </div>
            <div className="modal-body">
              {loadingDevices ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                  <div className="loading-spinner" />
                </div>
              ) : devices.length === 0 ? (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No SSH or Serial devices found. Make sure the device protocol is set to SSH or Serial.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="search-box" style={{ width: '100%' }}>
                    <Search className="search-icon" size={14} />
                    <input 
                      placeholder="Cari nama, IP, atau tipe..." 
                      value={searchQuery} 
                      onChange={e => setSearchQuery(e.target.value)} 
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>Select Device (SSH / Serial):</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                      {devices.filter(dev => {
                        const q = searchQuery.toLowerCase().trim()
                        if (!q) return true
                        return (
                          (dev.name || '').toLowerCase().includes(q) ||
                          (dev.ip || '').toLowerCase().includes(q) ||
                          (dev.device_type || '').toLowerCase().includes(q)
                        )
                      }).length === 0 ? (
                        <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                          Tidak ada perangkat yang cocok dengan pencarian.
                        </div>
                      ) : (
                        devices.filter(dev => {
                          const q = searchQuery.toLowerCase().trim()
                          if (!q) return true
                          return (
                            (dev.name || '').toLowerCase().includes(q) ||
                            (dev.ip || '').toLowerCase().includes(q) ||
                            (dev.device_type || '').toLowerCase().includes(q)
                          )
                        }).map(dev => (
                          <div
                            key={dev.id}
                            onClick={() => addTab(dev.id, dev.name)}
                            className="flex-between"
                            style={{
                              padding: '10px 14px',
                              background: 'var(--bg-card-2)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--primary)'
                              e.currentTarget.style.background = 'var(--bg-hover)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border)'
                              e.currentTarget.style.background = 'var(--bg-card-2)'
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {dev.name}
                                {dev.protocol !== 'serial' && !(dev.credential_id || dev.username) && (
                                  <span 
                                    style={{ 
                                      fontSize: '10px', 
                                      padding: '1px 6px', 
                                      borderRadius: '4px', 
                                      backgroundColor: 'rgba(245, 158, 11, 0.15)', 
                                      color: 'var(--warning)',
                                      fontWeight: 500
                                    }}
                                    title="Device has no SSH credentials mapped."
                                  >
                                    No Credentials
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{dev.ip}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span className={`badge badge-${dev.protocol}`} style={{ fontSize: '10px' }}>
                                {dev.protocol?.toUpperCase()}
                              </span>
                              <span className="badge badge-online" style={{ fontSize: '10px' }}>
                                {dev.device_type}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSelectModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
