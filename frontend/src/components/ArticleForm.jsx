import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

export default function ArticleForm({ initial, categories, onSubmit, onCancel }) {
  const { t } = useI18n()
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    category: initial?.category ?? '',
    content: initial?.content ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError(t.titleRequired)
    if (!form.content.trim()) return setError(t.contentRequired)
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        title: form.title.trim(),
        category: form.category.trim() || null,
        content: form.content.trim(),
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label>
        <span>{t.articleTitle} <span className="req">*</span></span>
        <input dir="auto" value={form.title} onChange={update('title')} autoFocus placeholder={t.articleTitlePlaceholder} />
      </label>
      <label>
        {t.category}
        <input dir="auto" value={form.category} onChange={update('category')} list="kb-categories" placeholder={t.categoryPlaceholder} />
        <datalist id="kb-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </label>
      <label>
        <span>{t.content} <span className="req">*</span></span>
        <textarea dir="auto" rows={8} value={form.content} onChange={update('content')} placeholder={t.contentPlaceholder} />
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? t.saving : initial ? t.saveChanges : t.createArticle}
        </button>
      </div>
    </form>
  )
}
