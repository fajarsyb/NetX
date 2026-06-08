import { useState, useEffect } from 'react'
import { Sliders, Plus, Trash2, Edit2, Info, ChevronRight, AlertTriangle } from 'lucide-react'
import { thresholdsApi } from '../api/client'
import { useToast } from '../components/shared/ToastProvider'
import { useAuth } from '../context/AuthContext'

export default function ThresholdProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editProfile, setEditProfile] = useState(null)

  // Form fields state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [broadcastStormWarning, setBroadcastStormWarning] = useState(1000)
  const [broadcastStormCritical, setBroadcastStormCritical] = useState(5000)
  const [multicastStormWarning, setMulticastStormWarning] = useState(1000)
  const [multicastStormCritical, setMulticastStormCritical] = useState(5000)
  const [unicastStormWarning, setUnicastStormWarning] = useState(80000)
  const [unicastStormCritical, setUnicastStormCritical] = useState(120000)
  const [portFlapWarning, setPortFlapWarning] = useState(3)
  const [portFlapCritical, setPortFlapCritical] = useState(6)
  const [portFlapWindow, setPortFlapWindow] = useState(300)
  const [crcErrorRate, setCrcErrorRate] = useState(0.05)
  const [crcErrorDelta, setCrcErrorDelta] = useState(5)
  const [frameErrorRate, setFrameErrorRate] = useState(0.05)
  const [frameErrorDelta, setFrameErrorDelta] = useState(5)
  const [transmissionErrorRate, setTransmissionErrorRate] = useState(0.1)
  const [transmissionErrorDelta, setTransmissionErrorDelta] = useState(5)

  const { user } = useAuth()
  const toast = useToast()
  const isViewer = user?.role === 'viewer'

  const fetchProfiles = async () => {
    setLoading(true)
    try {
      const res = await thresholdsApi.list()
      setProfiles(res.data)
    } catch (err) {
      toast.error('Gagal mengambil daftar profil threshold.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProfiles()
  }, [])

  const openAdd = () => {
    setEditProfile(null)
    setName('')
    setDescription('')
    setBroadcastStormWarning(1000)
    setBroadcastStormCritical(5000)
    setMulticastStormWarning(1000)
    setMulticastStormCritical(5000)
    setUnicastStormWarning(80000)
    setUnicastStormCritical(120000)
    setPortFlapWarning(3)
    setPortFlapCritical(6)
    setPortFlapWindow(300)
    setCrcErrorRate(0.05)
    setCrcErrorDelta(5)
    setFrameErrorRate(0.05)
    setFrameErrorDelta(5)
    setTransmissionErrorRate(0.1)
    setTransmissionErrorDelta(5)
    setShowModal(true)
  }

  const openEdit = (p) => {
    setEditProfile(p)
    setName(p.name)
    setDescription(p.description || '')
    setBroadcastStormWarning(p.broadcast_storm_warning)
    setBroadcastStormCritical(p.broadcast_storm_critical)
    setMulticastStormWarning(p.multicast_storm_warning)
    setMulticastStormCritical(p.multicast_storm_critical)
    setUnicastStormWarning(p.unicast_storm_warning)
    setUnicastStormCritical(p.unicast_storm_critical)
    setPortFlapWarning(p.port_flap_warning)
    setPortFlapCritical(p.port_flap_critical)
    setPortFlapWindow(p.port_flap_window)
    setCrcErrorRate(p.crc_error_rate)
    setCrcErrorDelta(p.crc_error_delta)
    setFrameErrorRate(p.frame_error_rate)
    setFrameErrorDelta(p.frame_error_delta)
    setTransmissionErrorRate(p.transmission_error_rate)
    setTransmissionErrorDelta(p.transmission_error_delta)
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      name,
      description,
      broadcast_storm_warning: parseInt(broadcastStormWarning),
      broadcast_storm_critical: parseInt(broadcastStormCritical),
      multicast_storm_warning: parseInt(multicastStormWarning),
      multicast_storm_critical: parseInt(multicastStormCritical),
      unicast_storm_warning: parseInt(unicastStormWarning),
      unicast_storm_critical: parseInt(unicastStormCritical),
      port_flap_warning: parseInt(portFlapWarning),
      port_flap_critical: parseInt(portFlapCritical),
      port_flap_window: parseInt(portFlapWindow),
      crc_error_rate: parseFloat(crcErrorRate),
      crc_error_delta: parseInt(crcErrorDelta),
      frame_error_rate: parseFloat(frameErrorRate),
      frame_error_delta: parseInt(frameErrorDelta),
      transmission_error_rate: parseFloat(transmissionErrorRate),
      transmission_error_delta: parseInt(transmissionErrorDelta)
    }

    try {
      if (editProfile) {
        await thresholdsApi.update(editProfile.id, payload)
        toast.success('Profil threshold berhasil diperbarui.')
      } else {
        await thresholdsApi.create(payload)
        toast.success('Profil threshold baru berhasil dibuat.')
      }
      setShowModal(false)
      fetchProfiles()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menyimpan profil threshold.')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Apakah Anda yakin ingin menghapus profil ini?')) return
    try {
      await thresholdsApi.remove(id)
      toast.success('Profil threshold berhasil dihapus.')
      fetchProfiles()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Gagal menghapus profil threshold.')
    }
  }

  return (
    <div className="page-container animate-fade">
      <div className="page-header">
        <div>
          <div className="page-title">
            <Sliders size={22} style={{ color: 'var(--primary)' }} />
            Manajemen Profil Threshold
          </div>
          <div className="page-subtitle">Kustomisasi batas pemicu anomali trafik, link error, dan flapping untuk perangkat jaringan Anda</div>
        </div>
        {!isViewer && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Tambah Profil
          </button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay"><div className="loading-spinner" /></div>
        ) : profiles.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '200px' }}>
            <Sliders size={32} className="text-muted" style={{ marginBottom: '16px' }} />
            <div>Belum ada profil threshold kustom yang dibuat. Perangkat menggunakan parameter default sistem.</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Profil</th>
                  <th>Deskripsi</th>
                  <th>Batas Badai (Warn/Crit)</th>
                  <th>Link Flapping</th>
                  <th>Port Error Threshold</th>
                  {!isViewer && <th style={{ textAlign: 'right' }}>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</td>
                    <td>{p.description || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                        <span>Broadcast: <strong className="text-warning">{p.broadcast_storm_warning}</strong> / <strong className="text-danger">{p.broadcast_storm_critical}</strong> pps</span>
                        <span>Multicast: <strong className="text-warning">{p.multicast_storm_warning}</strong> / <strong className="text-danger">{p.multicast_storm_critical}</strong> pps</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: '12px' }}>
                        <span>{p.port_flap_warning} sd {p.port_flap_critical} kali / {p.port_flap_window}s</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                        <span>CRC: <strong>{p.crc_error_rate} err/s</strong> (delta &gt;={p.crc_error_delta})</span>
                        <span>TX/RX: <strong>{p.transmission_error_rate} err/s</strong> (delta &gt;={p.transmission_error_delta})</span>
                      </div>
                    </td>
                    {!isViewer && (
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex-center" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)} title="Edit Profil">
                            <Edit2 size={14} />
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)} title="Hapus Profil">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal animate-slide" style={{ maxWidth: '680px', width: '90%' }}>
            <div className="modal-header">
              <div className="modal-title">
                {editProfile ? 'Edit Profil Threshold' : 'Tambah Profil Threshold'}
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  
                  {/* General */}
                  <div style={{ gridColumn: 'span 2' }}>
                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '12px', color: 'var(--primary)' }}>Informasi Profil</h4>
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Nama Profil</label>
                    <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Profil Switch Access Lapangan" required />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Deskripsi</label>
                    <textarea className="form-control" value={description} onChange={e => setDescription(e.target.value)} placeholder="Tulis catatan mengenai penggunaan profil threshold ini..." rows={2} />
                  </div>

                  {/* Packet Storms */}
                  <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '12px', color: 'var(--primary)' }}>Batas Badai Paket (Storm Control pps)</h4>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Broadcast Storm Warning</label>
                    <input type="number" className="form-control" value={broadcastStormWarning} onChange={e => setBroadcastStormWarning(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Broadcast Storm Critical</label>
                    <input type="number" className="form-control" value={broadcastStormCritical} onChange={e => setBroadcastStormCritical(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Multicast Storm Warning</label>
                    <input type="number" className="form-control" value={multicastStormWarning} onChange={e => setMulticastStormWarning(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Multicast Storm Critical</label>
                    <input type="number" className="form-control" value={multicastStormCritical} onChange={e => setMulticastStormCritical(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unicast Storm Warning (Base 1G)</label>
                    <input type="number" className="form-control" value={unicastStormWarning} onChange={e => setUnicastStormWarning(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unicast Storm Critical (Base 1G)</label>
                    <input type="number" className="form-control" value={unicastStormCritical} onChange={e => setUnicastStormCritical(e.target.value)} required />
                  </div>

                  {/* Flapping */}
                  <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '12px', color: 'var(--primary)' }}>Port Flapping</h4>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Flap Warning Count</label>
                    <input type="number" className="form-control" value={portFlapWarning} onChange={e => setPortFlapWarning(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Flap Critical Count</label>
                    <input type="number" className="form-control" value={portFlapCritical} onChange={e => setPortFlapCritical(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Window Pengamatan (detik)</label>
                    <input type="number" className="form-control" value={portFlapWindow} onChange={e => setPortFlapWindow(e.target.value)} required />
                  </div>

                  {/* Errors */}
                  <div style={{ gridColumn: 'span 2', marginTop: '12px' }}>
                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '12px', color: 'var(--primary)' }}>Tingkat Error Kabel & Port Fisik</h4>
                  </div>
                  <div className="form-group">
                    <label className="form-label">CRC Error Rate (errors/detik)</label>
                    <input type="number" step="0.001" className="form-control" value={crcErrorRate} onChange={e => setCrcErrorRate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Delta CRC Errors</label>
                    <input type="number" className="form-control" value={crcErrorDelta} onChange={e => setCrcErrorDelta(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Frame Error Rate (errors/detik)</label>
                    <input type="number" step="0.001" className="form-control" value={frameErrorRate} onChange={e => setFrameErrorRate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Delta Frame Errors</label>
                    <input type="number" className="form-control" value={frameErrorDelta} onChange={e => setFrameErrorDelta(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Transmission Error Rate (errors/detik)</label>
                    <input type="number" step="0.001" className="form-control" value={transmissionErrorRate} onChange={e => setTransmissionErrorRate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Delta Transmission Errors</label>
                    <input type="number" className="form-control" value={transmissionErrorDelta} onChange={e => setTransmissionErrorDelta(e.target.value)} required />
                  </div>

                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
