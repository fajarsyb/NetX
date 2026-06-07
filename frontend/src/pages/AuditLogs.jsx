import { useState, useEffect } from 'react'
import { ShieldCheck, ShieldAlert, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { auditLogsApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

const ACTIONS = [
  { value: '', label: 'Semua Aksi' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'CREATE_USER', label: 'Tambah User' },
  { value: 'UPDATE_USER', label: 'Update User' },
  { value: 'DELETE_USER', label: 'Hapus User' },
  { value: 'RESET_PASSWORD', label: 'Reset Password User' },
  { value: 'CHANGE_PASSWORD', label: 'Ubah Password Mandiri' },
  { value: 'CREATE_DEVICE', label: 'Tambah Device' },
  { value: 'UPDATE_DEVICE', label: 'Update Device' },
  { value: 'DELETE_DEVICE', label: 'Hapus Device' },
  { value: 'CREATE_GROUP', label: 'Tambah Group' },
  { value: 'UPDATE_GROUP', label: 'Update Group' },
  { value: 'DELETE_GROUP', label: 'Hapus Group' },
  { value: 'REFRESH_SUCCESS', label: 'Refresh Device Sukses' },
  { value: 'REFRESH_FAIL', label: 'Refresh Device Gagal' },
  { value: 'REFRESH_GROUP_DEVICES', label: 'Refresh Group Devices' },
  { value: 'CREATE_CREDENTIAL', label: 'Tambah Kredensial' },
  { value: 'DELETE_CREDENTIAL', label: 'Hapus Kredensial' },
  { value: 'CREATE_BACKUP', label: 'Buat Backup' },
  { value: 'RESTORE_BACKUP', label: 'Restore Backup' },
  { value: 'DELETE_BACKUP', label: 'Hapus Backup' },
]

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await auditLogsApi.list({
        page,
        limit,
        action: action || undefined,
        search: search || undefined
      })
      setLogs(res.data.logs)
      setTotal(res.data.total)
    } catch (err) {
      toast.error('Gagal mengambil data log audit.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [page, action, search])

  if (currentUser?.role !== 'admin') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <ShieldAlert size={48} className="text-danger" style={{ marginBottom: '16px' }} />
          <div className="empty-title">Akses Ditolak</div>
          <div className="empty-desc">Hanya Administrator yang dapat mengakses halaman log audit ini.</div>
        </div>
      </div>
    )
  }

  const getActionBadgeClass = (act) => {
    if (act.startsWith('CREATE_') || act === 'LOGIN' || act === 'REFRESH_SUCCESS') return 'badge-online'
    if (act.startsWith('DELETE_') || act === 'REFRESH_FAIL') return 'badge-offline'
    if (act.startsWith('UPDATE_') || act === 'RESET_PASSWORD' || act === 'CHANGE_PASSWORD') return 'badge-telnet'
    return 'badge-unknown'
  }

  const totalPages = Math.ceil(total / limit) || 1

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <ShieldCheck size={22} style={{ color: 'var(--primary)' }} />
            Audit Logs
          </div>
          <div className="page-subtitle">Daftar riwayat aktivitas dan konfigurasi sistem oleh pengguna</div>
        </div>
      </div>

      {/* Filter Card */}
      <div className="card mb-16" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Search Box */}
          <div className="search-box" style={{ flex: '1 1 240px' }}>
            <Search className="search-icon" />
            <input 
              placeholder="Cari kata kunci log..." 
              value={search} 
              onChange={e => { setSearch(e.target.value); setPage(1); }} 
            />
          </div>

          {/* Action Filter */}
          <div style={{ flex: '0 0 200px' }}>
            <select 
              className="form-control"
              value={action}
              onChange={e => { setAction(e.target.value); setPage(1); }}
              style={{ padding: '8px 12px' }}
            >
              {ACTIONS.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          
        </div>
      </div>

      {/* Table Card */}
      <div className="card">
        {loading && logs.length === 0 ? (
          <div className="loading-overlay" style={{ minHeight: '300px' }}>
            <div className="loading-spinner" />
            Memuat data log audit...
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '300px' }}>
            <ShieldCheck size={32} className="text-muted" style={{ marginBottom: '16px' }} />
            <div className="empty-title">Tidak ada log ditemukan</div>
            <div className="empty-desc">Aktivitas sistem yang Anda cari belum terekam dalam log audit.</div>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '180px' }}>Waktu</th>
                    <th style={{ width: '120px' }}>Username</th>
                    <th style={{ width: '180px' }}>Aksi</th>
                    <th style={{ width: '200px' }}>Target</th>
                    <th>Detail Aktivitas</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        {new Date(log.timestamp).toLocaleString('id-ID')}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{log.username}</td>
                      <td>
                        <span className={`badge ${getActionBadgeClass(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: '12px' }}>{log.target}</td>
                      <td style={{ color: 'var(--text-primary)' }}>{log.details || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex-between mt-16" style={{ padding: '4px 8px' }}>
              <div className="text-muted" style={{ fontSize: '12.5px' }}>
                Menampilkan log ke-{(page - 1) * limit + 1} s.d. {Math.min(page * limit, total)} dari {total} entri
              </div>
              <div className="flex-center gap-12">
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.max(p - 1, 1))}
                  disabled={page === 1 || loading}
                >
                  <ChevronLeft size={14} /> Sebelum
                </button>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Halaman {page} dari {totalPages}
                </span>
                <button 
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(p => Math.min(p + 1, totalPages))}
                  disabled={page === totalPages || loading}
                >
                  Berikut <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
