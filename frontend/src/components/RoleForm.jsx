import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

// initial is null when adding. permissions is the fixed list from the API ({ key, description }).
// The same rules as the backend are checked here so the admin gets the message before saving.
export default function RoleForm({ initial, permissions, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [name, setName] = useState(initial?.name ?? '')
  const [selected, setSelected] = useState(() => new Set(initial?.permissions ?? []))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle(key) {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError(t.nameRequired)
    if (!selected.has('customers.view_all') && !selected.has('customers.own')) return setError(t.roleNeedsCustomers)
    if (selected.has('customers.assign') && !selected.has('customers.view_all')) return setError(t.roleAssignNeedsViewAll)

    setSaving(true)
    setError('')
    try {
      await onSubmit({ name: name.trim(), permissions: permissions.map((p) => p.key).filter((key) => selected.has(key)) })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label>
        <span>{t.roleNameLabel} <span className="req">*</span></span>
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <fieldset className="permission-list">
        <legend>{t.rolePermissions}</legend>
        {permissions.map((p) => (
          <label key={p.key} className="permission-option">
            <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
            <span>
              <span className="permission-label">{t.permissions[p.key]?.label ?? p.key}</span>
              <span className="hint">{t.permissions[p.key]?.hint ?? p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? t.saving : initial ? t.saveChanges : t.createRole}
        </button>
      </div>
    </form>
  )
}
