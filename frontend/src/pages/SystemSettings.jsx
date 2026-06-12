import { useState, useEffect } from 'react'
import { RefreshCw, AlertTriangle, CheckCircle, Save, Settings, HelpCircle, ShieldAlert, Cpu } from 'lucide-react'
import { systemSettingsApi } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/shared/ToastProvider'

export default function SystemSettings() {
  const [settings, setSettings] = useState({
    ping_auto_refresh_enabled: true,
    ping_auto_refresh_interval: 300,
    mac_auto_refresh_enabled: true,
    mac_auto_refresh_interval: 3600,
    arp_auto_refresh_enabled: true,
    arp_auto_refresh_interval: 600,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { user: currentUser } = useAuth()
  const toast = useToast()

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await systemSettingsApi.get()
      setSettings(res.data)
    } catch (err) {
      toast.error('Gagal memuat pengaturan sistem.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'operator') {
    return (
      <div className="page-container animate-fade">
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <AlertTriangle size={48} className="text-danger" style={{ marginBottom: '16px' }} />
          <div className="empty-title">Akses Ditolak</div>
          <div className="empty-desc">Anda tidak memiliki hak akses untuk mengonfigurasi pengaturan sistem.</div>
        </div>
      </div>
    )
  }

  const handleToggle = (field) => {
    setSettings(prev => ({
      ...prev,
      [field]: !prev[field]
    }))
  }

  const handleIntervalChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: parseInt(value, 10) || 300
    }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await systemSettingsApi.update(settings)
      if (res.data.success) {
        toast.success(res.data.message || 'Pengaturan berhasil diperbarui.')
        fetchSettings()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <RefreshCw size={22} style={{ color: 'var(--primary)' }} />
            Pengaturan Auto Refresh & Optimalisasi
          </div>
          <div className="page-subtitle">
            Konfigurasi interval waktu pembaruan berkala data jaringan untuk menjaga server tetap responsif dan optimal.
          </div>
        </div>
        <div>
          <button className="btn btn-ghost" onClick={fetchSettings} disabled={loading}>
            <RefreshCw size={15} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
            Segarkan Status
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Side: Refresh Forms */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={18} className="text-muted" />
            Konfigurasi Penyegaran Otomatis
          </h3>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <span className="loading-spinner" />
            </div>
          ) : (
            <form onSubmit={handleSave}>
              
              {/* Ping Section */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>Ping Status Refresh</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Pemeriksaan konektivitas (ICMP) berkala ke semua host.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.ping_auto_refresh_enabled} 
                      onChange={() => handleToggle('ping_auto_refresh_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.ping_auto_refresh_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.ping_auto_refresh_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.ping_auto_refresh_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.ping_auto_refresh_enabled && (
                  <div className="form-group" style={{ margin: 0, paddingTop: '8px' }}>
                    <label className="form-label">Interval Waktu</label>
                    <select
                      className="form-control"
                      value={settings.ping_auto_refresh_interval}
                      onChange={e => handleIntervalChange('ping_auto_refresh_interval', e.target.value)}
                    >
                      <option value="30">30 Detik</option>
                      <option value="60">1 Menit</option>
                      <option value="120">2 Menit</option>
                      <option value="300">5 Menit (Bawaan)</option>
                      <option value="600">10 Menit</option>
                      <option value="900">15 Menit</option>
                      <option value="1800">30 Menit</option>
                    </select>
                  </div>
                )}
              </div>

              {/* ARP Section */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>ARP Cache Refresh</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Pencarian relasi IP-MAC address melalui koneksi CLI SSH.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.arp_auto_refresh_enabled} 
                      onChange={() => handleToggle('arp_auto_refresh_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.arp_auto_refresh_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.arp_auto_refresh_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.arp_auto_refresh_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.arp_auto_refresh_enabled && (
                  <div className="form-group" style={{ margin: 0, paddingTop: '8px' }}>
                    <label className="form-label">Interval Waktu</label>
                    <select
                      className="form-control"
                      value={settings.arp_auto_refresh_interval}
                      onChange={e => handleIntervalChange('arp_auto_refresh_interval', e.target.value)}
                    >
                      <option value="60">1 Menit</option>
                      <option value="300">5 Menit</option>
                      <option value="600">10 Menit (Bawaan)</option>
                      <option value="900">15 Menit</option>
                      <option value="1800">30 Menit</option>
                      <option value="3600">1 Jam</option>
                      <option value="7200">2 Jam</option>
                    </select>
                  </div>
                )}
              </div>

              {/* MAC Address Section */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>MAC Table Refresh</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Pembaruan tabel MAC address switch secara berkala via SSH.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.mac_auto_refresh_enabled} 
                      onChange={() => handleToggle('mac_auto_refresh_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.mac_auto_refresh_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.mac_auto_refresh_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.mac_auto_refresh_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.mac_auto_refresh_enabled && (
                  <div className="form-group" style={{ margin: 0, paddingTop: '8px' }}>
                    <label className="form-label">Interval Waktu</label>
                    <select
                      className="form-control"
                      value={settings.mac_auto_refresh_interval}
                      onChange={e => handleIntervalChange('mac_auto_refresh_interval', e.target.value)}
                    >
                      <option value="300">5 Menit</option>
                      <option value="600">10 Menit</option>
                      <option value="1800">30 Menit</option>
                      <option value="3600">1 Jam (Bawaan)</option>
                      <option value="7200">2 Jam</option>
                      <option value="21600">6 Jam</option>
                      <option value="43200">12 Jam</option>
                      <option value="86400">24 Jam</option>
                    </select>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', padding: '12px' }}
              >
                {saving ? (
                  <>
                    <span className="loading-spinner" style={{ width: 16, height: 16 }} />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    Simpan Pengaturan
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Right Side: Server Optimization Guide */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: 'radial-gradient(var(--primary), transparent)', opacity: 0.15, pointerEvents: 'none' }} />
            
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} style={{ color: 'var(--primary)' }} />
              Optimalisasi Beban Server & Jaringan
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div 
                style={{ 
                  padding: '14px', 
                  borderRadius: '6px', 
                  backgroundColor: 'rgba(59,130,246,0.06)', 
                  border: '1px solid rgba(59,130,246,0.2)',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  color: 'var(--text-primary)'
                }}
              >
                Aktivitas refresh otomatis diatur menggunakan antrean <strong>Celery/Redis</strong> yang berjalan di latar belakang (background worker) untuk menjaga performa dashboard tetap responsif tanpa lag.
              </div>

              <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                <h4 style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>Mengapa Aturan Ini Penting?</h4>
                <ul style={{ paddingLeft: '18px', margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <li>
                    <strong>Koneksi SSH Mahal:</strong> Proses penarikan tabel MAC dan ARP mengharuskan server log-in via SSH/Telnet ke perangkat fisik. Concurrency dibatasi maksimal <strong>3 koneksi paralel</strong> secara bersamaan agar RAM server optimal dan switch tidak menolak koneksi (refuse connection).
                  </li>
                  <li>
                    <strong>Saran Interval ARP:</strong> ARP cache disarankan di-refresh setiap <strong>10 menit</strong> atau lebih lambat.
                  </li>
                  <li>
                    <strong>Saran Interval MAC:</strong> Tabel MAC address disarankan di-refresh setiap <strong>30 menit - 1 jam</strong> atau lebih lambat karena memuat banyak baris data.
                  </li>
                  <li>
                    <strong>Proteksi Serial:</strong> Perangkat dengan protokol `serial` (console fisik) dikecualikan secara otomatis untuk mencegah port crash.
                  </li>
                </ul>
              </div>

              <div 
                style={{ 
                  marginTop: '8px',
                  padding: '12px', 
                  borderRadius: '6px', 
                  backgroundColor: 'rgba(34,197,94,0.06)', 
                  border: '1px solid rgba(34,197,94,0.2)',
                  fontSize: '12.5px',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle size={16} />
                Mesin antrean membatasi latensi untuk menjamin server tetap aman.
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={18} className="text-muted" />
              Catatan Sistem
            </h3>
            <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)', margin: 0 }}>
              Perubahan interval refresh akan dimuat oleh penjadwal (Scheduler) secara real-time pada detak (tick) berikutnya (maksimal 30 detik dari penyimpanan). Anda tidak perlu me-restart server backend untuk menerapkan perubahan interval auto-refresh.
            </p>
          </div>

        </div>

      </div>
    </div>
  )
}
