import { useState, useEffect } from 'react'
import { Server, ShieldAlert, Plus, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { backupApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function BackupManagement() {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoringFile, setRestoringFile] = useState(null) // Holds filename for active restore modal
  const [isRestoring, setIsRestoring] = useState(false)
  
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchBackups = async () => {
    setLoading(true)
    try {
      const res = await backupApi.list()
      setBackups(res.data)
    } catch (err) {
      toast.error('Gagal mengambil daftar cadangan.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBackups()
  }, [])

  if (currentUser?.role !== 'admin') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <ShieldAlert size={48} className="text-danger" style={{ marginBottom: '16px' }} />
          <div className="empty-title">Akses Ditolak</div>
          <div className="empty-desc">Hanya Administrator yang dapat mengakses halaman Backup & Restore ini.</div>
        </div>
      </div>
    )
  }

  const handleCreateBackup = async () => {
    setCreating(true)
    try {
      const res = await backupApi.create()
      if (res.data.success) {
        toast.success(res.data.message || 'Pencadangan berhasil dibuat.')
        fetchBackups()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal membuat pencadangan.')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteBackup = async (filename) => {
    if (!confirm(`Yakin ingin menghapus file backup "${filename}"? Tindakan ini tidak dapat dibatalkan.`)) return
    try {
      await backupApi.remove(filename)
      toast.success('File backup berhasil dihapus.')
      fetchBackups()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus file backup.')
    }
  }

  const handleRestoreBackup = async () => {
    if (!restoringFile) return
    setIsRestoring(true)
    try {
      const res = await backupApi.restore(restoringFile)
      if (res.data.success) {
        toast.success(res.data.message || 'Pemulihan data berhasil.')
        setRestoringFile(null)
        fetchBackups()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal memulihkan data.')
    } finally {
      setIsRestoring(false)
    }
  }

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Server size={22} style={{ color: 'var(--primary)' }} />
            Backup & Restore
          </div>
          <div className="page-subtitle">Cadangkan database dan file kunci enkripsi, atau pulihkan kondisi sistem dari cadangan sebelumnya</div>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={handleCreateBackup}
          disabled={creating || loading}
        >
          {creating ? (
            <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />
          ) : (
            <Plus size={15} />
          )}
          {creating ? 'Mencadangkan...' : 'Buat Backup Baru'}
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay" style={{ minHeight: '300px' }}>
            <div className="loading-spinner" />
            Memuat daftar cadangan...
          </div>
        ) : backups.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '300px' }}>
            <Server size={32} className="text-muted" style={{ marginBottom: '16px' }} />
            <div className="empty-title">Belum ada file backup</div>
            <div className="empty-desc">Klik tombol "Buat Backup Baru" di kanan atas untuk membuat cadangan database Anda.</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama File</th>
                  <th>Tanggal Dibuat</th>
                  <th>Ukuran</th>
                  <th style={{ textAlign: 'right' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(b => (
                  <tr key={b.filename}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.filename}</td>
                    <td className="mono" style={{ fontSize: '12.5px' }}>
                      {new Date(b.created_at).toLocaleString('id-ID')}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>{formatBytes(b.size)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ color: 'var(--success)', borderColor: 'var(--success-glow)' }}
                          onClick={() => setRestoringFile(b.filename)}
                          title="Restore database dari file ini"
                        >
                          <RotateCcw size={13} /> Restore
                        </button>
                        <button 
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteBackup(b.filename)}
                          title="Hapus file backup"
                        >
                          <Trash2 size={13} /> Hapus
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

      {/* Restore Warning Confirmation Modal */}
      {restoringFile && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !isRestoring && setRestoringFile(null)}>
          <div className="modal animate-slide" style={{ maxWidth: '480px' }}>
            <div className="modal-header" style={{ borderBottomColor: 'rgba(239,68,68,0.2)' }}>
              <div className="modal-title" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={18} /> Konfirmasi Pemulihan Data
              </div>
            </div>
            <div className="modal-body" style={{ padding: '24px' }}>
              <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '12px' }}>
                Peringatan Kritis!
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6', marginBottom: '16px' }}>
                Anda akan memulihkan database dari file cadangan <strong>"{restoringFile}"</strong>.<br />
                Proses pemulihan ini akan <strong>menimpa seluruh konfigurasi dan data jaringan saat ini</strong>.
                Seluruh koneksi aktif atau perubahan data yang belum dicadangkan akan hilang permanen.
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', fontWeight: 500 }}>
                Apakah Anda benar-benar yakin ingin melanjutkan?
              </p>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-ghost" 
                onClick={() => setRestoringFile(null)} 
                disabled={isRestoring}
              >
                Batal
              </button>
              <button 
                className="btn btn-danger" 
                onClick={handleRestoreBackup}
                disabled={isRestoring}
              >
                {isRestoring ? (
                  <>
                    <span className="loading-spinner" style={{ width: 13, height: 13, borderTopColor: '#fff', marginRight: 4 }} />
                    Memulihkan...
                  </>
                ) : (
                  'Ya, Pulihkan Sekarang'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
