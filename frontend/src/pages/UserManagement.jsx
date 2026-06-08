import { useState, useEffect } from 'react'
import { Users, Plus, Trash2, Edit2, ShieldAlert } from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  
  // Form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('operator')
  
  // Custom permissions state
  const [customPerms, setCustomPerms] = useState(false)
  const [menuPerms, setMenuPerms] = useState([])
  const [featurePerms, setFeaturePerms] = useState([])
  const [allowSsh, setAllowSsh] = useState(true)
  const [allowedGroups, setAllowedGroups] = useState(['*'])
  const [allGroups, setAllGroups] = useState([])

  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/auth/users')
      setUsers(res.data)
    } catch (err) {
      toast.error('Gagal mengambil data user.')
    } finally {
      setLoading(false)
    }
  }

  const fetchGroups = async () => {
    try {
      const res = await api.get('/groups')
      setAllGroups(res.data)
    } catch (_) {}
  }

  useEffect(() => {
    fetchUsers()
    fetchGroups()
  }, [])

  const getDefaultPermissions = (roleName) => {
    if (roleName === 'admin') {
      return {
        menus: ["dashboard", "topology", "investigation", "anomalies", "syslog", "groups", "devices", "audit_logs", "settings"],
        features: ["add_device", "edit_device", "delete_device", "manage_groups", "manage_credentials", "backup_db", "postgresql_config", "threshold_profiles", "snmp_tester", "mibs", "device_backup"],
        groups: ["*"],
        allow_ssh: true
      }
    } else if (roleName === 'operator') {
      return {
        menus: ["dashboard", "topology", "investigation", "anomalies", "syslog", "groups", "devices", "settings"],
        features: ["add_device", "edit_device", "threshold_profiles", "snmp_tester", "mibs", "device_backup"],
        groups: ["*"],
        allow_ssh: true
      }
    } else { // viewer
      return {
        menus: ["dashboard", "topology", "anomalies", "syslog"],
        features: [],
        groups: ["*"],
        allow_ssh: false
      }
    }
  }

  const openAdd = () => {
    setEditUser(null)
    setUsername('')
    setPassword('')
    setFullName('')
    setRole('operator')
    setCustomPerms(false)
    setMenuPerms([])
    setFeaturePerms([])
    setAllowSsh(true)
    setAllowedGroups(['*'])
    setShowModal(true)
  }

  const openEdit = (u) => {
    setEditUser(u)
    setUsername(u.username)
    setPassword('') // Kosongkan untuk edit
    setFullName(u.full_name)
    setRole(u.role)
    if (u.permissions) {
      setCustomPerms(true)
      setMenuPerms(u.permissions.menus || [])
      setFeaturePerms(u.permissions.features || [])
      setAllowSsh(u.permissions.allow_ssh ?? true)
      setAllowedGroups(u.permissions.groups || ['*'])
    } else {
      setCustomPerms(false)
      const defaults = getDefaultPermissions(u.role)
      setMenuPerms(defaults.menus)
      setFeaturePerms(defaults.features)
      setAllowSsh(defaults.allow_ssh)
      setAllowedGroups(defaults.groups)
    }
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const permissionsPayload = customPerms ? {
      menus: menuPerms,
      features: featurePerms,
      groups: allowedGroups,
      allow_ssh: allowSsh
    } : null

    try {
      if (editUser) {
        // Update user
        await api.put(`/auth/users/${editUser.id}`, {
          full_name: fullName,
          role: role,
          permissions: permissionsPayload
        })
        if (password) {
           await api.put(`/auth/users/${editUser.id}/reset-password`, { new_password: password })
        }
        toast.success('User berhasil diupdate.')
      } else {
        // Create user
        await api.post('/auth/users', {
          username, password, full_name: fullName, role,
          permissions: permissionsPayload
        })
        toast.success('User berhasil dibuat.')
      }
      setShowModal(false)
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan user.')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus user ini?')) return
    try {
      await api.delete(`/auth/users/${id}`)
      toast.success('User berhasil dihapus.')
      fetchUsers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus user.')
    }
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state">
          <ShieldAlert size={48} className="text-danger" />
          <h2 className="mt-16">Akses Ditolak</h2>
          <p className="text-muted">Hanya Administrator yang dapat mengakses halaman ini.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Users size={22} style={{ color: 'var(--primary)' }} />
            Manajemen User
          </div>
          <div className="page-subtitle">Kelola akun dan akses NetX</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Tambah User
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay"><div className="loading-spinner" /></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Nama Lengkap</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="font-mono text-primary-color">{u.username}</td>
                    <td>{u.full_name || '—'}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-online' : u.role === 'viewer' ? 'badge-offline' : 'badge-unknown'}`}>
                        {u.role === 'admin' ? 'Administrator' : u.role === 'viewer' ? 'Viewer' : u.role === 'operator' ? 'Operator' : u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-online' : 'badge-offline'}`}>
                        {u.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>
                          <Edit2 size={14} />
                        </button>
                        {u.id !== currentUser.id && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
                {editUser ? 'Edit User' : 'Tambah User Baru'}
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-control" value={username} onChange={e => setUsername(e.target.value)} required disabled={!!editUser} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Lengkap</label>
                  <input className="form-control" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-control" value={role} onChange={e => setRole(e.target.value)}>
                    <option value="viewer">Viewer (Read-Only)</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div className="form-group mb-16">
                  <label className="form-label">{editUser ? 'Password Baru (Kosongkan jika tidak diubah)' : 'Password'}</label>
                  <input className="form-control" type="password" value={password} onChange={e => setPassword(e.target.value)} required={!editUser} minLength={6} />
                </div>

                {/* Custom Permissions (RBAC Editor) */}
                <div className="form-group flex-center" style={{ justifyContent: 'flex-start', gap: '8px', marginTop: '16px' }}>
                  <input 
                    type="checkbox" 
                    id="custom-perms-toggle" 
                    checked={customPerms} 
                    onChange={e => {
                      const checked = e.target.checked
                      setCustomPerms(checked)
                      if (checked) {
                        const defaults = getDefaultPermissions(role)
                        setMenuPerms(defaults.menus)
                        setFeaturePerms(defaults.features)
                        setAllowSsh(defaults.allow_ssh)
                        setAllowedGroups(defaults.groups)
                      }
                    }} 
                  />
                  <label htmlFor="custom-perms-toggle" style={{ fontWeight: 600, cursor: 'pointer', userSelect: 'none', color: 'var(--text-primary)' }}>
                    Kustomisasi Hak Akses (Custom RBAC)
                  </label>
                </div>

                {customPerms && (
                  <div style={{ marginTop: '16px', padding: '16px', background: 'var(--bg-card-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {/* Allow SSH */}
                    <div className="flex-center" style={{ justifyContent: 'flex-start', gap: '8px' }}>
                      <input 
                        type="checkbox" 
                        id="allow-ssh-checkbox" 
                        checked={allowSsh} 
                        onChange={e => setAllowSsh(e.target.checked)} 
                      />
                      <label htmlFor="allow-ssh-checkbox" style={{ fontWeight: 600, cursor: 'pointer', userSelect: 'none', fontSize: '13px' }}>
                        Izinkan Koneksi Terminal SSH
                      </label>
                    </div>

                    {/* Menu Permissions */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                        Akses Menu Halaman
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        {[
                          { key: 'dashboard', label: 'Dashboard' },
                          { key: 'topology', label: 'Network Topology' },
                          { key: 'investigation', label: 'Investigasi' },
                          { key: 'anomalies', label: 'Network Anomalies' },
                          { key: 'syslog', label: 'Syslog Viewer' },
                          { key: 'groups', label: 'Manajemen Group' },
                          { key: 'devices', label: 'Manajemen Device' },
                          { key: 'audit_logs', label: 'Audit Logs' },
                          { key: 'settings', label: 'Settings / Pengaturan' }
                        ].map(m => (
                          <label key={m.key} className="flex-center" style={{ justifyContent: 'flex-start', gap: '6px', cursor: 'pointer', userSelect: 'none', fontSize: '12px' }}>
                            <input 
                              type="checkbox" 
                              checked={menuPerms.includes(m.key)} 
                              onChange={e => {
                                if (e.target.checked) setMenuPerms([...menuPerms, m.key])
                                else setMenuPerms(menuPerms.filter(k => k !== m.key))
                              }} 
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Feature Permissions */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                        Akses Fitur & Aksi
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        {[
                          { key: 'add_device', label: 'Tambah Device' },
                          { key: 'edit_device', label: 'Edit Device' },
                          { key: 'delete_device', label: 'Hapus Device' },
                          { key: 'manage_groups', label: 'Kelola Group' },
                          { key: 'manage_credentials', label: 'Kelola Kredensial' },
                          { key: 'backup_db', label: 'Backup DB Sistem' },
                          { key: 'postgresql_config', label: 'Integrasi PostgreSQL' },
                          { key: 'threshold_profiles', label: 'Profil Threshold' },
                          { key: 'snmp_tester', label: 'SNMP Tester' },
                          { key: 'mibs', label: 'MIB Manager' },
                          { key: 'device_backup', label: 'Backup Config' }
                        ].map(f => (
                          <label key={f.key} className="flex-center" style={{ justifyContent: 'flex-start', gap: '6px', cursor: 'pointer', userSelect: 'none', fontSize: '12px' }}>
                            <input 
                              type="checkbox" 
                              checked={featurePerms.includes(f.key)} 
                              onChange={e => {
                                if (e.target.checked) setFeaturePerms([...featurePerms, f.key])
                                else setFeaturePerms(featurePerms.filter(k => k !== f.key))
                              }} 
                            />
                            {f.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Allowed Groups */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
                        Akses Grup Perangkat
                      </div>
                      <label className="flex-center" style={{ justifyContent: 'flex-start', gap: '6px', cursor: 'pointer', userSelect: 'none', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                        <input 
                          type="checkbox" 
                          checked={allowedGroups.includes('*')} 
                          onChange={e => {
                            if (e.target.checked) setAllowedGroups(['*'])
                            else setAllowedGroups([])
                          }} 
                        />
                        Semua Grup Perangkat (*)
                      </label>

                      {!allowedGroups.includes('*') && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', padding: '10px', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', maxHeight: '120px', overflowY: 'auto' }}>
                          <label className="flex-center" style={{ justifyContent: 'flex-start', gap: '6px', cursor: 'pointer', userSelect: 'none', fontSize: '12px' }}>
                            <input 
                              type="checkbox" 
                              checked={allowedGroups.includes('Ungrouped')} 
                              onChange={e => {
                                if (e.target.checked) setAllowedGroups([...allowedGroups, 'Ungrouped'])
                                else setAllowedGroups(allowedGroups.filter(g => g !== 'Ungrouped'))
                              }} 
                            />
                            Ungrouped
                          </label>
                          {allGroups.map(g => (
                            <label key={g.id} className="flex-center" style={{ justifyContent: 'flex-start', gap: '6px', cursor: 'pointer', userSelect: 'none', fontSize: '12px' }}>
                              <input 
                                type="checkbox" 
                                checked={allowedGroups.includes(g.name)} 
                                onChange={e => {
                                  if (e.target.checked) setAllowedGroups([...allowedGroups, g.name])
                                  else setAllowedGroups(allowedGroups.filter(name => name !== g.name))
                                }} 
                              />
                              {g.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
