import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { DEAL_STAGES } from '../deals.js'

// initial is the deal when editing, null when adding. customer preselects the customer of a new deal.
export default function DealForm({ initial, customer, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [customers, setCustomers] = useState(customer ? [customer] : [])
  const [form, setForm] = useState({
    customer_id: String(initial?.customer_id ?? customer?.customer_id ?? ''),
    title: initial?.title ?? '',
    amount: initial ? String(initial.amount) : '',
    stage: initial?.stage ?? 'lead',
    expected_close_date: initial?.expected_close_date ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listCustomers()
      .then(setCustomers)
      .catch((err) => setError(err.message))
  }, [])

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.customer_id) return setError(t.customerRequired)
    if (!form.title.trim()) return setError(t.titleRequired)
    const cents = amount * 100
    if (form.amount.trim() === '' || !Number.isFinite(amount) || amount < 0 || Math.abs(cents - Math.round(cents)) > 1e-6) {
      return setError(t.amountInvalid)
    }
    const data = {
      customer_id: Number(form.customer_id),
      title: form.title.trim(),
      amount,
      stage: form.stage,
      expected_close_date: form.expected_close_date || null,
    }
    // When editing, only send what changed (PUT is a partial update).
    const body = initial
      ? Object.fromEntries(Object.entries(data).filter(([key, value]) => value !== initial[key]))
      : data
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
        <span>{t.colCustomer} <span className="req">*</span></span>
        <select className="select" value={form.customer_id} onChange={update('customer_id')}>
          <option value="" disabled>{t.selectCustomer}</option>
          {customers.map((c) => (
            <option key={c.customer_id} value={c.customer_id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{t.dealTitle} <span className="req">*</span></span>
        <input value={form.title} onChange={update('title')} maxLength={200} autoFocus placeholder={t.dealTitlePlaceholder} />
      </label>
      <label>
        <span>{t.amount} (₹) <span className="req">*</span></span>
        <input type="number" dir="ltr" min="0" step="0.01" value={form.amount} onChange={update('amount')} placeholder="150000" />
      </label>
      <label>
        {t.stage}
        <select className="select" value={form.stage} onChange={update('stage')}>
          {DEAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>{t.stages[stage]}</option>
          ))}
        </select>
      </label>
      <label>
        {t.expectedClose}
        <input type="date" value={form.expected_close_date} onChange={update('expected_close_date')} />
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? t.saving : initial ? t.saveChanges : t.createDeal}
        </button>
      </div>
    </form>
  )
}
