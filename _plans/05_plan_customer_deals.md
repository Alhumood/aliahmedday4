# Plan 05: Customer Deals

**Spec:** [`_specs/05_spec_customer_deals.md`](../_specs/05_spec_customer_deals.md) (approved 2026-10-29, defaults from section 10)
**Status:** Approved (2026-10-29)

## 0. Before starting

- Commit the spec and this plan, so the branch is clean before implementation (`CLAUDE.md` workflow rule).
- No new dependencies and no new env vars.
- The app currency is a constant: `APP_CURRENCY = "INR"` (backend `src/deals.js`, frontend `src/deals.js`).

## 1. Backend: stages and permission

1. **New `backend/src/deals.js`** (constants only, shared by routes, db and agent):
   - `DEAL_STAGES = ["lead", "qualified", "proposal", "won", "lost"]`, `CLOSED_STAGES = ["won", "lost"]`, `OPEN_STAGES` (the other three).
   - `APP_CURRENCY = "INR"`.
2. **`src/permissions.js`:** add `{ key: "deals.delete", description: "Delete the deals they can see." }` to `PERMISSIONS` (after `customers.export`), and add `deals.delete` to `SYSTEM_ROLES.sales.permissions`. Admin gets it through the existing `PERMISSION_KEYS` filter.
   - These only seed **new** databases. Existing Admin/Sales rows get it in the deal migration (section 2).

## 2. Backend: data layer (`src/db.js`)

1. **`ensureDealSchema()`**, lazy and memoised like `ensureAuthSchema()` (awaits it first, resets on error). One query:
   - A `DO $$` block that, **only if `to_regclass('deal') IS NULL`** (first run), appends `deals.delete` to the roles with `system_key IN ('admin', 'sales')` that don't have it. Doing it only on the first run means an admin who later removes it from Sales isn't overridden on the next start.
   - `CREATE TABLE IF NOT EXISTS deal (...)` exactly as spec 4.1, with `CHECK (amount >= 0)`, `CHECK (stage IN (...))` built from `DEAL_STAGES`, and `customer_id ... ON DELETE CASCADE`.
   - `CREATE INDEX IF NOT EXISTS deal_customer_id_idx ON deal (customer_id)`.
2. **`dealSelect(user, source)`**, like `customerSelect()`:
   `SELECT d.deal_id, d.customer_id, c.name AS customer_name, d.title, d.amount::float8 AS amount, d.stage, to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date, d.closed_at, d.created_by, d.created_at, d.updated_at` plus `, c.sales_user_id, u.name AS sales_user_name` with `customers.view_all`, `FROM ${source} d JOIN customer c ON c.customer_id = d.customer_id LEFT JOIN app_user u ON u.user_id = c.sales_user_id`.
   - The date is returned as a string so it never shifts by time zone.
3. **`dealFilters(user, params, filters)`** builds the `WHERE` list: always `ownerScope(user, params, salesUserId)` (reused as is, it already uses the `c` alias), plus `customer_id`, `stage` (a key, `open` → `d.stage = ANY(OPEN_STAGES)`, `closed` → `CLOSED_STAGES`), and `title ILIKE`.
4. Functions (each awaits `ensureDealSchema()` and takes `user` first):
   - `listDeals(user, filters)`: `ORDER BY d.created_at DESC, d.deal_id DESC`.
   - `getDealById(user, id)`: `null` when not visible.
   - `dealSummary(user, filters)`: one `GROUP BY d.stage` query, totals built in JS into `{ open_count, open_amount, won_count, won_amount, lost_count, by_stage }` (all five stages present, zeros included).
   - `createDeal(user, { customerId, title, amount, stage = "lead", expectedCloseDate = null })`: `INSERT ... SELECT ... FROM customer c WHERE c.customer_id = $1 AND <ownerScope>` so a customer the user can't see inserts nothing → returns `null` (route → `404 Customer not found`). `closed_at = CASE WHEN stage IN closed THEN now() END`, `created_by = user.user_id`. Wrapped in `WITH changed AS (...) ${dealSelect(user, "changed")}`.
   - `updateDeal(user, id, fields)`: only the fields present (like `updateUser()`), so `expected_close_date: null` can clear the date. `updated_at = now()`. `closed_at`: set to `now()` when the stage changes from open to closed, `NULL` when it changes to open, unchanged otherwise (`CASE` on old vs new stage). The `WHERE` checks the deal is visible (`d.customer_id IN (SELECT c.customer_id FROM customer c WHERE <ownerScope>)`); if `customer_id` changes, the new customer must pass the same check (checked first with `getCustomerById`; route → `404 Customer not found`).
   - `deleteDeal(user, id)`: same visibility check, returns the deleted deal or `null`.
