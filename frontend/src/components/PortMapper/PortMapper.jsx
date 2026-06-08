import { useState, useMemo } from 'react'
import { Search, RefreshCw, Info, Cable, Cpu, Layers } from 'lucide-react'
import VendorBadge from '../Arp/VendorBadge'
import { useTheme } from '../../context/ThemeContext'
import { cleanInterfaceName, getPortLabel } from '../../utils/portUtils'

export default function PortMapper({ portMap = [], loading = false, onRefresh }) {
  const [search, setSearch] = useState('')
  const [selectedPort, setSelectedPort] = useState(null)
  const { theme } = useTheme()

  // Suffix clean helper for Juniper ports is imported from portUtils.js

  // Natural sort comparator for interfaces
  const sortedPorts = useMemo(() => {
    return [...portMap].sort((a, b) => 
      a.interface.localeCompare(b.interface, undefined, { numeric: true, sensitivity: 'base' })
    )
  }, [portMap])

  // Filter physical vs virtual/management ports
  const { physicalPorts, virtualPorts } = useMemo(() => {
    const phys = []
    const virt = []
    
    for (const p of sortedPorts) {
      const name = p.interface.toLowerCase()
      const isPhys = (
        name.includes('ethernet') || 
        name.includes('gi') || 
        name.includes('fa') || 
        name.includes('te') || 
        name.includes('ge-') || 
        name.includes('xe-') || 
        name.includes('et-') ||
        /^port\d+\.\d+\.\d+/.test(name) ||
        /^[a-z]+\d+\/\d+/.test(name) ||
        /^[a-z]+\d+\/\d+\/\d+/.test(name)
      ) && !name.includes('port-channel') && !name.includes('virtual') && !name.includes('vlan') && !name.includes('loopback') && !name.includes('null')

      if (isPhys) {
        phys.push(p)
      } else {
        virt.push(p)
      }
    }
    return { physicalPorts: phys, virtualPorts: virt }
  }, [sortedPorts])

  // Layout odd/even physical ports
  const { topRow, bottomRow } = useMemo(() => {
    const top = physicalPorts.filter((_, idx) => idx % 2 === 0)
    const bottom = physicalPorts.filter((_, idx) => idx % 2 !== 0)
    return { topRow: top, bottomRow: bottom }
  }, [physicalPorts])

  // Filtered list for the table
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return sortedPorts.filter(p => {
      if (!q) return true
      
      const matchIface = p.interface.toLowerCase().includes(q) || 
                         cleanInterfaceName(p.interface).toLowerCase().includes(q) ||
                         (p.alias || '').toLowerCase().includes(q)
                         
      const matchNeighbor = p.lldp_neighbor 
        ? (p.lldp_neighbor.neighbor_name.toLowerCase().includes(q) || p.lldp_neighbor.neighbor_ip.toLowerCase().includes(q))
        : p.cdp_neighbor
        ? (p.cdp_neighbor.neighbor_name.toLowerCase().includes(q) || p.cdp_neighbor.neighbor_ip.toLowerCase().includes(q))
        : false

      const matchMacs = p.mac_entries.some(m => 
        m.mac_address.toLowerCase().includes(q) || 
        m.ip_address.toLowerCase().includes(q) || 
        m.mac_vendor.toLowerCase().includes(q) ||
        (m.vlan || '').toLowerCase().includes(q)
      )

      return matchIface || matchNeighbor || matchMacs
    })
  }, [sortedPorts, search])

  // getPortLabel is imported from portUtils.js

  // Get color gradient/class depending on port properties and theme
  const getPortStyle = (port) => {
    const status = port.status?.toLowerCase()
    const adminStatus = port.admin_status?.toLowerCase()

    // 1. Down / Disabled / Shut (Red)
    if (adminStatus === 'down') {
      return {
        background: 'linear-gradient(180deg, #ef4444 0%, #c2410c 100%)',
        border: '1px solid #f87171',
        color: '#ffffff',
        boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)'
      }
    }

    // 2. Unused / Oper Down (Grey)
    if (status === 'down') {
      return {
        background: theme === 'light'
          ? 'linear-gradient(180deg, #f1f5f9 0%, #cbd5e1 100%)'
          : 'linear-gradient(180deg, #334155 0%, #1e293b 100%)',
        border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #475569',
        color: theme === 'light' ? '#475569' : '#94a3b8'
      }
    }
    
    // 3. Up (Uplink / Neighbor connected - Purple)
    if (port.lldp_neighbor || port.cdp_neighbor) {
      return {
        background: 'linear-gradient(180deg, #a855f7 0%, #7c3aed 100%)',
        border: '1px solid #c084fc',
        color: '#ffffff',
        boxShadow: '0 0 10px rgba(124, 58, 237, 0.4)'
      }
    }

    // 4. Up / Client / Active (Green)
    if (status === 'up' || (port.mac_entries && port.mac_entries.length > 0)) {
      return {
        background: 'linear-gradient(180deg, #10b981 0%, #047857 100%)',
        border: '1px solid #34d399',
        color: '#ffffff',
        boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)'
      }
    }

    // Fallback (Grey)
    return {
      background: 'linear-gradient(180deg, #4b5563 0%, #374151 100%)',
      border: '1px solid #6b7280',
      color: '#d1d5db'
    }
  }

  // Render detail view of active/hovered port
  const activeDetail = selectedPort || (physicalPorts.length > 0 ? physicalPorts[0] : (sortedPorts.length > 0 ? sortedPorts[0] : null))

  return (
    <div className="animate-slide">
      {/* Physical Faceplate View Panel */}
      {physicalPorts.length > 0 && (
        <div className="card p-24 mb-24" style={{ 
          background: theme === 'light' ? 'var(--bg-card)' : '#0b0f19', 
          border: '1px solid var(--border)', 
          borderRadius: '12px' 
        }}>
          <div className="flex-between mb-16">
            <div>
              <h4 style={{ margin: 0, fontSize: '15px', color: theme === 'light' ? 'var(--text-primary)' : '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={16} className="text-primary" /> Visualisasi Panel Port Switch (Fisik)
              </h4>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Alternasi Port Ganjil (Baris Atas) dan Genap (Baris Bawah). Klik port untuk melihat detail.
              </p>
            </div>
            {/* Status Legend */}
            <div style={{ display: 'flex', gap: '16px', fontSize: '11px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, background: 'linear-gradient(180deg, #10b981 0%, #047857 100%)', borderRadius: '2px' }} /> Up (Aktif)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, background: 'linear-gradient(180deg, #a855f7 0%, #7c3aed 100%)', borderRadius: '2px' }} /> Up (Uplink / Tetangga)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{ 
                  width: 8, 
                  height: 8, 
                  background: theme === 'light' ? '#cbd5e1' : '#334155', 
                  border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid #475569', 
                  borderRadius: '2px' 
                }} /> Tidak Digunakan
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, background: 'linear-gradient(180deg, #ef4444 0%, #c2410c 100%)', borderRadius: '2px' }} /> Down (Disabled)
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', alignItems: 'start' }}>
            {/* Switch Chassis Faceplate */}
            <div style={{
              background: theme === 'light' 
                ? 'linear-gradient(180deg, #f8fafc 0%, #edf2f7 100%)' 
                : 'linear-gradient(180deg, #182030 0%, #0f131f 100%)',
              border: theme === 'light' ? '2px solid #cbd5e1' : '2px solid #2d3748',
              borderRadius: '8px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              overflowX: 'auto',
              boxShadow: theme === 'light'
                ? 'inset 0 1px 3px rgba(0,0,0,0.1), 0 4px 6px -1px rgba(0,0,0,0.05)'
                : 'inset 0 1px 3px rgba(0,0,0,0.8), 0 4px 6px -1px rgba(0,0,0,0.5)'
            }}>
              {/* LED Status indicators */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', color: theme === 'light' ? '#64748b' : '#475569', fontWeight: 800, fontFamily: 'monospace' }}>NetX SWITCH</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px #22c55e' }} title="PWR" />
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} title="SYS" />
                </div>
              </div>

              {/* Ports Grid layout (Odd baris atas, Even baris bawah) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 'max-content' }}>
                {/* Top Row (Odd Ports) */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {topRow.map((port, idx) => (
                    <div
                      key={port.normalized}
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        transform: activeDetail?.normalized === port.normalized ? 'scale(1.1)' : 'none',
                        border: activeDetail?.normalized === port.normalized 
                          ? (theme === 'light' ? '2px solid var(--primary)' : '2px solid #ffffff') 
                          : '',
                        ...getPortStyle(port)
                      }}
                      onClick={() => setSelectedPort(port)}
                      title={`${cleanInterfaceName(port.interface)} (${port.status?.toUpperCase()})`}
                    >
                      {getPortLabel(port.interface)}
                    </div>
                  ))}
                </div>

                {/* Bottom Row (Even Ports) */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {bottomRow.map((port, idx) => (
                    <div
                      key={port.normalized}
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        transform: activeDetail?.normalized === port.normalized ? 'scale(1.1)' : 'none',
                        border: activeDetail?.normalized === port.normalized 
                          ? (theme === 'light' ? '2px solid var(--primary)' : '2px solid #ffffff') 
                          : '',
                        ...getPortStyle(port)
                      }}
                      onClick={() => setSelectedPort(port)}
                      title={`${cleanInterfaceName(port.interface)} (${port.status?.toUpperCase()})`}
                    >
                      {getPortLabel(port.interface)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Details Card for Selected Port */}
            {activeDetail && (
              <div className="card p-16" style={{ 
                background: theme === 'light' ? 'var(--bg-card-2)' : '#131924', 
                border: theme === 'light' ? '1px solid var(--border)' : '1px solid #2d3748', 
                borderRadius: '8px', 
                color: 'var(--text-primary)' 
              }}>
                <div className="flex-between" style={{ borderBottom: theme === 'light' ? '1px solid var(--border)' : '1px solid #2d3748', paddingBottom: '10px', marginBottom: '12px' }}>
                  <div>
                    <h5 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔌 Detail Port: <span style={{ color: 'var(--primary)' }}>{cleanInterfaceName(activeDetail.interface)}</span>
                    </h5>
                    {activeDetail.alias && (
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{activeDetail.alias}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge badge-${activeDetail.status === 'up' ? 'online' : 'offline'}`} style={{ padding: '2px 8px', fontSize: '10px' }}>
                      {activeDetail.status?.toUpperCase()}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>{activeDetail.speed}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                  {/* Neighbors (LLDP/CDP) */}
                  <div style={{ 
                    background: theme === 'light' ? 'var(--bg-card)' : '#0b0f19', 
                    padding: '12px', 
                    borderRadius: '6px', 
                    border: '1px solid var(--border)' 
                  }}>
                    <h6 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 600, color: '#a855f7', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cable size={14} /> Neighbor Terhubung (LLDP/CDP)
                    </h6>
                    {activeDetail.lldp_neighbor ? (
                      <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div><strong>Nama:</strong> {activeDetail.lldp_neighbor.neighbor_name}</div>
                        <div><strong>IP Tetangga:</strong> <span className="mono">{activeDetail.lldp_neighbor.neighbor_ip}</span></div>
                        <div><strong>Port Lawan:</strong> <span className="mono">{cleanInterfaceName(activeDetail.lldp_neighbor.neighbor_port)}</span></div>
                        <div><strong>Model / Vendor:</strong> {activeDetail.lldp_neighbor.device_hint} ({activeDetail.lldp_neighbor.neighbor_vendor})</div>
                      </div>
                    ) : activeDetail.cdp_neighbor ? (
                      <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div><strong>Nama (CDP):</strong> {activeDetail.cdp_neighbor.neighbor_name}</div>
                        <div><strong>IP Tetangga:</strong> <span className="mono">{activeDetail.cdp_neighbor.neighbor_ip}</span></div>
                        <div><strong>Port Lawan:</strong> <span className="mono">{cleanInterfaceName(activeDetail.cdp_neighbor.neighbor_port)}</span></div>
                        <div><strong>Platform:</strong> {activeDetail.cdp_neighbor.neighbor_platform}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '4px 0' }}>Tidak ada neighbor terdeteksi.</div>
                    )}
                  </div>

                  {/* Learned MAC Addresses */}
                  <div style={{ 
                    background: theme === 'light' ? 'var(--bg-card)' : '#0b0f19', 
                    padding: '12px', 
                    borderRadius: '6px', 
                    border: '1px solid var(--border)' 
                  }}>
                    <h6 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 600, color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cpu size={14} /> MAC Address Terdeteksi ({activeDetail.mac_entries.length})
                    </h6>
                    {activeDetail.mac_entries.length > 0 ? (
                      <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {activeDetail.mac_entries.map((m, idx) => (
                          <div key={idx} style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between', borderBottom: idx < activeDetail.mac_entries.length - 1 ? '1px dashed var(--border)' : 'none', paddingBottom: '4px' }}>
                            <div>
                              <span className="mono text-primary" style={{ fontWeight: 600 }}>{m.mac_address}</span>
                              <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{m.mac_vendor} (VLAN {m.vlan})</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span className="mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.ip_address}</span>
                              <div style={{ fontSize: '9px', textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{m.entry_type}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', padding: '4px 0' }}>Tidak ada host/MAC address learned pada port ini.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search and Table Section */}
      <div className="card">
        <div className="p-20" style={{ borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div className="search-box" style={{ width: '320px' }}>
            <Search className="search-icon" />
            <input
              placeholder="Cari port, MAC, IP, vendor, neighbor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Menampilkan <strong>{filtered.length}</strong> dari {portMap.length} port
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loading} style={{ gap: '6px' }}>
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              Segarkan Port Map
            </button>
          </div>
        </div>

        {loading && portMap.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px', gap: '16px' }}>
            <div className="loading-spinner" style={{ width: 32, height: 32 }} />
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Menganalisis dan menyusun port mapping perangkat...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Tidak ada port ditemukan atau cocok dengan kata kunci pencarian.
          </div>
        ) : (
          <div className="table-wrapper" style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: '20px', width: '22%' }}>Port & Deskripsi</th>
                  <th style={{ width: '12%' }}>Status</th>
                  <th style={{ width: '38%' }}>Connected Host (MAC, IP, Vendor)</th>
                  <th style={{ paddingRight: '20px', width: '28%' }}>Neighbor Uplink (LLDP/CDP)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((port) => {
                  const hasNeighbor = port.lldp_neighbor || port.cdp_neighbor
                  const isUp = port.status === 'up'
                  return (
                    <tr 
                      key={port.normalized} 
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        background: activeDetail?.normalized === port.normalized ? 'rgba(79, 142, 247, 0.05)' : ''
                      }}
                    >
                      {/* Port Name & Description */}
                      <td style={{ paddingLeft: '20px', verticalAlign: 'top', paddingBottom: '12px', paddingTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span 
                            style={{ fontWeight: 700, color: hasNeighbor ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer' }}
                            onClick={() => {
                              setSelectedPort(port)
                              const el = document.querySelector('.card[style*="background: rgb(11, 15, 25)"]') || document.querySelector('.card[style*="background: var(--bg-card)"]')
                              if (el) el.scrollIntoView({ behavior: 'smooth' })
                            }}
                          >
                            {cleanInterfaceName(port.interface)}
                          </span>
                        </div>
                        {port.alias && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '2px', wordBreak: 'break-word', maxWidth: '200px' }}>
                            {port.alias}
                          </div>
                        )}
                      </td>

                      {/* Status / Speed */}
                      <td style={{ verticalAlign: 'top', paddingBottom: '12px', paddingTop: '12px' }}>
                        <span className={`badge badge-${isUp ? 'online' : 'offline'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', fontSize: '11px' }}>
                          <span 
                            className="status-dot" 
                            style={{ 
                              background: isUp ? 'var(--success)' : 'var(--danger)',
                              boxShadow: isUp ? '0 0 6px var(--success)' : 'none',
                              width: '6px', height: '6px'
                            }} 
                          />
                          {port.status?.toUpperCase()}
                        </span>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 }}>{port.speed}</div>
                      </td>

                      {/* Hosts (MAC, IP, Vendor) */}
                      <td style={{ verticalAlign: 'top', paddingBottom: '12px', paddingTop: '12px' }}>
                        {port.mac_entries.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {port.mac_entries.map((m, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary)' }}>{m.mac_address}</span>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>VLAN {m.vlan} • {m.entry_type}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <VendorBadge vendor={m.mac_vendor} category={null} showIcon={false} />
                                  <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{m.ip_address}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12.5px', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>

                      {/* Neighbor information */}
                      <td style={{ paddingRight: '20px', verticalAlign: 'top', paddingBottom: '12px', paddingTop: '12px' }}>
                        {port.lldp_neighbor ? (
                          <div style={{ padding: '8px 12px', background: 'rgba(168, 85, 247, 0.05)', border: '1px solid rgba(168, 85, 247, 0.2)', borderRadius: '6px' }}>
                            <div style={{ fontWeight: 600, fontSize: '12.5px', color: '#a855f7' }}>{port.lldp_neighbor.neighbor_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              IP: <span className="mono" style={{ fontWeight: 600 }}>{port.lldp_neighbor.neighbor_ip}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              Port: <span className="mono">{cleanInterfaceName(port.lldp_neighbor.neighbor_port)}</span>
                            </div>
                            <div style={{ fontSize: '10px', color: '#a855f7', fontWeight: 600, marginTop: '4px' }}>
                              LLDP • {port.lldp_neighbor.device_hint}
                            </div>
                          </div>
                        ) : port.cdp_neighbor ? (
                          <div style={{ padding: '8px 12px', background: 'rgba(79, 142, 247, 0.05)', border: '1px solid rgba(79, 142, 247, 0.2)', borderRadius: '6px' }}>
                            <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--primary)' }}>{port.cdp_neighbor.neighbor_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              IP: <span className="mono" style={{ fontWeight: 600 }}>{port.cdp_neighbor.neighbor_ip}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              Port: <span className="mono">{cleanInterfaceName(port.cdp_neighbor.neighbor_port)}</span>
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--primary)', fontWeight: 600, marginTop: '4px' }}>
                              CDP • {port.cdp_neighbor.neighbor_platform}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '12.5px', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
