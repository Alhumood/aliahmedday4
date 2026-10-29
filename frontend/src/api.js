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

export const api = {
  baseUrl: BASE_URL,
  health: () => request('/api/health'),
  register: (body) => request('/api/auth/register', { method: 'POST', body }),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  me: () => request('/api/auth/me'),
  // salesUserId (admin only): a user id, 'none' for unassigned, or empty for all.
  listCustomers: (name, salesUserId) => {
    const params = new URLSearchParams()
    if (name) params.set('name', name)
    if (salesUserId) params.set('sales_user_id', salesUserId)
    const query = params.toString()
    return request(`/api/customers${query ? `?${query}` : ''}`)
  },
  createCustomer: (body) => request('/api/customers', { method: 'POST', body }),
  updateCustomer: (id, body) => request(`/api/customers/${id}`, { method: 'PUT', body }),
  deleteCustomer: (id) => request(`/api/customers/${id}`, { method: 'DELETE' }),
  assignCustomers: (customerIds, salesUserId) =>
    request('/api/customers/assign', { method: 'POST', body: { customer_ids: customerIds, sales_user_id: salesUserId } }),
  listUsers: () => request('/api/users'),
  setUserRole: (id, role) => request(`/api/users/${id}/role`, { method: 'PATCH', body: { role } }),
  createUser: (body) => request('/api/users', { method: 'POST', body }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PATCH', body }),
  // reassignTo: a sales user's id, or null to leave the deleted user's customers unassigned.
  deleteUser: (id, reassignTo) =>
    request(`/api/users/${id}`, { method: 'DELETE', body: { reassign_to: reassignTo } }),
  listJobTitles: () => request('/api/job-titles'),
  createJobTitle: (name) => request('/api/job-titles', { method: 'POST', body: { name } }),
  renameJobTitle: (id, name) => request(`/api/job-titles/${id}`, { method: 'PATCH', body: { name } }),
  deleteJobTitle: (id) => request(`/api/job-titles/${id}`, { method: 'DELETE' }),
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
