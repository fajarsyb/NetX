import { createContext, useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useToast } from '../components/shared/ToastProvider'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem('netx_token'))
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      localStorage.setItem('netx_token', token)
    } else {
      delete api.defaults.headers.common['Authorization']
      localStorage.removeItem('netx_token')
    }
  }, [token])

  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const res = await api.get('/auth/me')
        setUser(res.data)
      } catch (err) {
        setToken(null)
        setUser(null)
        toast.error('Sesi login telah berakhir.')
      } finally {
        setLoading(false)
      }
    }
    validateToken()
  }, []) // Empty dependency array means it runs on mount, we don't want it to run when token changes to avoid duplicate fetches

  const login = async (username, password) => {
    const formData = new URLSearchParams()
    formData.append('username', username)
    formData.append('password', password)

    try {
      const res = await api.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      setToken(res.data.access_token)
      setUser(res.data.user)
      return { success: true }
    } catch (err) {
      return { success: false, message: err.response?.data?.detail || 'Gagal login.' }
    }
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    navigate('/login')
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
