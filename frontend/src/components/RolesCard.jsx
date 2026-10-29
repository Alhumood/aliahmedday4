import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { roleName, useI18n } from '../i18n.jsx'
import Modal from './Modal.jsx'
import RoleForm from './RoleForm.jsx'

// Roles with their permissions, plus add, edit and delete. onChanged reloads the parent's users and roles.
// The built-in Admin role is locked, and built-in roles can't be deleted.
export default function RolesCard({ roles, onChanged, notify }) {
  const { t } = useI18n()
  const [permissions, setPermissions] = useState([])
  const [editing, setEditing] = useState(null) // null | 'new' | role
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listPermissions().then(setPermissions).catch((err) => setError(err.message))
  }, [])

  async function handleSave(body) {
    if (editing === 'new') {
      await api.createRole(body)
      notify(t.roleCreated(body.name))
    } else {
      await api.updateRole(editing.role_id, body)
      notify(t.roleSaved(body.name))
    }
    setEditing(null)
    onChanged()
  }

  async function handleDelete() {
    const role = deleting
    setDeleting(null)
    setError('')
    try {
      await api.deleteRole(role.role_id)
      notify(t.roleDeleted(role.name))
      await onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="card roles">
      <div className="roles-header">
        <div>
          <h2 className="card-title">{t.rolesTitle}</h2>
          <p className="muted small">{t.rolesHint}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')} disabled={permissions.length === 0}>
          {t.addRole}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <ul className="role-list">
        {roles.map((r) => {
          const locked = r.system_key === 'admin'
          return (
            <li key={r.role_id} className="role-row">
              <div className="role-main">
                <div className="role-title">
                  <span className="role-name">{roleName(t, r.name, r.system_key)}</span>
                  {r.system_key && <span className="tag">{t.roleBuiltIn}</span>}
                  <span className="muted small">{t.userCount(r.user_count)}</span>
                </div>
                <div className="permission-tags">
                  {r.permissions.length === 0 ? (
                    <span className="muted small">{t.noPermissions}</span>
                  ) : (
                    r.permissions.map((key) => (
                      <span key={key} className="tag permission-tag">{t.permissions[key]?.label ?? key}</span>
                    ))
                  )}
                </div>
              </div>
              <span className="role-actions">
                <button
                  className="btn small ghost"
                  disabled={locked || permissions.length === 0}
                  title={locked ? t.roleLocked : undefined}
                  onClick={() => setEditing(r)}
                >
                  {t.edit}
                </button>
                {!r.system_key && (
                  <button
                    className="btn small danger-ghost"
                    disabled={r.user_count > 0}
                    title={r.user_count > 0 ? t.roleInUse : undefined}
                    onClick={() => setDeleting(r)}
                  >
                    {t.delete}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {editing && (
        <Modal title={editing === 'new' ? t.addRole.replace('+ ', '') : t.editRole} onClose={() => setEditing(null)}>
          <RoleForm
            initial={editing === 'new' ? null : editing}
            permissions={permissions}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {deleting && (
        <Modal title={t.deleteRole} onClose={() => setDeleting(null)}>
          <p>{t.deleteRoleConfirm(deleting.name)}</p>
          <div className="form-actions">
            <button className="btn ghost" onClick={() => setDeleting(null)}>{t.cancel}</button>
            <button className="btn danger" onClick={handleDelete}>{t.delete}</button>
          </div>
        </Modal>
      )}
    </section>
  )
}