5. **Customer counts:** `listCustomers()` also awaits `ensureDealSchema()` and adds `deals_count` and `open_deals_count` via a `LEFT JOIN (SELECT customer_id, count(*) ..., count(*) FILTER (WHERE stage = ANY(...)) ... FROM deal GROUP BY customer_id)`. Only `listCustomers` changes; `customerSelect()` stays as is, so the other customer functions are untouched. The export ignores the extra fields (`columnsFor` picks columns explicitly).

## 3. Backend: routes (new `src/routes/deals.js`, mounted in `app.js`)

- `app.use("/api/deals", requireAuth, dealRoutes)`.
- Helpers: `parseId` (copied pattern from `customers.js`), `listFilters(req)` (`customer_id` positive int, `stage` in `DEAL_STAGES` or `open`/`closed`, `title`, and view_all-only `sales_user_id` parsed exactly like customers; bad values → `400`), and `readDeal(body, { partial })` that validates and maps to camelCase:
  - `title`: string, trimmed, 1–200 chars.
  - `amount`: finite number `>= 0`, at most 2 decimals (`Math.round(amount * 100) === amount * 100` with a small epsilon), at most `999999999999.99`.
  - `stage`: in `DEAL_STAGES`.
  - `expected_close_date`: `null` or `YYYY-MM-DD` that is a real date.
  - `customer_id`: positive int.
  - Create requires `customer_id`, `title`, `amount`. Unknown body fields are ignored.
- Order: `GET /`, `GET /summary`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` (with `requirePermission("deals.delete")`). `null` from db → `404`. Errors through `next(err)`.
- `@openapi` blocks on each route under the **Deals** tag.

## 4. Backend: Swagger (`src/swagger.js`)

- Add the **Deals** tag, a `Deal` schema (fields from spec 4.3; `stage` enum; `sales_user_id`/`sales_user_name` noted as view_all only), `DealInput` (create/update body), `DealSummary`, and the `Forbidden` response on DELETE.
- `Customer` schema: add `deals_count` and `open_deals_count` (list only).

## 5. Backend: AI agent (`src/agent.js`)

- Tools:
  - `search_deals`: optional `customer_id`, `stage` (enum stages + `open`/`closed`), `title`.
  - `add_deal`: `customer_id`, `title`, `amount` required; `stage`, `expected_close_date` optional.
  - `update_deal`: `deal_id` required; `customer_id`, `title`, `amount`, `stage`, `expected_close_date` optional.
  - No owner field, no delete tool.
- `executeTool` cases reuse the same validation as the route: move `readDeal` and the filter checks into `src/deals.js` (plain functions that throw `400` errors) so the route and the agent share them. Not-found returns `{ error: "Deal not found" }` / `{ error: "Customer not found" }` like the customer tools.
- `systemPrompt(user)`: one paragraph on deals: stage keys and their order, amounts are in INR (show as ₹ with Indian grouping), list deals as Markdown tables, deleting deals is only possible in the app.

## 6. Frontend

1. **New `frontend/src/deals.js`:** `DEAL_STAGES`, `isClosed(stage)`, `APP_CURRENCY`, `formatAmount(amount, lang)` (`Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en-IN', { style: 'currency', currency: APP_CURRENCY })`), `isOverdue(deal)` (open and `expected_close_date` before today's local date).
2. **`api.js`:** `listDeals({ customerId, stage, title, salesUserId })`, `getDealSummary(filters)`, `getDeal(id)`, `createDeal(body)`, `updateDeal(id, body)`, `deleteDeal(id)`, building the query like `listCustomers`.
3. **`App.jsx`:**
   - Nav item `{ id: 'deals', labelKey: 'navDeals', icon: '💼' }` after Customers (no permission).
   - `dealCustomer` state + `openDeals(customer)` (sets it and switches page), passed to `CustomersPage` as `onViewDeals`. Selecting Deals from the nav clears it.
   - `<DealsPage key={dealCustomer?.customer_id ?? 'all'} initialCustomer={dealCustomer} onChat={chat} />`.
4. **New `components/DealsPage.jsx`** (structure and classes copied from `CustomersPage`):
   - Toolbar: title search, stage `<select>` (all / open / closed / each stage), owner `<select>` (view_all only, from `api.listCustomerOwners()`, with "Unassigned"), a removable customer chip when filtered by customer, **New deal**, Refresh.
   - Table: title, customer, amount (`formatAmount`), stage badge (`.stage-badge.stage-<key>`), expected close (`.overdue` when overdue), owner (view_all only), created. Row actions: Edit, Delete (`can('deals.delete')`, confirm modal), Ask AI (`onChat(t.askAboutDealPrompt(d))`, only when `onChat`).
   - Empty state and errors like the Customers page.
