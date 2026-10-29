import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'

const MONTHS = 6

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')

// Counts of customers created in each of the last MONTHS calendar months, oldest first.
function monthlyCounts(customers, locale) {
  const now = new Date()
  const months = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1)
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString(locale, { month: 'short' }),
      full: d.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
      count: 0,
    }
  })
  const byKey = Object.fromEntries(months.map((m) => [m.key, m]))
  for (const c of customers) {
    if (!c.created_at) continue
    const d = new Date(c.created_at)
    const month = byKey[`${d.getFullYear()}-${d.getMonth()}`]
    if (month) month.count += 1
  }
  return months
}

function MonthlyChart({ data }) {
  const { t } = useI18n()
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...data.map((m) => m.count))

  return (
    <div className="bar-chart" role="img" aria-label={t.dashGrowthTitle}>
      <div className="bar-plot">
        {data.map((m, i) => (
          <div
            key={m.key}
            className="bar-slot"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && (
              <div className="chart-tip" style={{ bottom: `calc(${(m.count / max) * 100}% + 24px)` }}>
                <strong>{m.count}</strong> {t.dashNewCustomers}
                <div className="muted small">{m.full}</div>
              </div>
            )}
            {m.count > 0 && <span className="bar-value">{m.count}</span>}
            <div className={`bar ${hover === i ? 'hover' : ''}`} style={{ height: `${(m.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bar-axis">
        {data.map((m) => <span key={m.key}>{m.label}</span>)}
      </div>
    </div>
  )
}

function CompletenessRow({ label, count, total }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  return (
    <div className="meter-row">
      <div className="meter-head">
        <span>{label}</span>
        <span className="muted">{count} / {total} · {pct}%</span>
      </div>
      <div className="meter" title={`${pct}%`}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function DashboardPage({ onNavigate, onChat }) {
  const { t, locale } = useI18n()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCustomers(await api.listCustomers())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const total = customers.length
  const withEmail = customers.filter((c) => c.email).length
  const withPhone = customers.filter((c) => c.phone).length
  const complete = customers.filter((c) => c.email && c.phone).length
  const monthly = monthlyCounts(customers, locale)
  const thisMonth = monthly[monthly.length - 1].count
  const lastMonth = monthly[monthly.length - 2].count
  const recent = [...customers]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5)

  const value = (n) => (loading ? '—' : n)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t.dashTitle}</h1>
          <p className="muted">{t.dashSubtitle}</p>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={load}>{t.refresh}</button>
          <button className="btn primary" onClick={() => onChat()}>{t.chatWithAgent}</button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="stats">
        <div className="stat-card">
          <span className="stat-label">{t.totalCustomers}</span>
          <span className="stat-value">{value(total)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.dashThisMonth}</span>
          <span className="stat-value">{value(thisMonth)}</span>
          {!loading && <span className="muted small">{t.dashLastMonth(lastMonth)}</span>}
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.dashComplete}</span>
          <span className="stat-value">{value(complete)}</span>
          {!loading && <span className="muted small">{t.dashCompleteHint}</span>}
        </div>
        <div className="stat-card">
          <span className="stat-label">{t.dashMissing}</span>
          <span className="stat-value">{value(total - complete)}</span>
          {!loading && <span className="muted small">{t.dashMissingHint}</span>}
        </div>
      </div>

      <div className="dash-grid">
        <section className="card dash-card">
          <h2 className="card-title">{t.dashGrowthTitle}</h2>
          <p className="muted small">{t.dashGrowthSubtitle}</p>
          {loading ? <div className="empty">{t.loading}</div> : <MonthlyChart data={monthly} />}
        </section>

        <section className="card dash-card">
          <h2 className="card-title">{t.dashContactTitle}</h2>
          <p className="muted small">{t.dashContactSubtitle}</p>
          {loading ? (
            <div className="empty">{t.loading}</div>
          ) : (
            <div className="meters">
              <CompletenessRow label={t.withEmail} count={withEmail} total={total} />
              <CompletenessRow label={t.withPhone} count={withPhone} total={total} />
              <CompletenessRow label={t.dashComplete} count={complete} total={total} />
            </div>
          )}
        </section>

        <section className="card dash-card dash-wide">
          <div className="card-title-row">
            <h2 className="card-title">{t.dashRecentTitle}</h2>
            <button className="btn small ghost" onClick={() => onNavigate('customers')}>{t.dashViewAll}</button>
          </div>
          {loading ? (
            <div className="empty">{t.loading}</div>
          ) : recent.length === 0 ? (
            <div className="empty">{t.noCustomers}</div>
          ) : (
            <ul className="recent-list">
              {recent.map((c) => (
                <li key={c.customer_id}>
                  <div className="person">
                    <span className="avatar">{initials(c.name)}</span>
                    <div>
                      <div className="person-name">{c.name}</div>
                      <div className="muted small">{c.email ? <bdi>{c.email}</bdi> : t.noEmail}</div>
                    </div>
                  </div>
                  <button className="btn small primary-ghost" onClick={() => onChat(t.askAboutPrompt(c))}>{t.askAi}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
