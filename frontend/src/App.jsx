import { useEffect, useState } from 'react'
import { api } from './api.js'
import { useI18n } from './i18n.jsx'
import { useAuth } from './auth.jsx'
import AuthPage from './components/AuthPage.jsx'
import CustomersPage from './components/CustomersPage.jsx'
import ChatPage from './components/ChatPage.jsx'
import DashboardPage from './components/DashboardPage.jsx'
import KnowledgePage from './components/KnowledgePage.jsx'

const NAV = [
  { id: 'dashboard', labelKey: 'navDashboard', icon: '📊' },
  { id: 'customers', labelKey: 'navCustomers', icon: '👥' },
  { id: 'knowledge', labelKey: 'navKnowledge', icon: '📚' },
  { id: 'chat', labelKey: 'navChat', icon: '✨' },
]

export default function App() {
  const { user } = useAuth()
  // Keying on the user remounts everything on login/logout, so no page or chat state carries over.
  return user ? <MainLayout key={user.user_id} /> : <AuthPage />
}

function MainLayout() {
  const { t, toggle } = useI18n()
  const { user, logout } = useAuth()
  const [page, setPage] = useState('dashboard')
  const [chatPrompt, setChatPrompt] = useState(null)
  const [health, setHealth] = useState(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'down' }))
  }, [])

  const online = health?.status === 'ok'

  function openChat(prompt = null) {
    setChatPrompt(prompt)
    setPage('chat')
  }

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
              onClick={() => {
                setChatPrompt(null)
                setPage(item.id)
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {t[item.labelKey]}
            </button>
          ))}
        </nav>
        <div className="user-block">
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <div className="user-info">
            <span className="user-name">{user.name}</span>
            <span className="user-role">{t.roles[user.role] ?? user.role}</span>
          </div>
          <button className="logout-btn" onClick={logout} title={t.logout}>{t.logout}</button>
        </div>
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
        {page === 'dashboard' && <DashboardPage onNavigate={setPage} onChat={openChat} />}
        {page === 'customers' && <CustomersPage onChat={openChat} />}
        {page === 'knowledge' && <KnowledgePage onChat={openChat} />}
        {page === 'chat' && <ChatPage initialPrompt={chatPrompt} />}
      </main>
    </div>
  )
}
