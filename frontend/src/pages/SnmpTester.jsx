import { useState } from 'react'
import { Radio, ShieldAlert, Cpu, CheckCircle2, XCircle, Info } from 'lucide-react'
import { snmpApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

export default function SnmpTester() {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(161)
  const [version, setVersion] = useState('v2c')
  const [community, setCommunity] = useState('public')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  
  const toast = useToast()

  const handleRunTest = async (e) => {
    e.preventDefault()
    if (!ip) {
      toast.error('Isi IP Address terlebih dahulu.')
      return
    }
    if (!community) {
      toast.error('Isi Community String terlebih dahulu.')
      return
    }

    setLoading(true)
    setResult(null)
    toast.info('Menghubungi perangkat target via SNMP...')

    try {
      const res = await snmpApi.testRaw({
        ip,
        port: parseInt(port) || 161,
        version,
        community
      })
      if (res.data.success) {
        setResult({
          success: true,
          message: res.data.message,
          data: res.data.data
        })
        toast.success('Koneksi SNMP Berhasil!')
      } else {
        setResult({
          success: false,
          message: res.data.message || 'Koneksi gagal.'
        })
        toast.error('Koneksi SNMP Gagal.')
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'Terjadi kesalahan sistem.'
      setResult({
        success: false,
        message: errMsg
      })
      toast.error('Uji coba SNMP gagal.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Radio size={22} style={{ color: 'var(--primary)' }} />
            SNMP Tester
          </div>
          <div className="page-subtitle">Uji coba parameter SNMP ke perangkat target secara langsung tanpa registrasi</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
        
        {/* Form Card */}
        <div className="card">
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
            Parameter Uji Coba SNMP
          </div>
          <form onSubmit={handleRunTest}>
            <div className="form-group">
              <label className="form-label">IP Address perangkat target *</label>
              <input 
                className="form-control" 
                placeholder="192.168.1.1" 
                value={ip}
                onChange={e => setIp(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Port SNMP *</label>
                <input 
                  className="form-control" 
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={e => setPort(parseInt(e.target.value) || '')}
                  required
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label className="form-label">SNMP Version *</label>
                <select 
                  className="form-control"
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                  disabled={loading}
                >
                  <option value="v1">v1</option>
                  <option value="v2c">v2c</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Community String (Plain Text) *</label>
              <input 
                className="form-control" 
                placeholder="public"
                value={community}
                onChange={e => setCommunity(e.target.value)}
                required
                disabled={loading}
                type="text"
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: '6px' }} />
                  Menguji...
                </>
              ) : (
                'Jalankan Uji Coba SNMP'
              )}
            </button>
          </form>
        </div>

        {/* Results & Info Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Result Card */}
          {result && (
            <div 
              className="card animate-slide" 
              style={{ 
                borderColor: result.success ? 'var(--success)' : 'var(--danger)',
                background: result.success ? 'var(--success-glow)' : 'var(--danger-glow)',
                color: result.success ? 'var(--success)' : 'var(--danger)',
                padding: '20px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                {result.success ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                <span style={{ fontWeight: 700, fontSize: '14px' }}>
                  {result.success ? 'Hasil Uji Coba: Berhasil' : 'Hasil Uji Coba: Gagal'}
                </span>
              </div>
              
              {result.success ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--text-primary)' }}>
                  <div>
                    <span className="form-label" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>System Description (sysDescr)</span>
                    <div className="font-mono" style={{ fontSize: '12px', background: 'var(--bg-card)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {result.data.sysDescr || '—'}
                    </div>
                  </div>
                  <div>
                    <span className="form-label" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>System Uptime (sysUpTime)</span>
                    <div className="font-mono" style={{ fontSize: '12.5px', color: 'var(--accent)' }}>
                      {result.data.sysUpTime || '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-primary)', background: 'var(--bg-base)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {result.message}
                </div>
              )}
            </div>
          )}

          {/* Educational Note Card */}
          <div className="card" style={{ borderLeft: '4px solid var(--primary)', background: 'var(--bg-sidebar)', padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--primary)', fontWeight: 700, fontSize: '13.5px' }}>
              <Info size={16} /> Informasi Protokol & Sandboxing Browser
            </div>
            <div style={{ fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
              <p style={{ marginBottom: '8px' }}>
                <strong>Kenapa SNMP tidak bisa diakses langsung dari Browser?</strong>
              </p>
              <p style={{ marginBottom: '8px' }}>
                Browser web beroperasi di dalam lingkungan sandboxed demi keamanan dan hanya mendukung protokol berbasis web seperti HTTP/HTTPS dan WebSocket. Browser <strong>tidak diizinkan</strong> untuk membuka koneksi soket mentah atau mengirim paket UDP (yang dibutuhkan oleh SNMP pada port 161).
              </p>
              <p>
                Oleh karena itu, ketika Anda menekan tombol di atas, browser akan mengirimkan request HTTP ke server backend NetX, lalu server backend yang akan melakukan request UDP SNMP ke perangkat atas nama Anda dan mengembalikan hasilnya. Jika tes gagal dengan status timeout, harap periksa konektivitas jaringan antara server backend NetX dan perangkat target Anda.
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
