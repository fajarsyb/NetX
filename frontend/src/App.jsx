import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import ToastProvider from './components/shared/ToastProvider'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/shared/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={
              <ProtectedRoute>
                <div className="app-layout">
                  <Sidebar />
                  <main className="main-content">
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/device/:id" element={<DeviceDetail />} />
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/groups" element={<GroupManagement />} />
                      <Route path="/credentials" element={<CredentialManagement />} />
                      <Route path="/audit-logs" element={<AuditLogs />} />
                      <Route path="/backup" element={<BackupManagement />} />
                      <Route path="/device-backup" element={<DeviceBackup />} />
                      <Route path="/devices" element={<DeviceManagement />} />
                      <Route path="/snmp-tester" element={<SnmpTester />} />
                      <Route path="/mibs" element={<MibManagement />} />
                      <Route path="/topology" element={<Topology />} />
                      <Route path="/mac-investigation" element={<Navigate to="/investigation" replace />} />
                      <Route path="/investigation" element={<MacInvestigation />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </main>
                </div>
              </ProtectedRoute>
            } />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
