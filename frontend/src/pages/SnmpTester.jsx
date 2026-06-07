import { useState, useEffect } from 'react'
import { 
  Radio, ShieldAlert, Cpu, CheckCircle2, XCircle, Info, Server, Search, FileCode, Play, AlertTriangle
} from 'lucide-react'
import { snmpApi, devicesApi, mibsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

export default function SnmpTester() {
  const [activeTab, setActiveTab] = useState('basic') // basic | custom
  
  // Basic Test state
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(161)
  const [version, setVersion] = useState('v2c')
  const [community, setCommunity] = useState('public')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  // Custom OID Query state
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [loadingDevices, setLoadingDevices] = useState(false)
  
  const [mibObjects, setMibObjects] = useState([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  
  const [selectedObjId, setSelectedObjId] = useState('')
  const [customOid, setCustomOid] = useState('')
  const [selectedObjDetails, setSelectedObjDetails] = useState(null)
  const [queryMethod, setQueryMethod] = useState('get') // get | walk
  
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryResult, setQueryResult] = useState(null)
  
  const toast = useToast()

  // Load devices on mount
  useEffect(() => {
    const fetchDevices = async () => {
      setLoadingDevices(true)
      try {
        const res = await devicesApi.list()
        setDevices(res.data)
      } catch (err) {
        toast.error('Gagal memuat daftar perangkat.')
      } finally {
        setLoadingDevices(false)
      }
    }
    fetchDevices()
  }, [])

  // Load active MIB objects when active tab is custom OR selected device changes
  useEffect(() => {
    if (activeTab !== 'custom') return

    const fetchMibObjects = async () => {
      setLoadingObjects(true)
      try {
        let vendorFilter = null
        if (selectedDeviceId) {
          const dev = devices.find(d => d.id === parseInt(selectedDeviceId))
          if (dev) {
            vendorFilter = dev.device_type
          }
        }
        const res = await mibsApi.getActiveObjects(vendorFilter ? { vendor: vendorFilter } : {})
        setMibObjects(res.data)
      } catch (err) {
        toast.error('Gagal memuat objek MIB kustom.')
      } finally {
        setLoadingObjects(false)
      }
    }

    fetchMibObjects()
  }, [activeTab, selectedDeviceId, devices])

  // Handle selected device change to auto fill basic parameters
  const handleDeviceChange = (deviceId) => {
    setSelectedDeviceId(deviceId)
    setSelectedObjId('')
    setCustomOid('')
    setSelectedObjDetails(null)
    setQueryResult(null)

    if (deviceId) {
      const dev = devices.find(d => d.id === parseInt(deviceId))
      if (dev) {
        setIp(dev.ip)
        setVersion(dev.snmp_version || 'v2c')
        setCommunity(dev.snmp_community || 'public')
      }
    } else {
      setIp('')
    }
  }

  // Handle MIB Object selection
  const handleMibObjectChange = (objId) => {
    setSelectedObjId(objId)
    setQueryResult(null)
    if (objId) {
      const obj = mibObjects.find(o => o.id === parseInt(objId))
      if (obj) {
        setCustomOid(obj.oid)
        setSelectedObjDetails(obj)
      }
    } else {
      setCustomOid('')
      setSelectedObjDetails(null)
    }
  }

  // Basic SNMP Connection Test
  const handleRunBasicTest = async (e) => {
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

  // Run Custom SNMP OID GET/WALK Query
  const handleRunCustomQuery = async (e) => {
    e.preventDefault()
    if (!selectedDeviceId) {
      toast.error('Pilih perangkat target terlebih dahulu.')
      return
    }
    if (!customOid) {
      toast.error('Tentukan OID query terlebih dahulu.')
      return
    }

    setQueryLoading(true)
    setQueryResult(null)
    toast.info(`Menjalankan SNMP ${queryMethod.toUpperCase()} OID ${customOid}...`)

    try {
      const res = await snmpApi.queryCustom({
        device_id: parseInt(selectedDeviceId),
        oid: customOid,
        method: queryMethod
      })
      if (res.data.success) {
        setQueryResult({
          success: true,
          results: res.data.results
        })
        toast.success(`Query SNMP ${queryMethod.toUpperCase()} Sukses!`)
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || 'Gagal mengeksekusi kueri OID.'
      setQueryResult({
        success: false,
        message: errMsg
      })
      toast.error('SNMP Query Gagal.')
    } finally {
      setQueryLoading(false)
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Radio size={22} style={{ color: 'var(--primary)' }} />
            SNMP Tester & MIB Query
          </div>
          <div className="page-subtitle">Uji coba parameter SNMP dan jalankan kueri kustom OID berbasis berkas MIB.</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        <button 
          className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('basic')
            setResult(null)
          }}
        >
          <Cpu size={14} /> Koneksi Dasar
        </button>
        <button 
          className={`tab-btn ${activeTab === 'custom' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('custom')
            setQueryResult(null)
          }}
        >
          <FileCode size={14} /> Kueri OID MIB Kustom
        </button>
      </div>

      {/* ─── TAB CONTENT: BASIC TEST ─── */}
      {activeTab === 'basic' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>
          {/* Form Card */}
          <div className="card">
            <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
              Parameter Uji Coba SNMP (Raw)
            </div>
            
            {/* Quick Select from Devices */}
            <div className="form-group" style={{ marginBottom: '16px', background: 'var(--bg-input)', padding: '10px', borderRadius: 'var(--radius-sm)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px' }}>
                <Server size={12} /> Isi Cepat dari Device Terdaftar
              </label>
              <select
                value={selectedDeviceId}
                onChange={e => handleDeviceChange(e.target.value)}
                className="form-control"
                style={{ fontSize: '12px' }}
                disabled={loadingDevices || loading}
              >
                <option value="">-- Ketik IP manual atau Pilih Device --</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.ip})</option>
                ))}
              </select>
            </div>

            <form onSubmit={handleRunBasicTest}>
              <div className="form-group">
                <label className="form-label">IP Address perangkat target *</label>
                <input 
                  className="form-control" 
                  placeholder="192.168.1.1" 
                  value={ip}
                  onChange={e => {
                    setIp(e.target.value)
                    setSelectedDeviceId('') // clear device select if manually editing
                  }}
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

            <div className="card" style={{ borderLeft: '4px solid var(--primary)', background: 'var(--bg-sidebar)', padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--primary)', fontWeight: 700, fontSize: '13.5px' }}>
                <Info size={16} /> Informasi Protokol & Sandboxing Browser
              </div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
                <p style={{ marginBottom: '8px' }}>
                  Browser web beroperasi di dalam lingkungan sandboxed demi keamanan dan hanya mendukung protokol berbasis web seperti HTTP/HTTPS dan WebSocket. Browser tidak diizinkan untuk membuka koneksi soket mentah atau mengirim paket UDP (yang dibutuhkan oleh SNMP pada port 161).
                </p>
                <p>
                  Oleh karena itu, ketika Anda menekan tombol di atas, browser akan mengirimkan request HTTP ke server backend NetX, lalu server backend yang akan melakukan request UDP SNMP ke perangkat atas nama Anda dan mengembalikan hasilnya.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB CONTENT: CUSTOM OID MIB QUERY ─── */}
      {activeTab === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '24px', alignItems: 'start' }}>
          
          {/* Query Parameters Form */}
          <div className="card">
            <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
              Parameter Kueri OID MIB
            </div>
            
            <form onSubmit={handleRunCustomQuery}>
              
              {/* Select Target Device */}
              <div className="form-group">
                <label className="form-label">Perangkat Target *</label>
                <select
                  value={selectedDeviceId}
                  onChange={e => handleDeviceChange(e.target.value)}
                  className="form-control"
                  required
                  disabled={queryLoading}
                >
                  <option value="">-- Pilih Perangkat Target --</option>
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.ip}) — Tipe: {d.device_type}</option>
                  ))}
                </select>
                {selectedDeviceId && (
                  <span style={{ fontSize: '10.5px', color: 'var(--accent)', display: 'block', marginTop: '4px' }}>
                    Menyaring MIB aktif untuk vendor: <strong>{devices.find(d => d.id === parseInt(selectedDeviceId))?.device_type}</strong>
                  </span>
                )}
              </div>

              {/* MIB OID Dropdown Selection */}
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Pilih Objek MIB Terdaftar</span>
                  {loadingObjects && <span className="loading-spinner" style={{ width: 10, height: 10 }} />}
                </label>
                <select
                  value={selectedObjId}
                  onChange={e => handleMibObjectChange(e.target.value)}
                  className="form-control"
                  disabled={queryLoading || loadingObjects || !selectedDeviceId}
                  style={{ fontSize: '12.5px' }}
                >
                  <option value="">-- Pilih variabel OID (Opsional) --</option>
                  {mibObjects.map(obj => (
                    <option key={obj.id} value={obj.id}>
                      [{obj.mib_name}] {obj.name} ({obj.oid})
                    </option>
                  ))}
                </select>
                {!selectedDeviceId && (
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                    * Pilih perangkat target dahulu untuk memuat MIB yang relevan.
                  </span>
                )}
                {selectedDeviceId && mibObjects.length === 0 && !loadingObjects && (
                  <span style={{ fontSize: '10.5px', color: 'var(--danger)', display: 'block', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={10} /> Tidak ada MIB aktif yang terdaftar untuk tipe vendor perangkat ini. Silakan impor MIB di MIB Manager terlebih dahulu.
                  </span>
                )}
              </div>

              {/* Custom OID Input Field */}
              <div className="form-group">
                <label className="form-label">Object Identifier (OID) *</label>
                <input 
                  className="form-control font-mono" 
                  placeholder="Misal: 1.3.6.1.2.1.1.1.0" 
                  value={customOid}
                  onChange={e => {
                    setCustomOid(e.target.value)
                    setSelectedObjId('') // clear MIB selection if typing manually
                    setSelectedObjDetails(null)
                  }}
                  required
                  disabled={queryLoading}
                />
              </div>

              {/* Selected OID Object Details */}
              {selectedObjDetails && (
                <div style={{ background: 'var(--bg-input)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)' }}>{selectedObjDetails.name}</span>
                    <span className="badge badge-ssh" style={{ fontSize: '9px', padding: '1px 5px' }}>{selectedObjDetails.syntax || 'Unknown Syntax'}</span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
                    {selectedObjDetails.description || 'Tidak ada deskripsi berkas.'}
                  </p>
                </div>
              )}

              {/* Query Method Selection */}
              <div className="form-group">
                <label className="form-label">Metode Kueri SNMP</label>
                <div style={{ display: 'flex', gap: '14px', marginTop: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px' }}>
                    <input 
                      type="radio" 
                      name="query_method" 
                      value="get" 
                      checked={queryMethod === 'get'}
                      onChange={() => setQueryMethod('get')}
                      disabled={queryLoading}
                    />
                    SNMP GET (Single Value)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12.5px' }}>
                    <input 
                      type="radio" 
                      name="query_method" 
                      value="walk" 
                      checked={queryMethod === 'walk'}
                      onChange={() => setQueryMethod('walk')}
                      disabled={queryLoading}
                    />
                    SNMP WALK (Sub-tree scan)
                  </label>
                </div>
              </div>

              {/* Query Action Button */}
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                disabled={queryLoading || !selectedDeviceId}
              >
                {queryLoading ? (
                  <>
                    <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: '6px' }} />
                    Menjalankan Kueri...
                  </>
                ) : (
                  <>
                    <Play size={12} style={{ marginRight: 6 }} /> Jalankan Query OID
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Results Area */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '350px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '14px' }}>
              Hasil Query OID
            </h3>

            {queryLoading ? (
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '10px', minHeight: '200px' }}>
                <div className="loading-spinner" />
                <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Membaca data OID dari perangkat...</span>
              </div>
            ) : !queryResult ? (
              <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
                <Search size={32} className="text-muted" />
                <div className="empty-title">Belum ada data kueri</div>
                <div className="empty-desc">Pilih perangkat dan OID, lalu klik "Jalankan Query OID" di sebelah kiri.</div>
              </div>
            ) : !queryResult.success ? (
              <div style={{ padding: '16px', background: 'var(--danger-glow)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '13px', lineHeight: '1.5' }}>
                {queryResult.message}
              </div>
            ) : queryResult.results.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                Tidak ada data yang dikembalikan (NoSuchObject / NoSuchInstance).
              </div>
            ) : (
              <div className="table-wrapper" style={{ overflowY: 'auto', maxHeight: '420px' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '220px' }}>Object Identifier (OID)</th>
                      <th style={{ width: '120px' }}>Syntax Type</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.results.map((r, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{r.oid}</td>
                        <td>
                          <span className="badge badge-ssh" style={{ fontSize: '9px', padding: '1px 5px' }}>{r.syntax}</span>
                        </td>
                        <td className="mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', wordBreak: 'break-all' }}>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
