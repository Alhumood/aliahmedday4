const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

let authToken = null
let unauthorizedHandler = null

export function setAuthToken(token) {
  authToken = token
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  // A rejected token means the session is over; login failures are handled by the form.
  if (res.status === 401 && authToken) unauthorizedHandler?.()
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// For file responses: returns { blob, filename }, with the name from Content-Disposition.
async function download(path, fallbackName) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
  if (res.status === 401 && authToken) unauthorizedHandler?.()
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  const match = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')
  return { blob: await res.blob(), filename: match ? match[1] : fallbackName }
}

// Starts a browser download of a blob.
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function dealQuery({ customerId, stage, title, salesUserId }) {
  const params = new URLSearchParams()
  if (customerId) params.set('customer_id', customerId)
  if (stage) params.set('stage', stage)
  if (title) params.set('title', title)
  if (salesUserId) params.set('sales_user_id', salesUserId)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const api = {
  baseUrl: BASE_URL,
  health: () => request('/api/health'),
  register: (body) => request('/api/auth/register', { method: 'POST', body }),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  me: () => request('/api/auth/me'),
  // salesUserId (customers.view_all only): a user id, 'none' for unassigned, or empty for all.
  listCustomers: (name, salesUserId) => {
    const params = new URLSearchParams()
    if (name) params.set('name', name)
    if (salesUserId) params.set('sales_user_id', salesUserId)
    const query = params.toString()
    return request(`/api/customers${query ? `?${query}` : ''}`)
  },
  // format: 'xlsx' | 'pdf'. Same filters as listCustomers; lang sets the file's language.
  exportCustomers: ({ format, name, salesUserId, lang }) => {
    const params = new URLSearchParams({ format, lang })
    if (name) params.set('name', name)
    if (salesUserId) params.set('sales_user_id', salesUserId)
    return download(`/api/customers/export?${params}`, `customers.${format}`)
  },
  createCustomer: (body) => request('/api/customers', { method: 'POST', body }),
  updateCustomer: (id, body) => request(`/api/customers/${id}`, { method: 'PUT', body }),
  deleteCustomer: (id) => request(`/api/customers/${id}`, { method: 'DELETE' }),
  listCustomerOwners: () => request('/api/customers/owners'),
  assignCustomers: (customerIds, salesUserId) =>
    request('/api/customers/assign', { method: 'POST', body: { customer_ids: customerIds, sales_user_id: salesUserId } }),
  // Deal filters: customerId, stage (a stage, 'open' or 'closed'), title, and salesUserId (customers.view_all only).
  listDeals: (filters = {}) => request(`/api/deals${dealQuery(filters)}`),
  getDealSummary: (filters = {}) => request(`/api/deals/summary${dealQuery(filters)}`),
  getDeal: (id) => request(`/api/deals/${id}`),
  createDeal: (body) => request('/api/deals', { method: 'POST', body }),
  updateDeal: (id, body) => request(`/api/deals/${id}`, { method: 'PUT', body }),
  deleteDeal: (id) => request(`/api/deals/${id}`, { method: 'DELETE' }),
  listUsers: () => request('/api/users'),
  setUserRole: (id, roleId) => request(`/api/users/${id}/role`, { method: 'PATCH', body: { role_id: roleId } }),
  createUser: (body) => request('/api/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PATCH', body }),
  // reassignTo: the id of a user who can own customers, or null to leave the deleted user's customers unassigned.
  deleteUser: (id, reassignTo) =>
    request(`/api/users/${id}`, { method: 'DELETE', body: { reassign_to: reassignTo } }),
  listRoles: () => request('/api/roles'),
  listPermissions: () => request('/api/roles/permissions'),
  createRole: (body) => request('/api/roles', { method: 'POST', body }),
  updateRole: (id, body) => request(`/api/roles/${id}`, { method: 'PATCH', body }),
  deleteRole: (id) => request(`/api/roles/${id}`, { method: 'DELETE' }),
  listArticles: (q) =>
    request(`/api/knowledge${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createArticle: (body) => request('/api/knowledge', { method: 'POST', body }),
  updateArticle: (id, body) => request(`/api/knowledge/${id}`, { method: 'PUT', body }),
  deleteArticle: (id) => request(`/api/knowledge/${id}`, { method: 'DELETE' }),
  chat: (message, conversationId) =>
    request('/api/agent/chat', { method: 'POST', body: { message, conversationId } }),
  resetChat: (conversationId) =>
    request(`/api/agent/chat/${conversationId}`, { method: 'DELETE' }),
}
