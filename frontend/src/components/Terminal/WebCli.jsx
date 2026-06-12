import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAuth } from '../../context/AuthContext'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'

// ── Custom terminal search (no @xterm/addon-search required) ─────────────────
// Uses xterm's built-in searchAddon API if available; falls back to
// decorating via the xterm selection highlight mechanism.

function TerminalSearchBar({ term, onClose }) {
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(null)
  const [matchIdx, setMatchIdx] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const inputRef = useRef(null)

  // Extract all visible text from xterm buffer
  const getBufferText = useCallback(() => {
    if (!term) return []
    const lines = []
    const buf = term.buffer.active
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (line) lines.push(line.translateToString(true))
    }
    return lines
  }, [term])

  const search = useCallback((q, direction = 'next', startIdx = null) => {
    if (!q || !term) {
      setMatchCount(null)
      return
    }

    const lines = getBufferText()
    const cmp = caseSensitive ? q : q.toLowerCase()
    const matches = [] // { lineIdx, colIdx }

    lines.forEach((line, li) => {
      const src = caseSensitive ? line : line.toLowerCase()
      let pos = 0
      while (true) {
        const idx = src.indexOf(cmp, pos)
        if (idx === -1) break
        matches.push({ lineIdx: li, colIdx: idx })
        pos = idx + 1
      }
    })

    setMatchCount(matches.length)

    if (matches.length === 0) return

    let nextIdx = matchIdx
    if (direction === 'next') {
      nextIdx = startIdx !== null ? startIdx : (matchIdx + 1) % matches.length
    } else {
      nextIdx = (matchIdx - 1 + matches.length) % matches.length
    }
    setMatchIdx(nextIdx)

    // Scroll terminal to the match line
    const m = matches[nextIdx]
    if (m) {
      term.scrollToLine(m.lineIdx)
      term.select(m.colIdx, m.lineIdx, q.length)
    }
  }, [term, caseSensitive, matchIdx, getBufferText])

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus()

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') {
        e.preventDefault()
        search(query, e.shiftKey ? 'prev' : 'next')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, search, query])

  const handleQueryChange = (e) => {
    setQuery(e.target.value)
    setMatchIdx(0)
    if (e.target.value) search(e.target.value, 'next', 0)
    else setMatchCount(null)
  }

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      right: 12,
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      background: '#1c2333',
      border: '1px solid #30363d',
      borderRadius: 8,
      padding: '5px 10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(8px)',
      animation: 'slideDown 0.15s ease',
    }}>
      <Search size={13} style={{ color: '#7d8590', flexShrink: 0 }} />
      <input
        ref={inputRef}
        value={query}
        onChange={handleQueryChange}
        placeholder="Search terminal..."
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#e6edf3',
          fontSize: 12,
          width: 160,
          fontFamily: '"Fira Code", monospace',
        }}
      />
      {matchCount !== null && (
        <span style={{ fontSize: 11, color: matchCount === 0 ? '#f85149' : '#7d8590', whiteSpace: 'nowrap' }}>
          {matchCount === 0 ? 'No results' : `${matchIdx + 1}/${matchCount}`}
        </span>
      )}
      <button
        onClick={() => search(query, 'prev')}
        disabled={!query || matchCount === 0}
        title="Previous (Shift+Enter)"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', display: 'flex', padding: '2px', borderRadius: 4 }}
        onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'}
        onMouseLeave={e => e.currentTarget.style.color = '#7d8590'}
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={() => search(query, 'next')}
        disabled={!query || matchCount === 0}
        title="Next (Enter)"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', display: 'flex', padding: '2px', borderRadius: 4 }}
        onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'}
        onMouseLeave={e => e.currentTarget.style.color = '#7d8590'}
      >
        <ChevronDown size={14} />
      </button>
      <div style={{ width: 1, height: 16, background: '#30363d' }} />
      <button
        onClick={() => setCaseSensitive(c => !c)}
        title="Case Sensitive"
        style={{
          background: caseSensitive ? 'rgba(79,142,247,0.2)' : 'none',
          border: caseSensitive ? '1px solid #4f8ef7' : '1px solid transparent',
          borderRadius: 4,
          cursor: 'pointer',
          color: caseSensitive ? '#4f8ef7' : '#7d8590',
          fontSize: 10,
          fontWeight: 700,
          padding: '1px 5px',
          letterSpacing: 0.5,
        }}
      >
        Aa
      </button>
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7d8590', display: 'flex', padding: '2px', borderRadius: 4 }}
        onMouseEnter={e => e.currentTarget.style.color = '#f85149'}
        onMouseLeave={e => e.currentTarget.style.color = '#7d8590'}
      >
        <X size={13} />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const WebCli = forwardRef(function WebCli({ deviceId, isActive = true, height = '500px', isDirectSerial = false, serialPort = '', baudRate = 9600 }, ref) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const fitAddonRef = useRef(null)
  const { token } = useAuth()
  const [reconnectTrigger, setReconnectTrigger] = useState(0)
  const [showSearch, setShowSearch] = useState(false)

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    executeCommand: (cmd) => {
      const ws = wsRef.current
      const term = xtermRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const lines = cmd.split('\n').filter(l => l.trim())
      lines.forEach((line, idx) => {
        setTimeout(() => {
          ws.send(line + '\n')
        }, idx * 80)
      })
      if (term) term.focus()
    }
  }))

  // Ctrl+F to toggle search
  useEffect(() => {
    const handleGlobalKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only intercept if this terminal is active
        if (isActive) {
          e.preventDefault()
          setShowSearch(s => !s)
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [isActive])

  // Terminal initialization and WebSocket connection
  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(79,142,247,0.3)',
        selectionForeground: '#ffffff',
        black: '#21262d',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#ffffff'
      },
      fontFamily: '"Fira Code", monospace',
      fontSize: 14,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(terminalRef.current)
    try { fitAddon.fit() } catch (e) { console.warn('Initial fit warning:', e) }
    xtermRef.current = term

    // Ctrl+F inside xterm (intercept before it reaches the browser)
    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        setShowSearch(s => !s)
        return false // prevent default xterm handling
      }
      return true
    })

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = isDirectSerial
      ? `${protocol}//${host}/api/terminal/ws/serial/direct?token=${token}&port=${encodeURIComponent(serialPort)}&baudrate=${baudRate}`
      : `${protocol}//${host}/api/terminal/ws/${deviceId}?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => { term.write(event.data) }
    ws.onclose = () => { term.write('\r\n*** Connection Closed ***\r\n') }
    ws.onerror = (err) => { term.write('\r\n*** WebSocket Error ***\r\n'); console.error(err) }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    const handleResize = () => { try { fitAddon.fit() } catch (e) {} }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (ws.readyState === WebSocket.OPEN) ws.close()
      term.dispose()
    }
  }, [deviceId, token, reconnectTrigger])

  // Refit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current.fit()
          if (xtermRef.current) xtermRef.current.focus()
        } catch (e) { console.warn('Xterm fit warning:', e) }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive])

  const handleClear = () => {
    if (xtermRef.current) { xtermRef.current.clear(); xtermRef.current.focus() }
  }

  const handleReconnect = () => setReconnectTrigger(prev => prev + 1)

  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', border: '1px solid var(--border)' }}>
      {/* ── Toolbar ────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#161b22', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #21262d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--success)' }} />
          <span style={{ fontWeight: 600, fontSize: 12, color: '#e6edf3' }}>Web CLI Terminal</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowSearch(s => !s)}
            title="Search (Ctrl+F)"
            style={{
              padding: '2px 8px',
              fontSize: 11,
              background: showSearch ? 'rgba(79,142,247,0.15)' : 'transparent',
              border: showSearch ? '1px solid rgba(79,142,247,0.4)' : '1px solid #30363d',
              borderRadius: 5,
              color: showSearch ? '#4f8ef7' : '#7d8590',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s',
            }}
          >
            <Search size={11} /> Search
          </button>
          <button
            onClick={handleClear}
            style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px solid #30363d', borderRadius: 5, color: '#7d8590', cursor: 'pointer', transition: 'color 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'}
            onMouseLeave={e => e.currentTarget.style.color = '#7d8590'}
          >
            Clear
          </button>
          <button
            onClick={handleReconnect}
            style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px solid #30363d', borderRadius: 5, color: '#7d8590', cursor: 'pointer', transition: 'color 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'}
            onMouseLeave={e => e.currentTarget.style.color = '#7d8590'}
          >
            Reconnect
          </button>
        </div>
      </div>

      {/* ── Terminal Area (relative for search overlay) ────── */}
      <div style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
        {showSearch && (
          <TerminalSearchBar
            term={xtermRef.current}
            onClose={() => {
              setShowSearch(false)
              if (xtermRef.current) xtermRef.current.focus()
            }}
          />
        )}
        <div ref={terminalRef} style={{ height: '100%', width: '100%', padding: '10px' }} />
      </div>
    </div>
  )
})

export default WebCli
