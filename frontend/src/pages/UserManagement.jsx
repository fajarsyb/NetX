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

  useEffect(() => {
    fetchUsers()
  }, [])

  const openAdd = () => {
    setEditUser(null)
    setUsername('')
    setPassword('')
    setFullName('')
    setRole('operator')
    setShowModal(true)
  }

  const openEdit = (u) => {
    setEditUser(u)
    setUsername(u.username)
    setPassword('') // Kosongkan untuk edit
    setFullName(u.full_name)
    setRole(u.role)
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editUser) {
        // Update user
        await api.put(`/auth/users/${editUser.id}`, {
          full_name: fullName,
          role: role
        })
        if (password) {
           await api.put(`/auth/users/${editUser.id}/reset-password`, { new_password: password })
        }
        toast.success('User berhasil diupdate.')
      } else {
        // Create user
        await api.post('/auth/users', {
          username, password, full_name: fullName, role
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
