import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Layout/Sidebar'
import Dashboard from './pages/Dashboard'
import DeviceDetail from './pages/DeviceDetail'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'
import GroupManagement from './pages/GroupManagement'
import CredentialManagement from './pages/CredentialManagement'
import AuditLogs from './pages/AuditLogs'
import BackupManagement from './pages/BackupManagement'
import DeviceBackup from './pages/DeviceBackup'
import DeviceManagement from './pages/DeviceManagement'
import SnmpTester from './pages/SnmpTester'
import MibManagement from './pages/MibManagement'
import Topology from './pages/Topology'
import MacInvestigation from './pages/MacInvestigation'
import NetworkAnomalies from './pages/NetworkAnomalies'
import SyslogViewer from './pages/SyslogViewer'
import DatabaseSettings from './pages/DatabaseSettings'
import SystemSettings from './pages/SystemSettings'
import SystemHealth from './pages/SystemHealth'
import CredentialScan from './pages/CredentialScan'
import ToastProvider from './components/shared/ToastProvider'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute from './components/shared/ProtectedRoute'
import ThresholdProfiles from './pages/ThresholdProfiles'
import TerminalConsole from './pages/TerminalConsole'
import PortAnalysis from './pages/PortAnalysis'

function PermissionGuard({ menu, feature, children }) {
  const { user } = useAuth()
  if (!user) return null
  if (user.role === 'admin') return children
  
  if (menu && !user.permissions?.menus?.includes(menu)) {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          <h2 className="mt-16" style={{ color: 'var(--danger)', fontSize: '24px', fontWeight: 'bold' }}>Akses Ditolak</h2>
          <p className="text-muted" style={{ marginTop: '8px' }}>Anda tidak memiliki izin untuk mengakses halaman menu ini.</p>
        </div>
      </div>
    )
  }
  
  if (feature && !user.permissions?.features?.includes(feature)) {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
          <h2 className="mt-16" style={{ color: 'var(--danger)', fontSize: '24px', fontWeight: 'bold' }}>Akses Ditolak</h2>
          <p className="text-muted" style={{ marginTop: '8px' }}>Anda tidak memiliki izin untuk mengakses fitur ini.</p>
        </div>
      </div>
    )
  }
  
  return children
}

function AdminRoute({ children }) {
  const { user } = useAuth()
  if (!user) return null
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return children
}

function AppContent() {
  const location = useLocation()
  const isTerminalPage = location.pathname === '/terminal'

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={
        <ProtectedRoute>
          <div className="app-layout">
            <Sidebar />
            <main className="main-content" style={{ position: 'relative', height: '100%' }}>
              {/* Persist Terminal Console across navigation */}
              <div style={{ display: isTerminalPage ? 'block' : 'none', height: '100%' }}>
                <PermissionGuard menu="terminal">
                  <TerminalConsole isPageActive={isTerminalPage} />
                </PermissionGuard>
              </div>

              {/* Standard routes content (only rendered when not on terminal page) */}
              <div style={{ display: !isTerminalPage ? 'block' : 'none', height: '100%' }}>
                <Routes>
                  <Route path="/" element={<PermissionGuard menu="dashboard"><Dashboard /></PermissionGuard>} />
                  <Route path="/device/:id" element={<DeviceDetail />} />
                  <Route path="/port-analysis" element={<PermissionGuard menu="devices"><PortAnalysis /></PermissionGuard>} />
                  <Route path="/device/:id/port-analysis" element={<PermissionGuard menu="devices"><PortAnalysis /></PermissionGuard>} />
                  <Route path="/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
                  <Route path="/groups" element={<PermissionGuard menu="groups"><GroupManagement /></PermissionGuard>} />
                  <Route path="/credentials" element={<PermissionGuard menu="settings" feature="manage_credentials"><CredentialManagement /></PermissionGuard>} />
                  <Route path="/credential-scan" element={<PermissionGuard menu="settings" feature="manage_credentials"><CredentialScan /></PermissionGuard>} />
                  <Route path="/audit-logs" element={<PermissionGuard menu="audit_logs"><AuditLogs /></PermissionGuard>} />
                  <Route path="/backup" element={<PermissionGuard menu="settings" feature="backup_db"><BackupManagement /></PermissionGuard>} />
                  <Route path="/db-settings" element={<PermissionGuard menu="settings" feature="postgresql_config"><DatabaseSettings /></PermissionGuard>} />
                  <Route path="/system-settings" element={<PermissionGuard menu="settings" feature="system_settings"><SystemSettings /></PermissionGuard>} />
                  <Route path="/system-health" element={<AdminRoute><SystemHealth /></AdminRoute>} />
                  <Route path="/device-backup" element={<PermissionGuard menu="settings" feature="device_backup"><DeviceBackup /></PermissionGuard>} />
                  <Route path="/devices" element={<PermissionGuard menu="devices"><DeviceManagement /></PermissionGuard>} />
                  <Route path="/thresholds" element={<PermissionGuard menu="settings" feature="threshold_profiles"><ThresholdProfiles /></PermissionGuard>} />
                  <Route path="/snmp-tester" element={<PermissionGuard menu="settings" feature="snmp_tester"><SnmpTester /></PermissionGuard>} />
                  <Route path="/mibs" element={<PermissionGuard menu="settings" feature="mibs"><MibManagement /></PermissionGuard>} />
                  <Route path="/topology" element={<PermissionGuard menu="topology"><Topology /></PermissionGuard>} />
                  <Route path="/mac-investigation" element={<Navigate to="/investigation" replace />} />
                  <Route path="/investigation" element={<PermissionGuard menu="investigation"><MacInvestigation /></PermissionGuard>} />
                  <Route path="/anomalies" element={<PermissionGuard menu="anomalies"><NetworkAnomalies /></PermissionGuard>} />
                  <Route path="/syslog" element={<PermissionGuard menu="syslog"><SyslogViewer /></PermissionGuard>} />
                  <Route path="/terminal" element={<div />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </main>
          </div>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
