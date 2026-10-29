import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Modal from './Modal.jsx'
import CustomerForm from './CustomerForm.jsx'

const formatDate = (value, locale) =>
  value ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')

export default function CustomersPage({ onChat }) {
  const { t, locale } = useI18n()
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | customer
  const [deleting, setDeleting] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async (name) => {
    setLoading(true)
    setError('')
    try {
      setCustomers(await api.listCustomers(name))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search, load])

  function notify(message) {
    setToast(message)
    setTimeout(() => setToast(''), 2500)
  }

  async function handleSave(data) {
    if (editing === 'new') {
      await api.createCustomer(data)
      notify(t.customerCreated)
    } else {
      await api.updateCustomer(editing.customer_id, data)
      notify(t.customerUpdated)
    }
    setEditing(null)
    load(search.trim())
  }

  async function handleDelete() {
    try {
      await api.deleteCustomer(deleting.customer_id)
      notify(t.customerDeleted)
      setDeleting(null)
      load(search.trim())
    } catch (err) {
      setError(err.message)
      setDeleting(null)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.customersTitle}</h1>
          <p className="muted">{t.customersSubtitle}</p>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={() => onChat()}>{t.chatWithAgent}</button>
          <button className="btn primary" onClick={() => setEditing('new')}>{t.addCustomer}</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat-card">
          <span className="stat-label">{search ? t.matchingCustomers : t.totalCustomers}</span>
          <span className="stat-value">{loading ? '—' : customers.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.withEmail}</span>
          <span className="stat-value">{loading ? '—' : customers.filter((c) => c.email).length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.withPhone}</span>
          <span className="stat-value">{loading ? '—' : customers.filter((c) => c.phone).length}</span>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn ghost" onClick={() => load(search.trim())}>{t.refresh}</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.colId}</th>
                <th>{t.colCustomer}</th>
                <th>{t.colPhone}</th>
                <th>{t.colCreated}</th>
                <th className="end">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">{t.loading}</td></tr>
              ) : customers.length === 0 ? (
                <tr><td colSpan={5} className="empty">{t.noCustomers}</td></tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.customer_id}>
                    <td className="muted">#{c.customer_id}</td>
                    <td>
                      <div className="person">
                        <span className="avatar">{initials(c.name)}</span>
                        <div>
                          <div className="person-name">{c.name}</div>
                          <div className="muted small">{c.email ? <bdi>{c.email}</bdi> : t.noEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td>{c.phone ? <bdi>{c.phone}</bdi> : <span className="muted">—</span>}</td>
                    <td className="muted">{formatDate(c.created_at, locale)}</td>
                    <td className="end">
                      <button className="btn small primary-ghost" onClick={() => onChat(t.askAboutPrompt(c))}>{t.askAi}</button>
                      <button className="btn small ghost" onClick={() => setEditing(c)}>{t.edit}</button>
                      <button className="btn small danger-ghost" onClick={() => setDeleting(c)}>{t.delete}</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? t.addCustomer.replace('+ ', '') : t.editCustomer} onClose={() => setEditing(null)}>
          <CustomerForm
            initial={editing === 'new' ? null : editing}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={t.deleteCustomer} onClose={() => setDeleting(null)}>
          <p>{t.deleteConfirm(deleting.name)}</p>
          <div className="form-actions">
            <button className="btn ghost" onClick={() => setDeleting(null)}>{t.cancel}</button>
            <button className="btn danger" onClick={handleDelete}>{t.delete}</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
