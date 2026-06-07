import { useState } from 'react'
import { Download, X, CheckSquare, Square } from 'lucide-react'

const COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Device Name' },
  { key: 'ip', label: 'IP Address' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'port', label: 'Port' },
  { key: 'username', label: 'Username' },
  { key: 'device_type', label: 'Device Type' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status' },
  { key: 'last_seen', label: 'Last Seen' },
  { key: 'group_name', label: 'Group Name' },
  { key: 'os_version', label: 'OS Version' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'mac_address', label: 'MAC Address' },
  { key: 'hardware_model', label: 'Hardware Model' },
  { key: 'device_role', label: 'Device Role' },
  { key: 'created_at', label: 'Created At' },
]

export default function ExportModal({ onClose, onExport }) {
  const [selectedColumns, setSelectedColumns] = useState(
    COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
  )

  const handleToggle = (key) => {
    setSelectedColumns((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const handleSelectAll = () => {
    setSelectedColumns(
      COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
    )
  }

  const handleDeselectAll = () => {
    setSelectedColumns(
      COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: false }), {})
    )
  }

  const handleExportClick = () => {
    const activeKeys = Object.keys(selectedColumns).filter((k) => selectedColumns[k])
    if (activeKeys.length === 0) {
      alert('Silakan pilih minimal satu kolom untuk diekspor.')
      return
    }
    onExport(activeKeys.join(','))
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '520px' }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Download size={18} style={{ color: 'var(--primary)' }} />
            Kustomisasi Ekspor CSV
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '20px 24px 10px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Pilih kolom-kolom data perangkat yang ingin Anda masukkan ke dalam file CSV ekspor:
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <button 
              className="btn btn-ghost btn-sm" 
              style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={handleSelectAll}
            >
              Pilih Semua
            </button>
            <button 
              className="btn btn-ghost btn-sm" 
              style={{ fontSize: '11px', padding: '4px 8px' }} 
              onClick={handleDeselectAll}
            >
              Hapus Semua
            </button>
          </div>

          {/* Column Grid */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: '10px 16px',
            maxHeight: '300px', 
            overflowY: 'auto',
            padding: '4px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-input)'
          }}>
            {COLUMNS.map((col) => {
              const isChecked = selectedColumns[col.key]
              return (
                <div 
                  key={col.key} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    padding: '6px 8px', 
                    cursor: 'pointer',
                    borderRadius: '4px',
                    transition: 'background 0.15s',
                    userSelect: 'none'
                  }}
                  onClick={() => handleToggle(col.key)}
                  className="hover-bg"
                >
                  <span style={{ color: isChecked ? 'var(--primary)' : 'var(--text-muted)' }}>
                    {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </span>
                  <span style={{ 
                    fontSize: '12.5px', 
                    color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isChecked ? 500 : 400
                  }}>
                    {col.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ padding: '16px 24px 20px' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={handleExportClick} style={{ gap: '8px' }}>
            <Download size={14} />
            Ekspor CSV
          </button>
        </div>
      </div>
    </div>
  )
}
