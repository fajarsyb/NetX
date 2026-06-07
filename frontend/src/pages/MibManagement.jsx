import { useState, useEffect } from 'react'
import { 
  FileCode, Upload, Trash2, Eye, CheckCircle, XCircle, Info, RefreshCw, X, Search, ToggleLeft, ToggleRight
} from 'lucide-react'
import { mibsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

const SUPPORTED_VENDORS = [
  { value: 'all', label: 'Semua Vendor (Global)' },
  { value: 'cisco_ios', label: 'Cisco IOS' },
  { value: 'cisco_xe', label: 'Cisco XE' },
  { value: 'cisco_nxos', label: 'Cisco NX-OS' },
  { value: 'cisco_asa', label: 'Cisco ASA' },
  { value: 'juniper_junos', label: 'Juniper Junos' },
  { value: 'allied_telesis', label: 'Allied Telesis AW+' },
  { value: 'ruijie_os', label: 'Ruijie RGOS' },
  { value: 'ruckus_fastiron', label: 'Ruckus FastIron' },
  { value: 'mikrotik_routeros', label: 'MikroTik RouterOS' },
  { value: 'huawei', label: 'Huawei VRP' },
  { value: 'hp_procurve', label: 'HP ProCurve' },
  { value: 'hp_comware', label: 'HP Comware' },
  { value: 'fortinet', label: 'Fortinet FortiOS' },
  { value: 'aruba_os', label: 'ArubaOS' },
  { value: 'extreme_exos', label: 'Extreme EXOS' },
  { value: 'dell_os10', label: 'Dell OS10' },
  { value: 'paloalto_panos', label: 'Palo Alto PAN-OS' },
  { value: 'vyos', label: 'VyOS' }
]

export default function MibManagement() {
  const [mibs, setMibs] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Upload state
  const [file, setFile] = useState(null)
  const [desc, setDesc] = useState('')
  const [vendor, setVendor] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  // Drawer / View objects state
  const [selectedMib, setSelectedMib] = useState(null)
  const [objects, setObjects] = useState([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [searchObj, setSearchObj] = useState('')

  const toast = useToast()
  const { user } = useAuth()
  const isViewer = user?.role === 'viewer'

  const fetchMibs = async () => {
    setLoading(true)
    try {
      const res = await mibsApi.list()
      setMibs(res.data)
    } catch (err) {
      toast.error('Gagal memuat daftar MIB.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMibs()
  }, [])

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
    }
  }

  const handleUploadMib = async (e) => {
    e.preventDefault()
    if (isViewer || uploading) return
    if (!file) {
      toast.error('Pilih berkas MIB terlebih dahulu.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('description', desc)
    formData.append('vendor', vendor)

    setUploading(true)
    try {
      const res = await mibsApi.import(formData)
      if (res.data.success) {
        toast.success(res.data.message)
        setFile(null)
        setDesc('')
        setVendor('all')
        fetchMibs()
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal mengimpor berkas MIB.')
    } finally {
      setUploading(false)
    }
  }

  const handleToggleMib = async (mib) => {
    if (isViewer) return
    const newStatus = mib.is_active === 1 ? 0 : 1
    try {
      await mibsApi.update(mib.id, { is_active: newStatus })
      toast.success(`MIB "${mib.name}" ${newStatus === 1 ? 'diaktifkan' : 'dinonaktifkan'}.`)
      setMibs(prev => prev.map(m => m.id === mib.id ? { ...m, is_active: newStatus } : m))
    } catch (err) {
      toast.error('Gagal mengubah status MIB.')
    }
  }

  const handleUpdateMibVendor = async (mibId, newVendor) => {
    if (isViewer) return
    try {
      await mibsApi.update(mibId, { vendor: newVendor })
      toast.success('Asosiasi vendor berhasil diperbarui.')
      setMibs(prev => prev.map(m => m.id === mibId ? { ...m, vendor: newVendor } : m))
    } catch (err) {
      toast.error('Gagal memperbarui vendor MIB.')
    }
  }

  const handleDeleteMib = async (mib) => {
    if (isViewer) return
    if (!confirm(`Apakah Anda yakin ingin menghapus MIB "${mib.name}" beserta seluruh objek OID di dalamnya?`)) return
    try {
      await mibsApi.remove(mib.id)
      toast.success(`MIB "${mib.name}" berhasil dihapus.`)
      fetchMibs()
      if (selectedMib?.id === mib.id) {
        setSelectedMib(null)
      }
    } catch (err) {
      toast.error('Gagal menghapus MIB.')
    }
  }

  const handleOpenObjects = async (mib) => {
    setSelectedMib(mib)
    setLoadingObjects(true)
    setSearchObj('')
    try {
      const res = await mibsApi.listObjects(mib.id)
      setObjects(res.data)
    } catch (err) {
      toast.error('Gagal memuat objek MIB.')
    } finally {
      setLoadingObjects(false)
    }
  }

  const getVendorLabel = (val) => {
    const found = SUPPORTED_VENDORS.find(v => v.value === val)
    return found ? found.label : val
  }

  const filteredObjects = objects.filter(obj => 
    obj.name.toLowerCase().includes(searchObj.toLowerCase()) ||
    obj.oid.includes(searchObj)
  )

  return (
    <div className="page-container animate-fade">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">
            <FileCode size={22} style={{ color: 'var(--primary)' }} />
            Manajemen MIB SNMP
          </div>
          <div className="page-subtitle">
            Impor, parse, dan sesuaikan berkas MIB untuk kueri kustom SNMP per vendor perangkat.
          </div>
        </div>
      </div>

      <div className="grid-layout" style={{ display: 'grid', gridTemplateColumns: selectedMib ? '1fr 450px' : '1fr 320px', gap: '20px' }}>
        
        {/* Main Content Area: MIB List */}
        <div className="card">
          <div className="flex-between mb-16" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700 }}>Daftar MIB Terdaftar</h3>
            <button className="btn btn-ghost btn-sm" onClick={fetchMibs} disabled={loading}>
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Segarkan
            </button>
          </div>

          {loading ? (
            <div className="loading-overlay" style={{ minHeight: '200px' }}>
              <div className="loading-spinner" />
              Memuat MIB...
            </div>
          ) : mibs.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '200px' }}>
              <FileCode size={32} className="text-muted" />
              <div className="empty-title">Belum ada MIB diimpor</div>
              <div className="empty-desc">Gunakan panel kanan untuk mengunggah berkas MIB baru (.mib, .my, .txt).</div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Aktif</th>
                    <th>Nama MIB</th>
                    <th>Asosiasi Vendor</th>
                    <th>Deskripsi</th>
                    <th style={{ textAlign: 'center' }}>Jumlah Objek</th>
                    <th style={{ textAlign: 'right' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {mibs.map(mib => {
                    const isSelected = selectedMib?.id === mib.id
                    return (
                      <tr key={mib.id} style={{ background: isSelected ? 'var(--primary-dim)' : 'transparent' }}>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleToggleMib(mib)}
                            disabled={isViewer}
                            style={{ background: 'none', border: 'none', cursor: isViewer ? 'default' : 'pointer', color: mib.is_active ? 'var(--success)' : 'var(--text-muted)' }}
                          >
                            {mib.is_active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                          </button>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>{mib.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                              Diimpor: {new Date(mib.created_at).toLocaleDateString('id-ID')}
                            </span>
                          </div>
                        </td>
                        <td>
                          {isViewer ? (
                            <span className="badge badge-ssh">{getVendorLabel(mib.vendor)}</span>
                          ) : (
                            <select
                              value={mib.vendor}
                              onChange={(e) => handleUpdateMibVendor(mib.id, e.target.value)}
                              className="select-input"
                              style={{ padding: '3px 8px', fontSize: '11px', width: 'auto', background: 'var(--bg-input)' }}
                            >
                              {SUPPORTED_VENDORS.map(v => (
                                <option key={v.value} value={v.value}>{v.label}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{mib.description || 'Tidak ada deskripsi'}</td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                          <span className="badge badge-online" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>
                            {mib.objects_count}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleOpenObjects(mib)}
                              title="Lihat OID terdaftar"
                            >
                              <Eye size={12} /> Objek
                            </button>
                            {!isViewer && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleDeleteMib(mib)}
                                title="Hapus MIB"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Panel (Upload form OR View Objects Drawer) */}
        {!selectedMib ? (
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '14px' }}>
              Impor MIB Baru
            </h3>
            <form onSubmit={handleUploadMib} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              {/* Drag & Drop File Zone */}
              <div 
                className={`upload-zone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('mib-file-input').click()}
                style={{
                  border: dragActive ? '2px dashed var(--primary)' : '2px dashed var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragActive ? 'var(--primary-dim)' : 'var(--bg-input)',
                  transition: 'all 0.2s'
                }}
              >
                <input 
                  id="mib-file-input"
                  type="file" 
                  onChange={handleFileChange} 
                  accept=".mib,.my,.txt"
                  style={{ display: 'none' }}
                />
                <Upload size={32} className="text-muted" style={{ margin: '0 auto 8px', display: 'block' }} />
                <span style={{ fontSize: '12.5px', display: 'block', fontWeight: 600 }}>
                  {file ? file.name : 'Klik atau seret berkas MIB ke sini'}
                </span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  Format yang didukung: .mib, .my, .txt
                </span>
              </div>

              {/* Description */}
              <div>
                <label className="form-label" style={{ fontSize: '12px' }}>Deskripsi Singkat</label>
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Misal: Standar Interface MIB RFC 2863"
                  className="form-control"
                  style={{ fontSize: '12px' }}
                />
              </div>

              {/* Vendor Association */}
              <div>
                <label className="form-label" style={{ fontSize: '12px' }}>Kustomisasi untuk Vendor</label>
                <select
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '12px', background: 'var(--bg-input)' }}
                >
                  {SUPPORTED_VENDORS.map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginTop: '4px', lineHeight: '1.4' }}>
                  MIB akan diaktifkan secara otomatis saat pengguna melakukan SNMP query pada tipe perangkat vendor yang cocok.
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isViewer || uploading || !file}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {uploading ? (
                  <>
                    <span className="loading-spinner" style={{ width: 14, height: 14, borderTopColor: '#fff', marginRight: 8 }} />
                    Memproses MIB...
                  </>
                ) : (
                  <>
                    <Upload size={14} style={{ marginRight: 8 }} /> Unggah & Parse
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* Drawer: Parsed Objects View */
          <div className="card animate-slide" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '600px' }}>
            <div className="flex-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '12px' }}>
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{selectedMib.name}</h4>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Membaca {objects.length} objek OID hasil parsing</p>
              </div>
              <button className="btn-close" onClick={() => setSelectedMib(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {/* Object Search */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                type="text"
                value={searchObj}
                onChange={(e) => setSearchObj(e.target.value)}
                placeholder="Cari nama objek atau OID..."
                className="form-control"
                style={{ paddingLeft: '32px', fontSize: '12px' }}
              />
              <Search size={13} className="text-muted" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
            </div>

            {/* List of Objects */}
            {loadingObjects ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                <div className="loading-spinner" />
              </div>
            ) : filteredObjects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '12px' }}>
                Objek tidak ditemukan.
              </div>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                {filteredObjects.map(obj => (
                  <div 
                    key={obj.id} 
                    style={{ 
                      background: 'var(--bg-input)', 
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: '11.5px'
                    }}
                  >
                    <div className="flex-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{obj.name}</span>
                      {obj.syntax && (
                        <span className="badge badge-ssh" style={{ fontSize: '9.5px', padding: '1px 5px' }}>{obj.syntax}</span>
                      )}
                    </div>
                    
                    <div className="mono text-primary" style={{ fontSize: '10.5px', marginTop: '3px', wordBreak: 'break-all' }}>
                      {obj.oid}
                    </div>

                    {obj.description && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '10.5px', marginTop: '6px', lineHeight: '1.4', background: 'var(--bg-card-2)', padding: '6px', borderRadius: '4px' }}>
                        {obj.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
