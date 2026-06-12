import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

export function useToast() {
  return useContext(ToastContext)
}

let _id = 0

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++_id
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }, [])

  const remove = (id) => setToasts(t => t.filter(x => x.id !== id))

  const icons = { success: CheckCircle, error: XCircle, info: Info, warning: Info }

  return (
    <ToastContext.Provider value={{
      show,
      success: m => show(m, 'success', 4000),
      error:   m => show(m, 'error',   5000),
      info:    m => show(m, 'info',    8000),
      warning: m => show(m, 'warning', 5000),
    }}>
      {children}
      <div className="toast-container">
        {toasts.map(t => {
          const Icon = icons[t.type] || Info
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon size={16} />
              <span style={{ flex: 1 }}>{t.message}</span>
              <button onClick={() => remove(t.id)} style={{ background:'none',border:'none',cursor:'pointer',color:'inherit',padding:'2px' }}>
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
