import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { useAuth } from '../auth.jsx'
import { DEAL_STAGES, formatAmount, formatDealDate, isOverdue } from '../deals.js'
import Modal from './Modal.jsx'
import DealForm from './DealForm.jsx'

const formatDate = (value, locale) =>
  value ? new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

// initialCustomer (from the Customers page) filters the list to one customer and preselects it for new deals.
export default function DealsPage({ onChat, initialCustomer = null }) {
  const { t, locale, lang } = useI18n()
  const { can } = useAuth()
  const seesAll = can('customers.view_all')
  const canDelete = can('deals.delete')
  const [deals, setDeals] = useState([])
  const [summary, setSummary] = useState(null)
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('')
  const [customer, setCustomer] = useState(initialCustomer)
  // customers.view_all only: owner filter ('' all, 'none' unassigned, or a user id) and possible owners.
  const [owner, setOwner] = useState('')
  const [owners, setOwners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | deal
  const [deleting, setDeleting] = useState(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async (title) => {
    setLoading(true)
    setError('')
    const filters = { customerId: customer?.customer_id, stage, title, salesUserId: seesAll ? owner : '' }
    try {
      const [list, totals] = await Promise.all([api.listDeals(filters), api.getDealSummary(filters)])
      setDeals(list)
      setSummary(totals)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [customer, stage, seesAll, owner])

  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search, load])

  useEffect(() => {
    if (!seesAll) return
    api.listCustomerOwners()
      .then(setOwners)
      .catch((err) => setError(err.message))
  }, [seesAll])

  function notify(message) {
    setToast(message)
    setTimeout(() => setToast(''), 2500)
  }

  async function handleSave(data) {
    if (editing === 'new') {
      await api.createDeal(data)
      notify(t.dealCreated)
    } else {
      await api.updateDeal(editing.deal_id, data)
      notify(t.dealUpdated)
    }
    setEditing(null)
    load(search.trim())
  }

  async function handleDelete() {
    try {
      await api.deleteDeal(deleting.deal_id)
      notify(t.dealDeleted)
      setDeleting(null)
      load(search.trim())
    } catch (err) {
      setError(err.message)
      setDeleting(null)
    }
  }

  const value = (n) => (loading || !summary ? '—' : n)
  const columns = 6 + (seesAll ? 1 : 0)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.dealsTitle}</h1>
          <p className="muted">{t.dealsSubtitle}</p>
        </div>
        <div className="header-actions">
          {onChat && <button className="btn ghost" onClick={() => onChat()}>{t.chatWithAgent}</button>}
          <button className="btn primary" onClick={() => setEditing('new')}>{t.addDeal}</button>
        </div>
      </header>

      <div className="stats">
        <div className="stat-card">
          <span className="stat-label">{t.openPipeline}</span>
          <span className="stat-value">{value(formatAmount(summary?.open_amount, lang))}</span>
          {!loading && summary && <span className="muted small">{t.openDealsCount(summary.open_count)}</span>}
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.wonDeals}</span>
          <span className="stat-value">{value(formatAmount(summary?.won_amount, lang))}</span>
          {!loading && summary && <span className="muted small">{t.wonDealsCount(summary.won_count)}</span>}
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.lostDeals}</span>
          <span className="stat-value">{value(summary?.lost_count)}</span>
          {!loading && summary && <span className="muted small">{t.lostDealsHint}</span>}
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <input
            className="search"
            placeholder={t.dealsSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t.stage}>
            <option value="">{t.allStages}</option>
            <option value="open">{t.openStages}</option>
            <option value="closed">{t.closedStages}</option>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>{t.stages[s]}</option>
            ))}
          </select>
          {seesAll && (
            <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t.colOwner}>
              <option value="">{t.allOwners}</option>
              <option value="none">{t.unassigned}</option>
              {owners.map((u) => (
                <option key={u.user_id} value={u.user_id}>{u.name}</option>
              ))}
            </select>
          )}
          <button className="btn ghost" onClick={() => load(search.trim())}>{t.refresh}</button>
        </div>

        {customer && (
          <div className="filter-bar">
            <span className="filter-chip">
              {t.filteredByCustomer(customer.name)}
              <button type="button" onClick={() => setCustomer(null)} aria-label={t.clearFilter} title={t.clearFilter}>×</button>
            </span>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.dealTitle}</th>
                <th>{t.colCustomer}</th>
                {seesAll && <th>{t.colOwner}</th>}
                <th>{t.amount}</th>
                <th>{t.stage}</th>
                <th>{t.expectedClose}</th>
                <th className="end">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns} className="empty">{t.loading}</td></tr>
              ) : deals.length === 0 ? (
                <tr><td colSpan={columns} className="empty">{t.noDeals}</td></tr>
              ) : (
                deals.map((d) => (
                  <tr key={d.deal_id}>
                    <td>
                      <div className="person-name">{d.title}</div>
                      <div className="muted small">#{d.deal_id} · {formatDate(d.created_at, locale)}</div>
                    </td>
                    <td>{d.customer_name}</td>
                    {seesAll && (
                      <td>{d.sales_user_name ?? <span className="tag muted">{t.unassigned}</span>}</td>
                    )}
                    <td className="amount"><bdi>{formatAmount(d.amount, lang)}</bdi></td>
                    <td><span className={`stage-badge stage-${d.stage}`}>{t.stages[d.stage]}</span></td>
                    <td className={isOverdue(d) ? 'overdue' : 'muted'} title={isOverdue(d) ? t.overdue : undefined}>
                      {formatDealDate(d.expected_close_date, locale)}
                    </td>
                    <td className="end">
                      {onChat && (
                        <button className="btn small primary-ghost" onClick={() => onChat(t.askAboutDealPrompt(d))}>{t.askAi}</button>
                      )}
                      <button className="btn small ghost" onClick={() => setEditing(d)}>{t.edit}</button>
                      {canDelete && (
                        <button className="btn small danger-ghost" onClick={() => setDeleting(d)}>{t.delete}</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? t.addDeal.replace('+ ', '') : t.editDeal} onClose={() => setEditing(null)}>
          <DealForm
            initial={editing === 'new' ? null : editing}
            customer={editing === 'new' ? customer : null}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={t.deleteDeal} onClose={() => setDeleting(null)}>
          <p>{t.deleteDealConfirm(deleting)}</p>
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
