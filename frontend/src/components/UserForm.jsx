import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

// initial is null when adding; when editing, only changed fields are submitted
// and an empty password keeps the current one.
export default function UserForm({ initial, jobTitles, isSelf, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    role: initial?.role ?? 'sales',
    jobTitle: initial?.job_title_id ? String(initial.job_title_id) : '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError(t.nameRequired)
    if (!form.email.trim()) return setError(t.authFieldsRequired)
    if ((!initial || form.password) && form.password.length < 8) return setError(t.passwordTooShort)

    const values = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      job_title_id: form.jobTitle ? Number(form.jobTitle) : null,
    }
    let body = values
    if (initial) {
      body = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => value !== (initial[key] ?? null)),
      )
      if (isSelf) delete body.role
    }
    if (form.password) body.password = form.password

    setSaving(true)
    setError('')
    try {
      await onSubmit(body)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label>
        <span>{t.name} <span className="req">*</span></span>
        <input value={form.name} onChange={update('name')} autoComplete="off" autoFocus />
      </label>
      <label>
        <span>{t.email} <span className="req">*</span></span>
        <input type="email" dir="ltr" value={form.email} onChange={update('email')} autoComplete="off" />
      </label>
      <label>
        <span>{t.password} {!initial && <span className="req">*</span>}</span>
        <input
          type="password"
          dir="ltr"
          value={form.password}
          onChange={update('password')}
          autoComplete="new-password"
        />
        <span className="hint">{initial ? t.passwordKeepHint : t.passwordHint}</span>
      </label>
      <label>
        {t.colRole}
        <select className="select" value={form.role} onChange={update('role')} disabled={isSelf}>
          <option value="sales">{t.roles.sales}</option>
          <option value="admin">{t.roles.admin}</option>
        </select>
        {isSelf && <span className="hint">{t.cannotChangeOwnRole}</span>}
      </label>
      <label>
        {t.jobTitle}
        <select className="select" value={form.jobTitle} onChange={update('jobTitle')}>
          <option value="">{t.noJobTitle}</option>
          {jobTitles.map((jt) => (
            <option key={jt.job_title_id} value={jt.job_title_id}>{jt.name}</option>
          ))}
        </select>
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? t.saving : initial ? t.saveChanges : t.createUser}
        </button>
      </div>
    </form>
  )
}
