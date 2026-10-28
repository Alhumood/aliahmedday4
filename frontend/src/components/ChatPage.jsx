import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api.js'
import { useI18n } from '../i18n.jsx'

export default function ChatPage() {
  const { t } = useI18n()
  // The welcome message (index 0) is rendered from the current language, so
  // it switches along with the rest of the UI.
  const [messages, setMessages] = useState([{ role: 'assistant', welcome: true }])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function send(text) {
    const message = text.trim()
    if (!message || sending) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: message }])
    setSending(true)
    try {
      const res = await api.chat(message, conversationId)
      setConversationId(res.conversationId)
      setMessages((m) => [...m, { role: 'assistant', text: res.reply, toolCalls: res.toolCalls }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.message, error: true }])
    } finally {
      setSending(false)
    }
  }

  function newChat() {
    if (conversationId) api.resetChat(conversationId).catch(() => {})
    setConversationId(null)
    setMessages([{ role: 'assistant', welcome: true }])
  }

  return (
    <div className="page chat-page">
      <header className="page-header">
        <div>
          <h1>{t.chatTitle}</h1>
          <p className="muted">{t.chatSubtitle}</p>
        </div>
        <button className="btn ghost" onClick={newChat}>{t.newChat}</button>
      </header>

      <div className="card chat-card">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
              <div className="msg-avatar">{m.role === 'user' ? t.you : t.ai}</div>
              <div className="msg-body">
                {m.toolCalls?.length > 0 && (
                  <div className="tool-calls">
                    {m.toolCalls.map((tool, j) => (
                      <span key={j} className="tool-chip" title={JSON.stringify(tool.input)}>⚙ {tool.name}</span>
                    ))}
                  </div>
                )}
                <div className="msg-bubble" dir="auto">
                  {m.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.welcome ? t.chatWelcome : m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="msg assistant">
              <div className="msg-avatar">{t.ai}</div>
              <div className="msg-bubble typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {messages.length === 1 && (
          <div className="suggestions">
            {t.suggestions.map((s) => (
              <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <input
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.chatPlaceholder}
            disabled={sending}
          />
          <button className="btn primary" disabled={sending || !input.trim()}>{t.send}</button>
        </form>
      </div>
    </div>
  )
}
