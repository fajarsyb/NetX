import { useState } from 'react'
import { Upload, X, Download, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { devicesApi } from '../../api/client'

export default function ImportModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0])
      setResult(null)
      setErrorMsg('')
    }
  }

  const handleDownloadTemplate = () => {
    const headers = [
      'Device Name',
      'IP Address',
      'Device Type',
      'Protocol',
      'Port',
      'Username',
      'Password',
      'Group Name',
      'Description',
      'SNMP Version',
      'SNMP Community',
      'Device Role'
    ]
    const example1 = [
      'Cisco-Switch-01',
      '192.168.10.11',
      'cisco_ios',
      'ssh',
      '22',
      'admin',
      'cisco123',
      'Lantai 1',
      'Switch Distribusi Lantai 1',
      'v2c',
      'public',
      'Access Switch'
    ]
    const example2 = [
      'AT-Switch-02',
      '192.168.10.12',
      'allied_telesis',
      'ssh',
      '22',
      'manager',
      'allied123',
      'Lantai 2',
      'Allied Telesis AW+ Switch',
      'v2c',
      'public',
      'Access Switch'
    ]

    const csvContent = [
      headers.join(','),
      example1.join(','),
      example2.join(',')
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', 'template_import_device.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleUpload = async () => {
    if (!file) {
      setErrorMsg('Silakan pilih file CSV terlebih dahulu.')
      return
    }

    setLoading(true)
    setErrorMsg('')
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await devicesApi.importCsv(formData)
      setResult(res.data)
      if (res.data.success_count > 0) {
        onSuccess()
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Gagal mengunggah file CSV. Pastikan format file benar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '640px' }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Upload size={18} style={{ color: 'var(--primary)' }} />
            Impor Perangkat Massal (CSV)
          </div>
          <button className="btn-close" onClick={onClose} disabled={loading}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {/* Instructions */}
          <div className="card mb-16" style={{ padding: '12px 16px', background: 'var(--bg-card-hover)', border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Panduan Format CSV:
            </div>
            <ul style={{ fontSize: '12px', color: 'var(--text-secondary)', paddingLeft: '20px', margin: 0, lineHeight: '1.6' }}>
              <li>Kolom wajib: <strong>Device Name, IP Address, Device Type</strong>.</li>
              <li>Kolom pendukung: Protocol (ssh/telnet), Port, Username, Password, Group Name, Description, SNMP Version, SNMP Community, Device Role.</li>
              <li>Pilihan <strong>Device Type</strong> yang didukung: <code style={{ color: 'var(--primary)' }}>cisco_ios, allied_telesis, juniper_junos, mikrotik_routeros, ruijie_os, ruckus_fastiron, huawei</code>, dll.</li>
              <li>Jika nama Group baru ditentukan di kolom <em>Group Name</em>, group tersebut akan otomatis dibuat jika belum terdaftar.</li>
            </ul>
            <button 
              className="btn btn-ghost btn-sm" 
              onClick={handleDownloadTemplate} 
              style={{ marginTop: '10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px' }}
            >
              <Download size={12} /> Unduh Template CSV
            </button>
          </div>

          {/* Form Upload */}
          {!result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div 
                style={{
                  border: '2px dashed var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '30px 20px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--bg-input)',
                  transition: 'border-color 0.2s',
                  position: 'relative'
                }}
                className="hover-border"
              >
                <input 
                  type="file" 
                  accept=".csv"
                  onChange={handleFileChange}
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, width: '100%', height: '100%',
                    opacity: 0, cursor: 'pointer'
                  }}
                />
                <Upload size={32} className="text-muted" style={{ margin: '0 auto 12px' }} />
                {file ? (
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {(file.size / 1024).toFixed(2)} KB
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Tarik & letakkan file CSV Anda di sini, atau <strong>pilih file</strong>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Hanya mendukung format .csv
                    </div>
                  </div>
                )}
              </div>

              {errorMsg && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--danger)', fontSize: '12.5px', background: 'rgba(239, 68, 68, 0.1)', padding: '10px 12px', borderRadius: 'var(--radius-sm)' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          )}

          {/* Result Summary */}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div className="card" style={{ flex: '1', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '4px solid var(--success)' }}>
                  <CheckCircle2 size={24} style={{ color: 'var(--success)' }} />
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{result.success_count}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Berhasil Diimpor</div>
                  </div>
                </div>
                <div className="card" style={{ flex: '1', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '4px solid var(--danger)' }}>
                  <ShieldAlert size={24} style={{ color: 'var(--danger)' }} />
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{result.failed_count}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Gagal Diimpor</div>
                  </div>
                </div>
              </div>

              {result.errors && result.errors.length > 0 && (
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                    Daftar Baris Error:
                  </div>
                  <div style={{ 
                    maxHeight: '200px', 
                    overflowY: 'auto', 
                    border: '1px solid var(--border)', 
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    fontSize: '12px'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-card-hover)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '8px 12px', width: '60px' }}>Baris</th>
                          <th style={{ padding: '8px 12px', width: '150px' }}>Device Name</th>
                          <th style={{ padding: '8px 12px', width: '120px' }}>IP Address</th>
                          <th style={{ padding: '8px 12px' }}>Penyebab Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((err, i) => (
                          <tr key={i} style={{ borderBottom: i < result.errors.length - 1 ? '1px solid var(--border)' : 'none' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>{err.row}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{err.name || '—'}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{err.ip || '—'}</td>
                            <td style={{ padding: '8px 12px', color: 'var(--danger)' }}>{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ padding: '16px 24px 20px' }}>
          {result ? (
            <button className="btn btn-primary" onClick={onClose}>
              Selesai
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Batal
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleUpload} 
                disabled={loading || !file} 
                style={{ gap: '8px' }}
              >
                {loading ? 'Mengimpor...' : 'Impor Sekarang'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
