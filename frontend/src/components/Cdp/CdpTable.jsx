import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { cleanInterfaceName } from '../../utils/portUtils'

export default function CdpTable({ neighbors = [] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return neighbors.filter(n =>
      !q ||
      (n.local_port        || '').toLowerCase().includes(q) ||
      (n.neighbor_name     || '').toLowerCase().includes(q) ||
      (n.neighbor_ip       || '').toLowerCase().includes(q) ||
      (n.neighbor_platform || '').toLowerCase().includes(q) ||
      (n.neighbor_port     || '').toLowerCase().includes(q)
    )
  }, [neighbors, search])

  if (neighbors.length === 0) {
    return (
      <div className="empty-state" style={{ padding:'40px', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        <div className="empty-icon">🤝</div>
        <div className="empty-title">Belum ada data CDP</div>
        <div className="empty-desc">Klik Refresh untuk mengambil data CDP neighbor dari perangkat.</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="search-box" style={{ width:'320px' }}>
          <Search className="search-icon" />
          <input
            placeholder="Cari port, nama, IP, platform..."
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
              <th>Neighbor Port</th>
              <th>Platform / Model</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n, i) => (
              <tr key={i}>
                <td className="mono" style={{ color:'var(--accent)' }}>{cleanInterfaceName(n.local_port) || '—'}</td>
                <td style={{ fontWeight:600, color:'var(--text-primary)' }}>{n.neighbor_name || '—'}</td>
                <td className="mono">{n.neighbor_ip || '—'}</td>
                <td style={{ color:'var(--text-muted)', fontSize:'12px' }}>{cleanInterfaceName(n.neighbor_port) || '—'}</td>
                <td style={{ color:'var(--text-muted)', fontSize:'11px', maxWidth:'250px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                    title={n.neighbor_platform}>
                  {n.neighbor_platform ? n.neighbor_platform.slice(0, 80) + (n.neighbor_platform.length > 80 ? '...' : '') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
