import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Server, LayoutDashboard, Plus, Network, ChevronRight, ChevronDown,
  Radio, Wifi, RefreshCw, LogOut, Users, FolderGit2, ShieldCheck, Map, Key, Search, Settings, FileCode, AlertTriangle, FileText, Database, Activity,
  Sun, Moon
} from 'lucide-react'
import { arpApi } from '../../api/client'
import AddDeviceModal from '../Device/AddDeviceModal'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

export default function Sidebar() {
  const [devices, setDevices]       = useState([])
  const [showAdd, setShowAdd]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [openGroups, setOpenGroups] = useState({ 'Ungrouped': true })
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [openSettings, setOpenSettings] = useState(() => {
    return ['/users', '/credentials', '/credential-scan', '/backup', '/db-settings', '/system-health', '/device-backup', '/snmp-tester', '/mibs'].includes(location.pathname)
  })

  // Resizable Sidebar logic
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('netx_sidebar_width')
    return saved ? parseInt(saved, 10) : 260
  })
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`)
    localStorage.setItem('netx_sidebar_width', sidebarWidth)
  }, [sidebarWidth])

  const startResizing = (e) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return
      const newWidth = Math.max(200, Math.min(e.clientX, 600))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const fetchSummary = async () => {
    setLoading(true)
    try {
      const res = await arpApi.getSummary()
      setDevices(res.data)
    } catch (_) {}
    setLoading(false)
  }

  useEffect(() => {
    fetchSummary()
    const t = setInterval(fetchSummary, 30000)
    return () => clearInterval(t)
  }, [])

  const handleDeviceAdded = () => {
    setShowAdd(false)
    fetchSummary()
  }

  return (
    <>
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">⚡</div>
          <div>
            <div className="sidebar-logo-text">NetX</div>
            <div className="sidebar-logo-version">Network Manager v1.0</div>
          </div>
        </div>

        {/* Main Nav */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Menu</div>

          <NavLink
            to="/"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            end
          >
            <LayoutDashboard className="nav-icon" />
            Dashboard
          </NavLink>

          <NavLink
            to="/topology"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Map className="nav-icon" />
            Network Topology
          </NavLink>

          <NavLink
            to="/investigation"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Search className="nav-icon" />
            Investigasi
          </NavLink>

          <NavLink
            to="/anomalies"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <AlertTriangle className="nav-icon" />
            Network Anomalies
          </NavLink>

          <NavLink
            to="/syslog"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <FileText className="nav-icon" />
            Syslog Viewer
          </NavLink>

          <NavLink
            to="/groups"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <FolderGit2 className="nav-icon" />
            Manajemen Group
          </NavLink>

          <NavLink
            to="/devices"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Server className="nav-icon" />
            Manajemen Device
          </NavLink>

          {user?.role === 'admin' && (
            <NavLink
              to="/audit-logs"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <ShieldCheck className="nav-icon" />
              Audit Logs
            </NavLink>
          )}

          {/* Settings Sub-menu */}
          <button
            type="button"
            className={`nav-link ${['/users', '/credentials', '/credential-scan', '/backup', '/db-settings', '/system-health', '/device-backup', '/snmp-tester', '/mibs'].includes(location.pathname) ? 'active' : ''}`}
            onClick={() => setOpenSettings(prev => !prev)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Settings className="nav-icon" />
              Settings
            </div>
            {openSettings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {openSettings && (
            <div className="submenu">
              {user?.role === 'admin' && (
                <>
                  <NavLink
                    to="/users"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Users className="nav-icon" />
                    Manajemen User
                  </NavLink>
                  <NavLink
                    to="/credentials"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Key className="nav-icon" />
                    Manajemen Kredensial
                  </NavLink>
                  <NavLink
                    to="/credential-scan"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <ShieldCheck className="nav-icon" />
                    Scan Kredensial
                  </NavLink>
                  <NavLink
                    to="/backup"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Server className="nav-icon" />
                    Backup DB Sistem
                  </NavLink>
                  <NavLink
                    to="/db-settings"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Database className="nav-icon" />
                    Integrasi PostgreSQL
                  </NavLink>
                  <NavLink
                    to="/system-health"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Activity className="nav-icon" />
                    Kesehatan Sistem
                  </NavLink>
                </>
              )}
              <NavLink
                to="/device-backup"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FolderGit2 className="nav-icon" />
                Backup Config Perangkat
              </NavLink>
              <NavLink
                to="/snmp-tester"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <Radio className="nav-icon" />
                SNMP Tester
              </NavLink>
              <NavLink
                to="/mibs"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <FileCode className="nav-icon" />
                SNMP MIB Manager
              </NavLink>
            </div>
          )}

          {user?.role !== 'viewer' && (
            <button className="nav-link" onClick={() => setShowAdd(true)}>
              <Plus className="nav-icon" />
              Tambah Device
            </button>
          )}

          <button className="nav-link" onClick={fetchSummary} disabled={loading}>
            <RefreshCw className="nav-icon" style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Refresh Devices
          </button>
        </nav>

        {/* Device List */}
        <div className="sidebar-devices">
          <div className="sidebar-section-label" style={{ padding: '8px 8px 6px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>Devices</span>
            <span style={{ background:'var(--bg-hover)', padding:'1px 7px', borderRadius:'10px', fontSize:'10px', color:'var(--text-muted)' }}>
              {devices.length}
            </span>
          </div>

          {devices.length === 0 && !loading && (
            <div style={{ textAlign:'center', padding:'20px 8px', color:'var(--text-muted)', fontSize:'12px', lineHeight:'1.6' }}>
              Belum ada device.
              {user?.role !== 'viewer' && (
                <>
                  <br/>
                  <span
                    onClick={() => setShowAdd(true)}
                    style={{ color:'var(--primary)', cursor:'pointer', textDecoration:'underline' }}
                  >
                    Tambah sekarang
                  </span>
                </>
              )}
            </div>
          )}

          {loading && devices.length === 0 && (
            <div style={{ display:'flex', justifyContent:'center', padding:'16px' }}>
              <div className="loading-spinner" />
            </div>
          )}

          {/* Grouped Devices */}
          {Object.entries(
            devices.reduce((acc, dev) => {
              const gName = dev.group_name || 'Ungrouped'
              if (!acc[gName]) acc[gName] = []
              acc[gName].push(dev)
              return acc
            }, {})
          ).map(([gName, devs]) => {
            const isOpen = openGroups[gName] !== false
            return (
              <div key={gName} style={{ marginBottom: '8px' }}>
                <div
                  className="device-nav-item"
                  style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', background: 'transparent' }}
                  onClick={() => setOpenGroups(prev => ({ ...prev, [gName]: !isOpen }))}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{gName}</span>
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{devs.length}</span>
                </div>
                
                {isOpen && devs.map(d => (
                  <div
                    key={d.id}
                    className="device-nav-item"
                    style={{ paddingLeft: '28px' }}
                    onClick={() => navigate(`/device/${d.id}`)}
                  >
                    <span
                      className="status-dot"
                      style={{
                        background: d.status === 'online' ? 'var(--success)' : d.status === 'offline' ? 'var(--danger)' : 'var(--text-muted)',
                        boxShadow: d.status === 'online' ? '0 0 6px var(--success)' : 'none',
                      }}
                    />
                    <span className="device-nav-name">{d.name}</span>
                    {d.arp_count > 0 && (
                      <span className="device-nav-count">{d.arp_count}</span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* User Profile */}
        {user && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>
            <div className="flex-between" style={{ alignItems: 'flex-start' }}>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {user.full_name || user.username}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px' }}>
                  {user.role}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={toggleTheme}
                  title={theme === 'dark' ? 'Aktifkan Tema Terang' : 'Aktifkan Tema Gelap'}
                  style={{ padding: '6px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={logout}
                  title="Logout"
                  style={{ padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
      {/* Resize Handle (positioned outside to avoid scrollbar clipping) */}
      <div 
        className={`sidebar-resizer ${isResizing ? 'resizing' : ''}`} 
        onMouseDown={startResizing}
        title="Geser untuk mengatur lebar menu"
      />

      {showAdd && (
        <AddDeviceModal
          onClose={() => setShowAdd(false)}
          onSuccess={handleDeviceAdded}
        />
      )}
    </>
  )
}
