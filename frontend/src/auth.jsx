import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, onUnauthorized, setAuthToken } from './api.js'

const AuthContext = createContext(null)

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('auth'))
    if (saved?.token && saved?.user) {
      setAuthToken(saved.token)
      return saved
    }
  } catch {
    // storage unavailable or corrupt; start logged out
  }
  return null
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem('auth', JSON.stringify(session))
    else localStorage.removeItem('auth')
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession)

  const start = useCallback(({ user, token }) => {
    setAuthToken(token)
    saveSession({ user, token })
    setSession({ user, token })
  }, [])

  const logout = useCallback(() => {
    setAuthToken(null)
    saveSession(null)
    setSession(null)
  }, [])

  useEffect(() => {
    onUnauthorized(logout)
  }, [logout])

  // Re-check the token whenever it changes; an expired one triggers logout via the 401 handler.
  const token = session?.token
  useEffect(() => {
    if (token) api.me().then((user) => setSession((s) => s && { ...s, user })).catch(() => {})
  }, [token])

  const value = {
    user: session?.user ?? null,
    login: async (credentials) => start(await api.login(credentials)),
    register: async (details) => start(await api.register(details)),
    logout,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
