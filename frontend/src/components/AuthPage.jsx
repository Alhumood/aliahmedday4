import { useState } from 'react'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'

export default function AuthPage() {
  const { t, toggle } = useI18n()
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isRegister = mode === 'register'
  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (isRegister && !form.name.trim()) return setError(t.nameRequired)
    if (!form.email.trim() || !form.password) return setError(t.authFieldsRequired)
    if (isRegister && form.password.length < 8) return setError(t.passwordTooShort)
    setSubmitting(true)
    setError('')
    try {
      if (isRegister) {
        await register({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      } else {
        await login({ email: form.email.trim(), password: form.password })
      }
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-screen">
      <button className="lang-toggle auth-lang" onClick={toggle}>🌐 {t.language}</button>
      <div className="card auth-card">
        <div className="brand auth-brand">
          <span className="brand-logo">C</span>
          <span>{t.appName}</span>
        </div>
        <h1 className="auth-title">{isRegister ? t.registerTitle : t.loginTitle}</h1>
        <p className="auth-subtitle">{isRegister ? t.registerSubtitle : t.loginSubtitle}</p>
        <form onSubmit={handleSubmit} className="form">
          {isRegister && (
            <label>
              {t.name} <span className="req">*</span>
              <input value={form.name} onChange={update('name')} autoComplete="name" autoFocus />
            </label>
          )}
          <label>
            {t.email} <span className="req">*</span>
            <input
              type="email"
              dir="ltr"
              value={form.email}
              onChange={update('email')}
              autoComplete="email"
              autoFocus={!isRegister}
            />
          </label>
          <label>
            {t.password} <span className="req">*</span>
            <input
              type="password"
              dir="ltr"
              value={form.password}
              onChange={update('password')}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {isRegister && <span className="hint">{t.passwordHint}</span>}
          </label>
          {error && <div className="alert error">{error}</div>}
          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? t.pleaseWait : isRegister ? t.registerAction : t.loginAction}
          </button>
        </form>
        <p className="auth-switch">
          {isRegister ? t.haveAccount : t.noAccount}{' '}
          <button type="button" className="link-btn" onClick={switchMode}>
            {isRegister ? t.loginAction : t.registerAction}
          </button>
        </p>
      </div>
    </div>
  )
}
