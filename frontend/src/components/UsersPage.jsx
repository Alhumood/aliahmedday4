import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useI18n } from '../i18n.jsx'
import Modal from './Modal.jsx'
import UserForm from './UserForm.jsx'
import JobTitlesCard from './JobTitlesCard.jsx'

const formatDate = (value, locale) =>
  value ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')

export default function UsersPage({ onViewCustomers }) {
  const { t, locale } = useI18n()
  const { user: me, refresh } = useAuth()
  const [users, setUsers] = useState([])
  const [jobTitles, setJobTitles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(null) // user_id whose role is being changed
  const [editing, setEditing] = useState(null) // null | 'new' | user
  const [deleting, setDeleting] = useState(null)
  const [reassignTo, setReassignTo] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [toast, setToast] = useState('')

  // `loading` is only true until the first load finishes, so later refreshes keep the current rows
  // on screen instead of flashing "Loading…".
  const load = useCallback(async () => {
    setError('')
    try {
      const [userList, titleList] = await Promise.all([api.listUsers(), api.listJobTitles()])
      setUsers(userList)
      setJobTitles(titleList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function notify(message) {
    setToast(message)
    setTimeout(() => setToast(''), 2500)
  }

  async function changeRole(u, role) {
    setSaving(u.user_id)
    setError('')
    try {
      await api.setUserRole(u.user_id, role)
      notify(t.roleUpdated(u.name, t.roles[role]))
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(null)
    }
  }

  async function handleSave(body) {
    if (editing === 'new') {
      await api.createUser(body)
      notify(t.userCreated(body.name))
    } else {
      await api.updateUser(editing.user_id, body)
      notify(t.userUpdated(body.name ?? editing.name))
      if (editing.user_id === me.user_id) refresh()
    }
    setEditing(null)
    load()
  }

  function startDelete(u) {
    setDeleting(u)
    setReassignTo('')
    setDeleteError('')
  }

  async function handleDelete() {
    try {
      const result = await api.deleteUser(deleting.user_id, reassignTo ? Number(reassignTo) : null)
      notify(t.userDeleted(deleting.name, result.customers_moved))
      setDeleting(null)
      load()
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  const count = (role) => (loading ? '—' : users.filter((u) => u.role === role).length)
  const reassignTargets = deleting ? users.filter((u) => u.role === 'sales' && u.user_id !== deleting.user_id) : []

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.usersTitle}</h1>
          <p className="muted">{t.usersSubtitle}</p>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={load}>{t.refresh}</button>
          <button className="btn primary" onClick={() => setEditing('new')}>{t.addUser}</button>
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
                <th>{t.jobTitle}</th>
                <th>{t.colRole}</th>
                <th>{t.colCustomers}</th>
                <th>{t.colCreated}</th>
                <th className="end">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty">{t.loading}</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="empty">{t.noUsers}</td></tr>
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
                      <td>{u.job_title ?? <span className="muted">—</span>}</td>
                      <td>
                        <select
                          className="select"
                          value={u.role}
                          disabled={isMe || saving === u.user_id}
                          title={isMe ? t.cannotChangeOwnRole : undefined}
                          onChange={(e) => changeRole(u, e.target.value)}
                          aria-label={t.colRole}
                        >
                          <option value="sales">{t.roles.sales}</option>
                          <option value="admin">{t.roles.admin}</option>
                        </select>
                      </td>
                      <td>{u.role === 'sales' ? u.customer_count : <span className="muted">—</span>}</td>
                      <td className="muted">{formatDate(u.created_at, locale)}</td>
                      <td className="end nowrap">
                        {u.role === 'sales' && (
                          <button className="btn small primary-ghost" onClick={() => onViewCustomers(String(u.user_id))}>
                            {t.viewCustomers}
                          </button>
                        )}
                        <button className="btn small ghost" onClick={() => setEditing(u)}>{t.edit}</button>
                        {!isMe && (
                          <button className="btn small danger-ghost" onClick={() => startDelete(u)}>{t.delete}</button>
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

      {!loading && <JobTitlesCard jobTitles={jobTitles} onChanged={load} notify={notify} />}

      {editing && (
        <Modal title={editing === 'new' ? t.addUser.replace('+ ', '') : t.editUser} onClose={() => setEditing(null)}>
          <UserForm
            initial={editing === 'new' ? null : editing}
            jobTitles={jobTitles}
            isSelf={editing !== 'new' && editing.user_id === me.user_id}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={t.deleteUser} onClose={() => setDeleting(null)}>
          <div className="form">
            <p className="modal-text">{t.deleteUserConfirm(deleting.name)}</p>
            {deleting.customer_count > 0 && (
              <label>
                {t.moveCustomersTo(deleting.customer_count)}
                <select className="select" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">{t.unassigned}</option>
                  {reassignTargets.map((u) => (
                    <option key={u.user_id} value={u.user_id}>{u.name}</option>
                  ))}
                </select>
              </label>
            )}
            {deleteError && <div className="alert error">{deleteError}</div>}
            <div className="form-actions">
              <button className="btn ghost" onClick={() => setDeleting(null)}>{t.cancel}</button>
              <button className="btn danger" onClick={handleDelete}>{t.delete}</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
