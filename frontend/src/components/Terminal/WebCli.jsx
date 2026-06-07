import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAuth } from '../../context/AuthContext'

export default function WebCli({ deviceId }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const { token } = useAuth()

  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff'
      },
      fontFamily: '"Fira Code", monospace',
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    term.open(terminalRef.current)
    fitAddon.fit()
    xtermRef.current = term

    // Connect WebSocket
    const wsUrl = `ws://${window.location.hostname}:8000/api/terminal/ws/${deviceId}?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // term.write('\r\n*** WebSocket Connected ***\r\n')
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
      fitAddon.fit()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
      term.dispose()
    }
  }, [deviceId, token])

  return (
    <div className="card p-0 overflow-hidden" style={{ height: '500px', backgroundColor: '#0d1117' }}>
      <div className="bg-gray-800 text-gray-400 text-xs py-1 px-3 border-b border-gray-700 flex justify-between">
        <span>Web CLI</span>
        <span>xterm.js</span>
      </div>
      <div ref={terminalRef} style={{ height: 'calc(100% - 24px)', padding: '10px' }} />
    </div>
  )
}
