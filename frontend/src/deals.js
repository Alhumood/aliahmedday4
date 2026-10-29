// Deal stages and amount formatting (spec 05). The stage list matches DEAL_STAGES in the backend.
export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost']
export const APP_CURRENCY = 'INR'

export const isClosed = (stage) => stage === 'won' || stage === 'lost'

// en-IN gives the Indian digit grouping (₹1,50,000); two decimals only show when there are paise.
export function formatAmount(amount, lang) {
  const value = amount ?? 0
  const decimals = Number.isInteger(value) ? 0 : 2
  return new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en-IN', {
    style: 'currency',
    currency: APP_CURRENCY,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

// Today's local date as YYYY-MM-DD, to compare with expected_close_date.
export function todayIso() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const isOverdue = (deal) =>
  !isClosed(deal.stage) && Boolean(deal.expected_close_date) && deal.expected_close_date < todayIso()

// expected_close_date is a plain date; format it without a time-zone shift.
export function formatDealDate(value, locale) {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}
