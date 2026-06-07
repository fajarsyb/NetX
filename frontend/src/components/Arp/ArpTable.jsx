import { useState, useMemo } from 'react'
import { Search, ArrowUpDown } from 'lucide-react'
import VendorBadge from './VendorBadge'

const TYPE_COLORS = {
  dynamic:    { color: 'var(--primary)',  bg: 'var(--primary-dim)' },
  static:     { color: 'var(--success)',  bg: 'var(--success-glow)' },
  incomplete: { color: 'var(--danger)',   bg: 'var(--danger-glow)' },
  interface:  { color: 'var(--warning)',  bg: 'var(--warning-glow)' },
}

export default function ArpTable({ entries = [] }) {
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('ip_address')
  const [sortDir, setSortDir]   = useState('asc')

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return entries.filter(e =>
      !q ||
      (e.ip_address   || '').toLowerCase().includes(q) ||
      (e.mac_address  || '').toLowerCase().includes(q) ||
      (e.mac_vendor   || '').toLowerCase().includes(q) ||
      (e.interface    || '').toLowerCase().includes(q) ||
      (e.device_hint  || '').toLowerCase().includes(q)
    )
  }, [entries, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = (a[sortKey] || '').toString()
      const bv = (b[sortKey] || '').toString()
      // Natural sort for IPs
      if (sortKey === 'ip_address') {
        const toNum = ip => ip.split('.').map(n => parseInt(n).toString().padStart(3,'0')).join('')
        return sortDir === 'asc'
          ? toNum(av).localeCompare(toNum(bv))
          : toNum(bv).localeCompare(toNum(av))
      }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [filtered, sortKey, sortDir])

  const SortTh = ({ k, children }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ cursor:'pointer', userSelect:'none' }}
      title={`Sort by ${k}`}
    >
      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px' }}>
        {children}
        <ArrowUpDown size={10} style={{ opacity: sortKey === k ? 1 : 0.3 }} />
      </span>
    </th>
  )

  if (entries.length === 0) {
    return (
      <div className="empty-state" style={{ padding:'40px', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        <div className="empty-icon">📡</div>
        <div className="empty-title">Belum ada data ARP</div>
        <div className="empty-desc">Klik tombol Refresh untuk mengambil ARP table dari perangkat.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Search */}
      <div className="flex-between mb-16">
        <div className="search-box" style={{ width: '320px' }}>
          <Search className="search-icon" />
          <input
            placeholder="Cari IP, MAC, Vendor, Interface..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-muted text-sm">
          {filtered.length} / {entries.length} entri
        </span>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <SortTh k="ip_address">IP Address</SortTh>
              <SortTh k="mac_address">MAC Address</SortTh>
              <SortTh k="interface">Interface</SortTh>
              <SortTh k="entry_type">Type</SortTh>
              <SortTh k="age_minutes">Age</SortTh>
              <SortTh k="mac_vendor">Vendor</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => {
              const tc = TYPE_COLORS[e.entry_type] || TYPE_COLORS.dynamic
              return (
                <tr key={i}>
                  <td className="mono">{e.ip_address}</td>
                  <td className="mono" style={{ color:'var(--text-secondary)' }}>{e.mac_address}</td>
                  <td style={{ color:'var(--text-secondary)', fontSize:'12px' }}>{e.interface || '—'}</td>
                  <td>
                    <span style={{
                      padding:'2px 8px', borderRadius:'20px', fontSize:'11px',
                      fontWeight:700, textTransform:'uppercase',
                      background: tc.bg, color: tc.color
                    }}>
                      {e.entry_type || 'dyn'}
                    </span>
                  </td>
                  <td style={{ color:'var(--text-muted)', fontSize:'12px' }}>
                    {e.age_minutes > 0 ? `${e.age_minutes}m` : '—'}
                  </td>
                  <td>
                    <VendorBadge vendor={e.mac_vendor} category={e.device_category} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
