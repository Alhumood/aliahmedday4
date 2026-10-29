import { useState } from 'react'
import { roleName, useI18n } from '../i18n.jsx'

// initial is null when adding; when editing, only changed fields are submitted
// and an empty password keeps the current one.
export default function UserForm({ initial, roles, isSelf, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    password: '',
    // New users default to the built-in Sales role.
    roleId: String(initial?.role_id ?? roles.find((r) => r.system_key === 'sales')?.role_id ?? ''),
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
      role_id: Number(form.roleId),
    }
    let body = values
    if (initial) {
      body = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => value !== (initial[key] ?? null)),
      )
      if (isSelf) delete body.role_id
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
        <select className="select" value={form.roleId} onChange={update('roleId')} disabled={isSelf}>
          {roles.map((r) => (
            <option key={r.role_id} value={r.role_id}>{roleName(t, r.name, r.system_key)}</option>
          ))}
        </select>
        {isSelf && <span className="hint">{t.cannotChangeOwnRole}</span>}
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
