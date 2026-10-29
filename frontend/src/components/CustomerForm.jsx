import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

export default function CustomerForm({ initial, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError(t.nameRequired)
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label>
        <span>{t.name} <span className="req">*</span></span>
        <input value={form.name} onChange={update('name')} autoFocus placeholder="Jane Doe" />
      </label>
      <label>
        {t.email}
        <input type="email" dir="ltr" value={form.email} onChange={update('email')} placeholder="jane@example.com" />
      </label>
      <label>
        {t.phone}
        <input dir="ltr" value={form.phone} onChange={update('phone')} placeholder="0501234567" />
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? t.saving : initial ? t.saveChanges : t.createCustomer}
        </button>
      </div>
    </form>
  )
}
