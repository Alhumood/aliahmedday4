import { useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import Modal from './Modal.jsx'

// Admin list of job titles with add, inline rename and delete. onChanged reloads the parent's data.
export default function JobTitlesCard({ jobTitles, onChanged, notify }) {
  const { t } = useI18n()
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(null) // { id, name }
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action, message) {
    setBusy(true)
    setError('')
    try {
      await action()
      notify(message)
      await onChanged()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (await run(() => api.createJobTitle(name), t.jobTitleAdded(name))) setNewName('')
  }

  async function handleRename(e) {
    e.preventDefault()
    const name = renaming.name.trim()
    if (!name) return
    if (await run(() => api.renameJobTitle(renaming.id, name), t.jobTitleRenamed(name))) setRenaming(null)
  }

  async function handleDelete() {
    const title = deleting
    setDeleting(null)
    await run(() => api.deleteJobTitle(title.job_title_id), t.jobTitleDeleted(title.name))
  }

  return (
    <section className="card job-titles">
      <div className="job-titles-header">
        <div>
          <h2 className="card-title">{t.jobTitles}</h2>
          <p className="muted small">{t.jobTitlesHint}</p>
        </div>
        <form className="job-title-add" onSubmit={handleAdd}>
          <input
            className="search"
            placeholder={t.newJobTitlePlaceholder}
            value={newName}
            maxLength={100}
            onChange={(e) => setNewName(e.target.value)}
            aria-label={t.newJobTitlePlaceholder}
          />
          <button type="submit" className="btn primary" disabled={busy || !newName.trim()}>{t.add}</button>
        </form>
      </div>

      {error && <div className="alert error">{error}</div>}

      {jobTitles.length === 0 ? (
        <div className="empty">{t.noJobTitles}</div>
      ) : (
        <ul className="job-title-list">
          {jobTitles.map((jt) => (
            <li key={jt.job_title_id} className="job-title-row">
              {renaming?.id === jt.job_title_id ? (
                <form className="job-title-rename" onSubmit={handleRename}>
                  <input
                    className="search"
                    value={renaming.name}
                    maxLength={100}
                    autoFocus
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    aria-label={t.rename}
                  />
                  <button type="submit" className="btn small primary" disabled={busy}>{t.save}</button>
                  <button type="button" className="btn small ghost" onClick={() => setRenaming(null)}>{t.cancel}</button>
                </form>
              ) : (
                <>
                  <span className="job-title-name">{jt.name}</span>
                  <span className="muted small">{t.userCount(jt.user_count)}</span>
                  <span className="job-title-actions">
                    <button
                      className="btn small ghost"
                      onClick={() => setRenaming({ id: jt.job_title_id, name: jt.name })}
                    >
                      {t.rename}
                    </button>
                    <button className="btn small danger-ghost" onClick={() => setDeleting(jt)}>{t.delete}</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <Modal title={t.deleteJobTitle} onClose={() => setDeleting(null)}>
          <p>{t.deleteJobTitleConfirm(deleting.name, deleting.user_count)}</p>
          <div className="form-actions">
            <button className="btn ghost" onClick={() => setDeleting(null)}>{t.cancel}</button>
            <button className="btn danger" onClick={handleDelete}>{t.delete}</button>
          </div>
        </Modal>
      )}
    </section>
  )
}
