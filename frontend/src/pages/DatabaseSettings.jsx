import { useState, useEffect } from 'react'
import { Database, Server, RefreshCw, AlertTriangle, CheckCircle, Save, Settings, Play, ArrowLeftRight, HelpCircle, HardDrive } from 'lucide-react'
import { dbSettingsApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function DatabaseSettings() {
  const [config, setConfig] = useState({
    host: 'localhost',
    port: 5432,
    database: 'netx',
    username: 'postgres',
    password: '',
    ssl_mode: 'prefer'
  })
  
  const [currentEngine, setCurrentEngine] = useState('sqlite')
  const [sqliteStats, setSqliteStats] = useState({ exists: false, size_mb: 0, tables: {} })
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchConfig = async () => {
    setLoading(true)
    try {
      const res = await dbSettingsApi.getCurrent()
      setCurrentEngine(res.data.current_engine)
      if (res.data.pg_config) {
        setConfig(res.data.pg_config)
      }
      if (res.data.sqlite_stats) {
        setSqliteStats(res.data.sqlite_stats)
      }
    } catch (err) {
      toast.error('Gagal memuat konfigurasi database.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  if (currentUser?.role !== 'admin') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <AlertTriangle size={48} className="text-danger" style={{ marginBottom: '16px' }} />
          <div className="empty-title">Akses Ditolak</div>
          <div className="empty-desc">Hanya Administrator yang dapat mengonfigurasi database sistem.</div>
        </div>
      </div>
    )
  }

  const handleInputChange = (field, val) => {
    setConfig(prev => ({
      ...prev,
      [field]: val
    }))
  }

  const handleTestConnection = async (e) => {
    e.preventDefault()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await dbSettingsApi.testConnection(config)
      setTestResult(res.data)
      if (res.data.success) {
        toast.success('Koneksi PostgreSQL berhasil!')
      } else {
        toast.error(res.data.message || 'Koneksi PostgreSQL gagal.')
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'Koneksi gagal. Periksa kembali host dan port.'
      setTestResult({ success: false, message: errMsg })
      toast.error(errMsg)
    } finally {
      setTesting(false)
    }
  }

  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      const res = await dbSettingsApi.save(config)
      if (res.data.success) {
        toast.success(res.data.message || 'Konfigurasi berhasil disimpan.')
        fetchConfig()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan konfigurasi.')
    } finally {
      setSaving(false)
    }
  }

  const handleSwitchToPostgres = async () => {
    if (!confirm('Peringatan: Mengubah database utama ke PostgreSQL mengharuskan PostgreSQL siap digunakan dan skema tabel terinisialisasi. Layanan API backend perlu di-restart setelah operasi ini. Lanjutkan?')) {
      return
    }
    setSwitching(true)
    try {
      const res = await dbSettingsApi.activatePostgres(config)
      if (res.data.success) {
        toast.success(res.data.message || 'Database dialihkan ke PostgreSQL! Silakan restart server.')
        fetchConfig()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengaktifkan PostgreSQL.')
    } finally {
      setSwitching(false)
    }
  }

  const handleRevertToSqlite = async () => {
    if (!confirm('Apakah Anda yakin ingin mengembalikan database utama sistem ke SQLite? Backend API perlu di-restart setelah ini.')) {
      return
    }
    setReverting(true)
    try {
      const res = await dbSettingsApi.revertSqlite()
      if (res.data.success) {
        toast.success(res.data.message || 'Database dikembalikan ke SQLite! Silakan restart server.')
        fetchConfig()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengembalikan ke SQLite.')
    } finally {
      setReverting(false)
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Database size={22} style={{ color: 'var(--primary)' }} />
            Integrasi & Migrasi PostgreSQL
          </div>
          <div className="page-subtitle">
            Konfigurasi koneksi PostgreSQL eksternal untuk migrasi dari database lokal SQLite bawaan.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={fetchConfig} disabled={loading}>
            <RefreshCw size={15} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Segarkan Status
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Side: PostgreSQL Settings Form */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={18} className="text-muted" />
            Parameter Koneksi PostgreSQL
          </h3>
          
          <form onSubmit={handleTestConnection}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div className="form-group">
                <label className="form-label">Host / IP PostgreSQL</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="localhost"
                  value={config.host}
                  onChange={e => handleInputChange('host', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Port</label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="5432"
                  value={config.port}
                  onChange={e => handleInputChange('port', parseInt(e.target.value) || 5432)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Nama Database (Database Name)</label>
              <input
                type="text"
                className="form-control"
                placeholder="netx"
                value={config.database}
                onChange={e => handleInputChange('database', e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="postgres"
                  value={config.username}
                  onChange={e => handleInputChange('username', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="••••••••"
                  value={config.password}
                  onChange={e => handleInputChange('password', e.target.value)}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">SSL Mode</label>
              <select
                className="form-control"
                value={config.ssl_mode}
                onChange={e => handleInputChange('ssl_mode', e.target.value)}
              >
                <option value="disable">disable (Tanpa SSL)</option>
                <option value="allow">allow (Gunakan jika didukung)</option>
                <option value="prefer">prefer (Coba SSL dulu, default)</option>
                <option value="require">require (Harus menggunakan SSL)</option>
                <option value="verify-ca">verify-ca (Validasi CA Sertifikat)</option>
                <option value="verify-full">verify-full (Validasi CA & Hostname)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={testing || loading}
                style={{ flex: 1 }}
              >
                {testing ? (
                  <>
                    <span className="loading-spinner" style={{ width: 14, height: 14, marginRight: 8 }} />
                    Menguji Koneksi...
                  </>
                ) : (
                  'Uji Koneksi DB'
                )}
              </button>
              
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveConfig}
                disabled={saving || loading}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
              >
                {saving ? (
                  <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                ) : (
                  <Save size={15} />
                )}
                Simpan ke .env
              </button>
            </div>
          </form>

          {testResult && (
            <div 
              style={{ 
                marginTop: '20px', 
                padding: '16px', 
                borderRadius: '8px', 
                fontSize: '13.5px',
                lineHeight: '1.6',
                border: '1px solid',
                backgroundColor: testResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                borderColor: testResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                color: testResult.success ? 'var(--success)' : 'var(--danger)'
              }}
            >
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {testResult.success ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                {testResult.message}
              </div>
              {testResult.details && (
                <pre style={{ fontSize: '11.5px', fontFamily: 'monospace', overflowX: 'auto', margin: '6px 0 0', opacity: 0.85 }}>
                  {JSON.stringify(testResult.details, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Database Status & Migration Guidance */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 1: Engine Status */}
          <div className="card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={18} className="text-muted" />
              Status Database Aktif
            </h3>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <div 
                style={{ 
                  width: '48px', 
                  height: '48px', 
                  borderRadius: '50%', 
                  backgroundColor: currentEngine === 'postgresql' ? 'rgba(59,130,246,0.1)' : 'rgba(107,114,128,0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: currentEngine === 'postgresql' ? 'var(--primary)' : 'var(--text-muted)'
                }}
              >
                <Database size={24} />
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Database Utama Saat Ini</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                  {currentEngine === 'sqlite' ? 'SQLite (Lokal)' : 'PostgreSQL (Eksternal)'}
                </div>
              </div>
            </div>

            {currentEngine === 'sqlite' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span className="text-muted">Ukuran Berkas database:</span>
                  <span style={{ fontWeight: 600 }}>{sqliteStats.size_mb} MB</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <span className="text-muted">Total Tabel Data:</span>
                  <span style={{ fontWeight: 600 }}>{Object.keys(sqliteStats.tables || {}).length} Tabel</span>
                </div>
                
                <button
                  className="btn btn-primary"
                  onClick={handleSwitchToPostgres}
                  disabled={switching || !testResult?.success || loading}
                  style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                >
                  <ArrowLeftRight size={15} />
                  {switching ? 'Memproses Peralihan...' : 'Aktifkan PostgreSQL di .env'}
                </button>
                {!testResult?.success && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    * Lakukan Uji Koneksi dengan sukses terlebih dahulu sebelum mengaktifkan PostgreSQL.
                  </span>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div 
                  style={{ 
                    padding: '12px', 
                    borderRadius: '6px', 
                    backgroundColor: 'rgba(34,197,94,0.06)', 
                    border: '1px solid rgba(34,197,94,0.2)',
                    fontSize: '13px',
                    color: 'var(--success)',
                    lineHeight: '1.5'
                  }}
                >
                  Sistem dikonfigurasi menggunakan <strong>PostgreSQL</strong>. Semua data baru akan ditulis ke basis data terdistribusi.
                </div>
                
                <button
                  className="btn btn-ghost"
                  onClick={handleRevertToSqlite}
                  disabled={reverting || loading}
                  style={{ 
                    marginTop: '12px', 
                    color: 'var(--danger)', 
                    borderColor: 'rgba(239,68,68,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    justifyContent: 'center'
                  }}
                >
                  <ArrowLeftRight size={15} />
                  {reverting ? 'Mengembalikan...' : 'Kembalikan ke SQLite Lokal'}
                </button>
              </div>
            )}
          </div>

          {/* Card 2: Migration Roadmap */}
          <div className="card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={18} className="text-muted" />
              Panduan Migrasi Data
            </h3>
            
            <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
              <p style={{ marginBottom: '12px' }}>
                Untuk melakukan migrasi penuh data SQLite lama ke PostgreSQL, ikuti langkah-langkah berikut:
              </p>
              
              <ol style={{ paddingLeft: '18px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <li>
                  <strong>Uji Koneksi PostgreSQL:</strong> Masukkan kredensial database PostgreSQL Anda di formulir kiri dan pastikan uji koneksi sukses.
                </li>
                <li>
                  <strong>Instal Library Database:</strong> Pastikan Anda telah menginstal `psycopg2-binary` pada server backend:
                  <pre style={{ background: 'var(--bg-hover)', padding: '6px 10px', borderRadius: '4px', margin: '4px 0', fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--text-primary)' }}>
                    pip install psycopg2-binary
                  </pre>
                </li>
                <li>
                  <strong>Gunakan Script Migrasi Data:</strong> Kami menyediakan script CLI terdedikasi untuk mentransfer seluruh tabel:
                  <pre style={{ background: 'var(--bg-hover)', padding: '6px 10px', borderRadius: '4px', margin: '4px 0', fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--text-primary)', overflowX: 'auto' }}>
                    python backend/migrate_data.py
                  </pre>
                  <em>* Script akan menyalin seluruh data devices, logs, credentials, dan topology.</em>
                </li>
                <li>
                  <strong>Aktifkan PostgreSQL:</strong> Klik tombol "Aktifkan PostgreSQL di .env" untuk mengubah backend ke mode PostgreSQL.
                </li>
                <li>
                  <strong>Restart Backend Server:</strong> Matikan server backend (jika berjalan) dan jalankan kembali agar mode database baru diterapkan.
                </li>
              </ol>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
