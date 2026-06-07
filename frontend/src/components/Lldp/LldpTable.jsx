import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import VendorBadge from '../Arp/VendorBadge'

export default function LldpTable({ neighbors = [] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return neighbors.filter(n =>
      !q ||
      (n.local_port        || '').toLowerCase().includes(q) ||
      (n.neighbor_name     || '').toLowerCase().includes(q) ||
      (n.neighbor_ip       || '').toLowerCase().includes(q) ||
      (n.neighbor_mac      || '').toLowerCase().includes(q) ||
      (n.neighbor_platform || '').toLowerCase().includes(q) ||
      (n.neighbor_vendor   || '').toLowerCase().includes(q) ||
      (n.device_hint       || '').toLowerCase().includes(q)
    )
  }, [neighbors, search])

  if (neighbors.length === 0) {
    return (
      <div className="empty-state" style={{ padding:'40px', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        <div className="empty-icon">🔗</div>
        <div className="empty-title">Belum ada data LLDP</div>
        <div className="empty-desc">Klik Refresh untuk mengambil data LLDP neighbor dari perangkat.</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="search-box" style={{ width:'320px' }}>
          <Search className="search-icon" />
          <input
            placeholder="Cari port, nama, IP, vendor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-muted text-sm">{filtered.length} / {neighbors.length} neighbor</span>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Local Port</th>
              <th>Neighbor Name</th>
              <th>Neighbor IP</th>
              <th>Neighbor MAC</th>
              <th>Neighbor Port</th>
              <th>Platform</th>
              <th>Vendor / Type</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n, i) => (
              <tr key={i}>
                <td className="mono" style={{ color:'var(--accent)' }}>{n.local_port || '—'}</td>
                <td style={{ fontWeight:600, color:'var(--text-primary)' }}>{n.neighbor_name || '—'}</td>
                <td className="mono">{n.neighbor_ip || '—'}</td>
                <td className="mono" style={{ color:'var(--text-secondary)', fontSize:'11px' }}>{n.neighbor_mac || '—'}</td>
                <td style={{ color:'var(--text-muted)', fontSize:'12px' }}>{n.neighbor_port || '—'}</td>
                <td style={{ color:'var(--text-muted)', fontSize:'11px', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={n.neighbor_platform}>
                  {n.neighbor_platform ? n.neighbor_platform.slice(0, 60) + (n.neighbor_platform.length > 60 ? '...' : '') : '—'}
                </td>
                <td>
                  <VendorBadge vendor={n.neighbor_vendor} category={n.device_category} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
