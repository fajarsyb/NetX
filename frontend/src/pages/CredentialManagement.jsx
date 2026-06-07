import { useState, useEffect } from 'react'
import { Key, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { credentialsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

export default function CredentialManagement() {
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  
  // Form state
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  const toast = useToast()

  const fetchCredentials = async () => {
    setLoading(true)
    try {
      const res = await credentialsApi.list()
      setCredentials(res.data)
    } catch (err) {
      toast.error('Gagal mengambil data kredensial.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCredentials()
  }, [])

  const openAdd = () => {
    setName('')
    setUsername('')
    setPassword('')
    setShowPass(false)
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await credentialsApi.create({ name, username, password })
      toast.success('Kredensial berhasil disimpan.')
      setShowModal(false)
      fetchCredentials()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan kredensial.')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Yakin ingin menghapus kredensial ini? Device yang menggunakan kredensial ini tidak akan terhapus, tetapi koneksi ke device tersebut akan gagal jika tidak dikonfigurasi ulang.')) return
    try {
      await credentialsApi.remove(id)
      toast.success('Kredensial berhasil dihapus.')
      fetchCredentials()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus kredensial.')
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Key size={22} style={{ color: 'var(--primary)' }} />
            Manajemen Kredensial
          </div>
          <div className="page-subtitle">Kelola template username dan password untuk perangkat jaringan Anda</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Tambah Kredensial
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay"><div className="loading-spinner" /></div>
        ) : credentials.length === 0 ? (
           <div className="empty-state" style={{ minHeight: '200px' }}>
             <Key size={32} className="text-muted" style={{ marginBottom: '16px' }} />
             <div>Belum ada kredensial yang tersimpan.</div>
           </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Kredensial</th>
                  <th>Username</th>
                  <th>Tanggal Dibuat</th>
                  <th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</td>
                    <td className="font-mono">{c.username}</td>
                    <td>{new Date(c.created_at).toLocaleString('id-ID')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)}>
                          <Trash2 size={14} />
                        </button>
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
                Tambah Kredensial Baru
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nama Kredensial (untuk identifikasi)</label>
                  <input 
                    className="form-control" 
                    placeholder="Kredensial Default Switch" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    required 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input 
                    className="form-control" 
                    placeholder="admin" 
                    value={username} 
                    onChange={e => setUsername(e.target.value)} 
                    required 
                  />
                </div>
                <div className="form-group mb-16">
                  <label className="form-label">Password</label>
                  <div style={{ position: 'relative' }}>
                    <input 
                      className="form-control" 
                      type={showPass ? 'text' : 'password'} 
                      placeholder="••••••••" 
                      value={password} 
                      onChange={e => setPassword(e.target.value)} 
                      required 
                      style={{ paddingRight: '36px' }}
                    />
                    <button type="button"
                      onClick={() => setShowPass(s => !s)}
                      style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
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
