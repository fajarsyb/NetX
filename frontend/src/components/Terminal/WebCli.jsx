import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAuth } from '../../context/AuthContext'

const WebCli = forwardRef(function WebCli({ deviceId, isActive = true, height = '500px' }, ref) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const fitAddonRef = useRef(null)
  const { token } = useAuth()
  const [reconnectTrigger, setReconnectTrigger] = useState(0)

  // Expose executeCommand to parent via ref
  useImperativeHandle(ref, () => ({
    executeCommand: (cmd) => {
      const ws = wsRef.current
      const term = xtermRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      // Send each line followed by Enter
      const lines = cmd.split('\n').filter(l => l.trim())
      lines.forEach((line, idx) => {
        setTimeout(() => {
          ws.send(line + '\n')
        }, idx * 80)
      })
      // Focus terminal
      if (term) term.focus()
    }
  }))

  // Terminal initialization and WebSocket connection
  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
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
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    term.open(terminalRef.current)
    try {
      fitAddon.fit()
    } catch (e) {
      console.warn('Initial fit warning:', e)
    }
    xtermRef.current = term

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Connect directly to port 8000 during dev mode, or use standard host in production
    const host = import.meta.env.DEV 
      ? `${window.location.hostname}:8000` 
      : window.location.host
    const wsUrl = `${protocol}//${host}/api/terminal/ws/${deviceId}?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Handled automatically
    }

    ws.onmessage = (event) => {
      term.write(event.data)
    }

    ws.onclose = () => {
      term.write('\r\n*** Connection Closed ***\r\n')
    }

    ws.onerror = (err) => {
      term.write('\r\n*** WebSocket Error ***\r\n')
      console.error(err)
    }

    // Send keystrokes to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    const handleResize = () => {
      try {
        fitAddon.fit()
      } catch (e) {}
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
      term.dispose()
    }
  }, [deviceId, token, reconnectTrigger])

  // Refit when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current.fit()
          if (xtermRef.current) {
            xtermRef.current.focus()
          }
        } catch (e) {
          console.warn('Xterm fit warning:', e)
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isActive])

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear()
      xtermRef.current.focus()
    }
  }

  const handleReconnect = () => {
    setReconnectTrigger(prev => prev + 1)
  }

  return (
    <div className="card p-0 overflow-hidden flex" style={{ height: height, display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', border: '1px solid var(--border)' }}>
      <div className="text-gray-300 text-xs py-2 px-3 border-b border-gray-700 flex justify-between items-center" style={{ backgroundColor: '#161b22', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
          <span style={{ fontWeight: 600 }}>Web CLI Terminal</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={handleClear}
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 8px', fontSize: '11px', color: 'var(--text-secondary)', height: 'auto', border: '1px solid var(--border)', background: 'transparent' }}
          >
            Clear Screen
          </button>
          <button 
            onClick={handleReconnect}
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 8px', fontSize: '11px', color: 'var(--text-secondary)', height: 'auto', border: '1px solid var(--border)', background: 'transparent' }}
          >
            Reconnect
          </button>
        </div>
      </div>
      <div ref={terminalRef} style={{ flexGrow: 1, padding: '10px', overflow: 'hidden' }} />
    </div>
  )
})

export default WebCli
