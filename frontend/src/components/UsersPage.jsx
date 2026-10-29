import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'

const formatDate = (value, locale) =>
  value ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')

export default function UsersPage({ onViewCustomers }) {
  const { t, locale } = useI18n()
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null) // user_id whose role is being changed
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await api.listUsers())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function changeRole(u, role) {
    setSaving(u.user_id)
    setError('')
    try {
      await api.setUserRole(u.user_id, role)
      setToast(t.roleUpdated(u.name, t.roles[role]))
      setTimeout(() => setToast(''), 2500)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(null)
    }
  }

  const count = (role) => (loading ? '—' : users.filter((u) => u.role === role).length)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.usersTitle}</h1>
          <p className="muted">{t.usersSubtitle}</p>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={load}>{t.refresh}</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat-card">
          <span className="stat-label">{t.totalUsers}</span>
          <span className="stat-value">{loading ? '—' : users.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.salesUsers}</span>
          <span className="stat-value">{count('sales')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.adminUsers}</span>
          <span className="stat-value">{count('admin')}</span>
        </div>
      </div>

      <div className="card">
        {error && <div className="alert error">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.colUser}</th>
                <th>{t.colRole}</th>
                <th>{t.colCustomers}</th>
                <th>{t.colCreated}</th>
                <th className="end">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">{t.loading}</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="empty">{t.noUsers}</td></tr>
              ) : (
                users.map((u) => {
                  const isMe = u.user_id === me.user_id
                  return (
                    <tr key={u.user_id}>
                      <td>
                        <div className="person">
                          <span className="avatar">{initials(u.name)}</span>
                          <div>
                            <div className="person-name">
                              {u.name} {isMe && <span className="muted small">({t.youTag})</span>}
                            </div>
                            <div className="muted small"><bdi>{u.email}</bdi></div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          className="select"
                          value={u.role}
                          disabled={isMe || saving === u.user_id}
                          title={isMe ? t.cannotChangeOwnRole : undefined}
                          onChange={(e) => changeRole(u, e.target.value)}
                        >
                          <option value="sales">{t.roles.sales}</option>
                          <option value="admin">{t.roles.admin}</option>
                        </select>
                      </td>
                      <td>{u.role === 'sales' ? u.customer_count : <span className="muted">—</span>}</td>
                      <td className="muted">{formatDate(u.created_at, locale)}</td>
                      <td className="end">
                        {u.role === 'sales' && (
                          <button className="btn small ghost" onClick={() => onViewCustomers(String(u.user_id))}>
                            {t.viewCustomers}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
