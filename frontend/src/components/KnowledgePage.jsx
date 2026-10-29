import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { useAuth } from '../auth.jsx'
import Modal from './Modal.jsx'
import ArticleForm from './ArticleForm.jsx'

const formatDate = (value, locale) =>
  value ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export default function KnowledgePage({ onChat }) {
  const { t, locale } = useI18n()
  const canManage = useAuth().can('knowledge.manage')
  const [articles, setArticles] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | article
  const [deleting, setDeleting] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async (q) => {
    setLoading(true)
    setError('')
    try {
      setArticles(await api.listArticles(q))
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
      await api.createArticle(data)
      notify(t.articleCreated)
    } else {
      await api.updateArticle(editing.article_id, data)
      notify(t.articleUpdated)
    }
    setEditing(null)
    load(search.trim())
  }

  async function handleDelete() {
    try {
      await api.deleteArticle(deleting.article_id)
      notify(t.articleDeleted)
      setDeleting(null)
      load(search.trim())
    } catch (err) {
      setError(err.message)
      setDeleting(null)
    }
  }

  const categories = [...new Set(articles.map((a) => a.category).filter(Boolean))].sort()
  const visible = category ? articles.filter((a) => a.category === category) : articles

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.knowledgeTitle}</h1>
          <p className="muted">{t.knowledgeSubtitle}</p>
        </div>
        <div className="header-actions">
          {onChat && <button className="btn ghost" onClick={() => onChat(t.knowledgeChatPrompt)}>{t.chatWithAgent}</button>}
          {canManage && <button className="btn primary" onClick={() => setEditing('new')}>{t.addArticle}</button>}
        </div>
      </header>

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder={t.knowledgeSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn ghost" onClick={() => load(search.trim())}>{t.refresh}</button>
        </div>

        {categories.length > 0 && (
          <div className="chips">
            <button className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>{t.allCategories}</button>
            {categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        {loading ? (
          <div className="empty">{t.loading}</div>
        ) : visible.length === 0 ? (
          <div className="empty">{search ? t.noArticlesMatch : t.noArticles}</div>
        ) : (
          <ul className="article-list">
            {visible.map((a) => {
              const open = expanded === a.article_id
              return (
                <li key={a.article_id} className="article">
                  <div className="article-head">
                    <button className="article-title" dir="auto" onClick={() => setExpanded(open ? null : a.article_id)}>
                      <span className="article-caret">{open ? '▾' : '▸'}</span> {a.title}
                    </button>
                    <div className="article-actions">
                      {onChat && (
                        <button className="btn small primary-ghost" onClick={() => onChat(t.askAboutArticle(a))}>{t.askAi}</button>
                      )}
                      {canManage && (
                        <>
                          <button className="btn small ghost" onClick={() => setEditing(a)}>{t.edit}</button>
                          <button className="btn small danger-ghost" onClick={() => setDeleting(a)}>{t.delete}</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="article-meta muted small">
                    {a.category && <span className="tag">{a.category}</span>}
                    {t.updatedOn(formatDate(a.updated_at, locale))}
                  </div>
                  <p className={`article-content ${open ? 'open' : ''}`} dir="auto">{a.content}</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {editing && (
        <Modal title={editing === 'new' ? t.addArticle.replace('+ ', '') : t.editArticle} onClose={() => setEditing(null)}>
          <ArticleForm
            initial={editing === 'new' ? null : editing}
            categories={categories}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={t.deleteArticle} onClose={() => setDeleting(null)}>
          <p>{t.deleteConfirm(deleting.title)}</p>
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