5. **New `components/DealForm.jsx`:** customer select (`api.listCustomers()`, preselected/locked to `initialCustomer` when creating from a customer), title, amount (`type="number" min="0" step="0.01"`), stage select, expected close date (`type="date"`, clearable). On edit, only changed fields are sent; an emptied date is sent as `null`.
6. **`CustomersPage.jsx`:**
   - New **Open deals** column (`open_deals_count`), and a **Deals** row action → `onViewDeals(c)`.
   - Delete modal: when `deals_count > 0`, add `t.deleteCustomerDeals(n)` ("This also deletes its N deals.").
7. **`DashboardPage.jsx`:** load `api.getDealSummary()` alongside customers; three more `stat-card`s: Open pipeline (`open_count` + `formatAmount(open_amount)`), Won (`won_count` + amount), Lost (`lost_count`). Clicking one opens the Deals page (`onNavigate('deals')`).
8. **`i18n.jsx`** (both `en` and `ar`): `navDeals`, `deals`, `newDeal`, `editDeal`, `deleteDeal`, `deleteDealConfirm(d)`, `dealTitle`, `amount`, `stage`, `expectedClose`, `customer`, `allStages`, `openStages`, `closedStages`, `stages: { lead, qualified, proposal, won, lost }`, `noDeals`, `openDeals`, `viewDeals`, `deleteCustomerDeals(n)`, `askAboutDealPrompt(d)`, `dashOpenPipeline`, `dashWon`, `dashLost`, validation messages, and `permissions['deals.delete']` label/hint for `RoleForm`.
9. **`index.css`:** `.stage-badge` with one colour per stage (Lead grey, Qualified blue, Proposal amber, Won green, Lost red), `.overdue`, and the customer chip. Check RTL.

## 7. Docs

- **`README.md`:** the Deals endpoints and feature.
- **`CLAUDE.md`:** the `deal` table and `ensureDealSchema()` (incl. the one-time `deals.delete` grant), that deal access goes through `ownerScope()` via the customer join, `src/deals.js` shared validation, the new agent tools (still no delete), `DealsPage`/`DealForm`, the `deals.delete` permission, and the spec link.

## 8. Verification

No test suite, so verify by hand against spec section 9, with temporary test users and customers that are removed afterwards. **Your own account and data are not touched.**

1. **Migration:** after the first start, `deal` exists, and the Admin and Sales roles include `deals.delete`. Remove it from Sales, restart: it stays removed.
2. **curl as temporary sales user A:** the Sunrise Hospital scenario (create, stage through to Won and check `closed_at`, back to Proposal clears it), a second deal on the same customer, filters (`customer_id`, `stage=open`, `title`), summary numbers, validation `400`s (empty title, negative amount, 3 decimals, unknown stage, `2026-02-30`).
3. **As sales user B:** `GET/PUT/DELETE` on A's deal → `404`; `POST` on A's customer → `404`; `sales_user_id` filter ignored.
4. **As a temporary admin:** sees all deals with owner fields, owner filter and `none` work, summary covers everything. Reassign the customer to B: B now sees the deals. Role without `deals.delete` → `403` on DELETE.
5. **Customer delete:** deleting the test customer removes its deals.
6. **Agent:** ask it to list, add and move a deal's stage; ask it to delete one and check it can't.
7. **Swagger UI:** every Deals endpoint with Authorize.
8. **Frontend:** `npm run lint` and `npm run build` pass. In Chrome, run through the Deals page, form, customer Deals action and count, delete warning, dashboard cards, and Arabic/RTL with amount formatting, as sales user and admin. **Before testing in Chrome, check whether you're logged in there, and ask before logging you out.**

## 9. Files changed

- New: `backend/src/deals.js`, `backend/src/routes/deals.js`, `frontend/src/deals.js`, `frontend/src/components/DealsPage.jsx`, `frontend/src/components/DealForm.jsx`, this plan.
- Changed: `backend/src/permissions.js`, `backend/src/db.js`, `backend/src/app.js`, `backend/src/swagger.js`, `backend/src/agent.js`, `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/components/CustomersPage.jsx`, `frontend/src/components/DashboardPage.jsx`, `frontend/src/i18n.jsx`, `frontend/src/index.css`, `README.md`, `CLAUDE.md`.

## 10. Risks / notes

- **`ON DELETE CASCADE`:** deleting a customer now silently removes deals at the database level too (also for any direct SQL). That's the approved behaviour (Q3); the UI warns first.
- **Existing roles:** custom (non-built-in) roles don't get `deals.delete` automatically; admins grant it in the Roles card if wanted.
- **`NUMERIC` → number:** amounts are cast to `float8` for JSON. Exact to the paisa for values up to about ₹10¹³, far above realistic deal sizes.
- **Older deployments** on the same database are unaffected: they ignore the new table, and the extra `deals.delete` permission key is harmless to them.
