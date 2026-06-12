import { useState, useEffect } from 'react'
import { Server, ShieldAlert, Plus, Trash2, RotateCcw, AlertTriangle, Globe, Wifi, UploadCloud } from 'lucide-react'
import { backupApi, remoteBackupsApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function BackupManagement() {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoringFile, setRestoringFile] = useState(null) // Holds filename for active restore modal
  const [isRestoring, setIsRestoring] = useState(false)
  
  // Remote Backup Settings state
  const [remoteSettings, setRemoteSettings] = useState({
    protocol: 'sftp',
    host: '',
    port: 22,
    username: '',
    password: '',
    path: '',
    is_active: 0,
    backup_db: 0,
    backup_config: 0
  })
  const [testingConnection, setTestingConnection] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [uploadingDb, setUploadingDb] = useState(false)
  
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchRemoteSettings = async () => {
    try {
      const res = await remoteBackupsApi.getSettings()
      setRemoteSettings(res.data)
    } catch (err) {
      toast.error('Gagal mengambil pengaturan backup eksternal.')
    }
  }

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
    fetchRemoteSettings()
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

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      const res = await remoteBackupsApi.saveSettings(remoteSettings)
      if (res.data.success) {
        toast.success(res.data.message || 'Pengaturan berhasil disimpan.')
        fetchRemoteSettings()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan pengaturan.')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    try {
      const res = await remoteBackupsApi.testConnection(remoteSettings)
      if (res.data.success) {
        toast.success(res.data.message || 'Koneksi berhasil!')
      } else {
        toast.error(res.data.message || 'Koneksi gagal.')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menguji koneksi.')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleUploadLatestDb = async () => {
    setUploadingDb(true)
    try {
      const res = await remoteBackupsApi.uploadLatestDb()
      if (res.data.success) {
        toast.success(res.data.message || 'Database berhasil diunggah.')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengunggah database.')
    } finally {
      setUploadingDb(false)
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

      {/* Remote Backup Settings Section */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Globe size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Integrasi Backup Eksternal (SFTP / FTP / SCP)</h3>
        </div>
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Protokol</label>
              <select
                className="form-control"
                value={remoteSettings.protocol}
                onChange={e => {
                  const proto = e.target.value;
                  let defaultPort = 22;
                  if (proto === 'ftp') defaultPort = 21;
                  setRemoteSettings(s => ({ ...s, protocol: proto, port: defaultPort }));
                }}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              >
                <option value="sftp">SFTP (Secure FTP)</option>
                <option value="ftp">FTP (File Transfer Protocol)</option>
                <option value="scp">SCP (Secure Copy)</option>
              </select>
            </div>
            
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Host / IP Address</label>
              <input
                type="text"
                className="form-control"
                placeholder="10.0.0.5 atau backup.domain.com"
                value={remoteSettings.host}
                onChange={e => setRemoteSettings(s => ({ ...s, host: e.target.value }))}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </div>
            
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Port</label>
              <input
                type="number"
                className="form-control"
                placeholder={remoteSettings.protocol === 'ftp' ? '21' : '22'}
                value={remoteSettings.port}
                onChange={e => setRemoteSettings(s => ({ ...s, port: Number(e.target.value) }))}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Username</label>
              <input
                type="text"
                className="form-control"
                placeholder="root atau backup-user"
                value={remoteSettings.username}
                onChange={e => setRemoteSettings(s => ({ ...s, username: e.target.value }))}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Password</label>
              <input
                type="password"
                className="form-control"
                placeholder={remoteSettings.password ? '••••••••' : 'Password remote'}
                value={remoteSettings.password}
                onChange={e => setRemoteSettings(s => ({ ...s, password: e.target.value }))}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Folder / Path Tujuan</label>
              <input
                type="text"
                className="form-control"
                placeholder="/var/backup atau /"
                value={remoteSettings.path}
                onChange={e => setRemoteSettings(s => ({ ...s, path: e.target.value }))}
                style={{ width: '100%', height: '38px', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 10px', fontSize: '13.5px', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '24px', padding: '16px', background: 'var(--bg-hover)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="remote_is_active"
                checked={remoteSettings.is_active === 1}
                onChange={e => setRemoteSettings(s => ({ ...s, is_active: e.target.checked ? 1 : 0 }))}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="remote_is_active" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                Aktifkan Backup Remote Otomatis
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="remote_backup_db"
                checked={remoteSettings.backup_db === 1}
                onChange={e => setRemoteSettings(s => ({ ...s, backup_db: e.target.checked ? 1 : 0 }))}
                disabled={remoteSettings.is_active === 0}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="remote_backup_db" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', userSelect: 'none', color: remoteSettings.is_active === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                Backup Database (.zip)
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="remote_backup_config"
                checked={remoteSettings.backup_config === 1}
                onChange={e => setRemoteSettings(s => ({ ...s, backup_config: e.target.checked ? 1 : 0 }))}
                disabled={remoteSettings.is_active === 0}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="remote_backup_config" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', userSelect: 'none', color: remoteSettings.is_active === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                Backup Konfigurasi Perangkat (.txt)
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={handleSaveSettings}
              disabled={savingSettings || testingConnection}
            >
              {savingSettings ? (
                <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: 6 }} />
              ) : null}
              {savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>

            <button
              className="btn btn-ghost"
              onClick={handleTestConnection}
              disabled={savingSettings || testingConnection || !remoteSettings.host}
            >
              {testingConnection ? (
                <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: 'var(--primary)', marginRight: 6 }} />
              ) : (
                <Wifi size={14} style={{ marginRight: 6 }} />
              )}
              {testingConnection ? 'Menguji...' : 'Uji Koneksi'}
            </button>

            <button
              className="btn btn-ghost"
              onClick={handleUploadLatestDb}
              disabled={uploadingDb || !remoteSettings.host || backups.length === 0}
              style={{ color: 'var(--success)', borderColor: 'var(--success-glow)' }}
            >
              {uploadingDb ? (
                <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: 'var(--success)', marginRight: 6 }} />
              ) : (
                <UploadCloud size={14} style={{ marginRight: 6 }} />
              )}
              {uploadingDb ? 'Mengunggah...' : 'Upload DB Terkini ke Remote'}
            </button>
          </div>
        </div>
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
