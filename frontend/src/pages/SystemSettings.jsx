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
    alert_webhook_enabled: false,
    alert_webhook_url: '',
    alert_telegram_enabled: false,
    alert_telegram_bot_token: '',
    alert_telegram_chat_id: '',
    alert_email_enabled: false,
    alert_email_smtp_host: '',
    alert_email_smtp_port: 587,
    alert_email_smtp_user: '',
    alert_email_smtp_password: '',
    alert_email_to: '',
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingAlert, setTestingAlert] = useState(false)
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

  const handleInputChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleTestAlert = async () => {
    setTestingAlert(true)
    try {
      const res = await systemSettingsApi.testAlert()
      if (res.data.success) {
        toast.success(res.data.message || 'Pesan uji coba berhasil dikirim ke latar belakang.')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengirim pesan uji coba.')
    } finally {
      setTestingAlert(false)
    }
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

              {/* Notification Section Title */}
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginTop: '30px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={18} className="text-muted" />
                Saluran Notifikasi & Alerting Anomali
              </h3>

              {/* Webhook Channel */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>Webhook Integration</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Kirim payload JSON POST saat anomali terdeteksi.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.alert_webhook_enabled} 
                      onChange={() => handleToggle('alert_webhook_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.alert_webhook_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.alert_webhook_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.alert_webhook_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.alert_webhook_enabled && (
                  <div className="form-group" style={{ margin: 0, paddingTop: '8px' }}>
                    <label className="form-label">Webhook URL *</label>
                    <input
                      className="form-control"
                      type="url"
                      placeholder="https://api.perusahaan.com/alert-webhook"
                      value={settings.alert_webhook_url || ''}
                      onChange={e => handleInputChange('alert_webhook_url', e.target.value)}
                      required
                      style={{ fontSize: '12.5px' }}
                    />
                  </div>
                )}
              </div>

              {/* Telegram Channel */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>Telegram Alert Bot</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Kirim alert ke grup atau chat Telegram personal.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.alert_telegram_enabled} 
                      onChange={() => handleToggle('alert_telegram_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.alert_telegram_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.alert_telegram_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.alert_telegram_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.alert_telegram_enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Telegram Bot Token *</label>
                      <input
                        className="form-control"
                        type="password"
                        placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                        value={settings.alert_telegram_bot_token || ''}
                        onChange={e => handleInputChange('alert_telegram_bot_token', e.target.value)}
                        required
                        style={{ fontSize: '12.5px' }}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Chat ID / Group ID *</label>
                      <input
                        className="form-control"
                        placeholder="-100123456789"
                        value={settings.alert_telegram_chat_id || ''}
                        onChange={e => handleInputChange('alert_telegram_chat_id', e.target.value)}
                        required
                        style={{ fontSize: '12.5px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Email (SMTP) Channel */}
              <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ fontWeight: 600, fontSize: '14.5px', margin: 0 }}>Email (SMTP) Alerts</h4>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                      Kirim alert email ke admin menggunakan server mail SMTP.
                    </p>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.alert_email_enabled} 
                      onChange={() => handleToggle('alert_email_enabled')}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: settings.alert_email_enabled ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                      transition: '0.3s', borderRadius: '24px',
                      boxShadow: settings.alert_email_enabled ? '0 0 8px var(--primary)' : 'none'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px',
                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%',
                        transform: settings.alert_email_enabled ? 'translateX(20px)' : 'translateX(0)'
                      }} />
                    </span>
                  </label>
                </div>

                {settings.alert_email_enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">SMTP Host *</label>
                        <input
                          className="form-control"
                          placeholder="smtp.gmail.com"
                          value={settings.alert_email_smtp_host || ''}
                          onChange={e => handleInputChange('alert_email_smtp_host', e.target.value)}
                          required
                          style={{ fontSize: '12.5px' }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">SMTP Port *</label>
                        <input
                          className="form-control"
                          type="number"
                          placeholder="587"
                          value={settings.alert_email_smtp_port || 587}
                          onChange={e => handleIntervalChange('alert_email_smtp_port', e.target.value)}
                          required
                          style={{ fontSize: '12.5px' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">SMTP User / From *</label>
                        <input
                          className="form-control"
                          type="email"
                          placeholder="alert@company.com"
                          value={settings.alert_email_smtp_user || ''}
                          onChange={e => handleInputChange('alert_email_smtp_user', e.target.value)}
                          style={{ fontSize: '12.5px' }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">SMTP Password</label>
                        <input
                          className="form-control"
                          type="password"
                          placeholder="••••••••••••"
                          value={settings.alert_email_smtp_password || ''}
                          onChange={e => handleInputChange('alert_email_smtp_password', e.target.value)}
                          style={{ fontSize: '12.5px' }}
                        />
                      </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Recipient Emails * (koma untuk pemisah)</label>
                      <input
                        className="form-control"
                        placeholder="admin1@company.com, admin2@company.com"
                        value={settings.alert_email_to || ''}
                        onChange={e => handleInputChange('alert_email_to', e.target.value)}
                        required
                        style={{ fontSize: '12.5px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Test Connection Button inside Form */}
              {(settings.alert_webhook_enabled || settings.alert_telegram_enabled || settings.alert_email_enabled) && (
                <div style={{ marginBottom: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleTestAlert}
                    disabled={testingAlert}
                    style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}
                  >
                    {testingAlert ? (
                      <>
                        <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                        Mengirim Test Alert...
                      </>
                    ) : (
                      <>
                        <ShieldAlert size={14} />
                        Kirim Test Alert ke Saluran Aktif
                      </>
                    )}
                  </button>
                </div>
              )}

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
