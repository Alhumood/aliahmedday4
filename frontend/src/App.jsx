import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useI18n } from './i18n.jsx'
import CustomersPage from './components/CustomersPage.jsx'
import ChatPage from './components/ChatPage.jsx'

const NAV = [
  { id: 'customers', labelKey: 'navCustomers', icon: '👥' },
  { id: 'chat', labelKey: 'navChat', icon: '✨' },
]

export default function App() {
  const { t, toggle } = useI18n()
  const [page, setPage] = useState('customers')
  const [health, setHealth] = useState(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'down' }))
  }, [])

  const online = health?.status === 'ok'

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">C</span>
          <span>{t.appName}</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {t[item.labelKey]}
            </button>
          ))}
        </nav>
        <button className="lang-toggle" onClick={toggle}>🌐 {t.language}</button>
        <div className="sidebar-footer">
          <div className="status">
            <span className={`dot ${health ? (online ? 'ok' : 'err') : ''}`} />
            {health ? (online ? t.apiConnected : t.apiUnreachable) : t.apiChecking}
          </div>
          {online && !health.agent && <div className="status warn">{t.aiKeyMissing}</div>}
          <a href={`${api.baseUrl}/swagger`} target="_blank" rel="noreferrer" className="swagger-link">
            {t.openSwagger}
          </a>
        </div>
      </aside>
      <main className="content">
        {page === 'customers' ? <CustomersPage /> : <ChatPage />}
      </main>
    </div>
  )
}
