import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { cleanInterfaceName } from '../../utils/portUtils'

export default function RoutingTable({ routes = [] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return routes.filter(r =>
      !q ||
      (r.destination || '').toLowerCase().includes(q) ||
      (r.gateway     || '').toLowerCase().includes(q) ||
      (r.interface   || '').toLowerCase().includes(q) ||
      (r.protocol    || '').toLowerCase().includes(q)
    )
  }, [routes, search])

  if (routes.length === 0) {
    return (
      <div className="empty-state" style={{ padding:'40px', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        <div className="empty-icon">🛣️</div>
        <div className="empty-title">Belum ada data Routing</div>
        <div className="empty-desc">Klik Refresh untuk mengambil tabel routing dari perangkat.</div>
      </div>
    )
  }

  // Helper to colorize protocol
  const getProtoColor = (proto) => {
    const p = proto.toUpperCase()
    if (p.includes('C') || p.includes('DIRECT') || p.includes('STATIC/DIRECT')) return 'var(--success)'
    if (p.includes('S')) return 'var(--blue)'
    if (p.includes('O')) return 'var(--warning)'
    if (p.includes('B')) return 'var(--purple)'
    return 'var(--text-muted)'
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="search-box" style={{ width:'320px' }}>
          <Search className="search-icon" />
          <input
            placeholder="Cari network, gateway, interface, protocol..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-muted text-sm">{filtered.length} / {routes.length} route</span>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Destination Network</th>
              <th>Next Hop (Gateway)</th>
              <th>Interface</th>
              <th>Metric/AdminDist</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td>
                  <span style={{ fontWeight:700, color: getProtoColor(r.protocol) }}>
                    {r.protocol || '—'}
                  </span>
                </td>
                <td className="mono" style={{ color:'var(--text-primary)', fontWeight: 600 }}>{r.destination || '—'}</td>
                <td className="mono">{r.gateway || '—'}</td>
                <td style={{ color:'var(--text-muted)', fontSize:'12px' }}>{cleanInterfaceName(r.interface) || '—'}</td>
                <td className="mono" style={{ color:'var(--text-muted)', fontSize:'11px' }}>{r.metric || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
