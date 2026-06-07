import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Clock } from 'lucide-react'

const INTERVALS = [
  { label: 'OFF', value: 0 },
  { label: '10s', value: 10 },
  { label: '30s', value: 30 },
  { label: '1m',  value: 60 },
  { label: '5m',  value: 300 },
]

export default function RefreshControl({ onRefresh, loading, lastFetched }) {
  const [interval, setInterval_]  = useState(0)   // seconds; 0 = off
  const [remaining, setRemaining] = useState(0)
  const timerRef = useRef(null)
  const countdownRef = useRef(null)

  const formatTime = (iso) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    } catch { return iso }
  }

  const startCountdown = (secs) => {
    clearInterval(timerRef.current)
    clearInterval(countdownRef.current)
    if (!secs) { setRemaining(0); return }

    setRemaining(secs)

    countdownRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) return secs
        return r - 1
      })
    }, 1000)

    timerRef.current = setInterval(() => {
      onRefresh()
    }, secs * 1000)
  }

  useEffect(() => {
    startCountdown(interval)
    return () => {
      clearInterval(timerRef.current)
      clearInterval(countdownRef.current)
    }
  }, [interval])

  const progress = interval > 0 ? ((interval - remaining) / interval) * 100 : 0

  return (
    <div className="refresh-control">
      {/* Auto-refresh interval picker */}
      <div className="refresh-intervals">
        {INTERVALS.map(opt => (
          <button
            key={opt.value}
            className={`refresh-btn-option ${interval === opt.value ? 'active' : ''}`}
            onClick={() => setInterval_(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Progress bar (only when active) */}
      {interval > 0 && (
        <div className="refresh-progress" style={{ flex: '0 0 80px' }}>
          <div
            className="refresh-progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Manual refresh */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={onRefresh}
        disabled={loading}
        title="Refresh sekarang"
      >
        <RefreshCw size={13} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} />
        {loading ? 'Fetching...' : 'Refresh'}
      </button>

      {/* Last fetched */}
      {lastFetched && (
        <span className="last-fetched flex-center gap-8">
          <Clock size={11} />
          {formatTime(lastFetched)}
        </span>
      )}
    </div>
  )
}
