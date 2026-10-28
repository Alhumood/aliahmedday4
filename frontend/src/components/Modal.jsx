import { useI18n } from '../i18n.jsx'

export default function Modal({ title, onClose, children }) {
  const { t } = useI18n()
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t.close}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
