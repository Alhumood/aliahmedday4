# Spec 05: Customer Deals

**Status:** Approved (2026-10-29), with the defaults from section 10
**Date:** 2026-10-29
**Builds on:** [Spec 03: roles and permissions](03_spec_admin_user_crud_job_titles.md), [Spec 04: customer export](04_spec_customer_export_excel_pdf.md)

## 1. Background

The app stores customers, but not what we are trying to sell them. A **deal** is one specific sales opportunity with one customer.

Example: Sunrise Hospital wants 5,000 printed brochures. Priya, the customer's sales owner, creates a deal:

| Field | Value |
|---|---|
| Customer | Sunrise Hospital |
| Title | Brochure printing – Q4 |
| Amount | ₹1,50,000 |
| Stage | Lead → Qualified → Proposal → Won / Lost |
| Expected close date | 30 Nov |

One customer can have **many deals over time**: brochures this month, ID cards next month.

## 2. Goals

1. A user can add, view, edit and delete deals for the customers they can see.
2. A deal moves through the stages **Lead → Qualified → Proposal → Won / Lost**.
3. Each customer shows its deals, and a **Deals** page lists all deals the user can see, with filters.
4. **Access follows the customer.** A deal has no owner of its own: whoever can see the customer can see its deals. If the customer is reassigned, its deals go with it.
5. The dashboard shows simple pipeline numbers.
6. Everything works in English and Arabic and can be tested in Swagger.

## 3. Out of scope

- A drag-and-drop pipeline (Kanban) board.
- Products / line items, quantities, discounts or taxes on a deal.
- More than one currency, or currency conversion (see Q2).
- Probability / weighted forecasts.
- Activity history, notes timeline, tasks or reminders on a deal.
- Exporting deals to Excel or PDF.
- Custom stages (the five stages are fixed in code).
- A deal with no customer, or one deal shared by several customers.

## 4. Data model

### 4.1 New table `deal`

Created lazily on first use (`ensureDealTable()` in `db.js`), like the other tables.

| Column | Type | Notes |
|---|---|---|
| `deal_id` | `SERIAL PRIMARY KEY` | |
| `customer_id` | `INTEGER NOT NULL REFERENCES customer(customer_id) ON DELETE CASCADE` | See Q3 |
| `title` | `TEXT NOT NULL` | 1–200 characters, trimmed |
| `amount` | `NUMERIC(14,2) NOT NULL` | `>= 0` (CHECK) |
| `stage` | `TEXT NOT NULL DEFAULT 'lead'` | CHECK in `lead, qualified, proposal, won, lost` |
| `expected_close_date` | `DATE` | Optional |
| `closed_at` | `TIMESTAMPTZ` | Set when the stage becomes `won`/`lost`, cleared if it moves back to an open stage |
| `created_by` | `INTEGER REFERENCES app_user(user_id) ON DELETE SET NULL` | Who created it (information only, not used for access) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Index on `deal(customer_id)`.

### 4.2 Stages

| Key | English | Arabic | Open/closed |
|---|---|---|---|
| `lead` | Lead | عميل محتمل | open |
| `qualified` | Qualified | مؤهل | open |
| `proposal` | Proposal | عرض سعر | open |
| `won` | Won | مكسوبة | closed |
| `lost` | Lost | خاسرة | closed |

- Stages are stored as keys and translated in the UI. The list lives in one constant in the backend (`DEAL_STAGES`) and one in the frontend.
- **Any stage can be set at any time** (a deal can skip Qualified, or a Lost deal can be reopened). The arrows describe the usual order, not a rule.

### 4.3 Deal responses

Every deal response includes the deal columns plus `customer_name`, and with `customers.view_all` also `sales_user_id` and `sales_user_name` (the customer's owner). `amount` is returned as a number.

## 5. Access rules

- All deal queries join `customer` and use the existing **`ownerScope()`**. Without `customers.view_all` a user only reaches deals of customers they own. A deal of a customer the user can't see returns `404`.
- Creating a deal needs the target customer to be visible to the user (otherwise `404`).
- Moving a deal to a different customer is allowed on edit, with the same visibility check on the new customer.
- **View, add and edit:** every logged-in user, for the customers they can see (same as customers today).
- **Delete:** a new permission `deals.delete` (see Q1). Added to `PERMISSIONS`, to the built-in Admin role automatically (Admin has every permission except `customers.own`), and to the built-in Sales defaults.
- The `sales_user_id` filter is view_all-only and **ignored** without it, as for customers.

## 6. Backend

### 6.1 Endpoints (`src/routes/deals.js`, mounted behind `requireAuth` in `app.js`)

| Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|
| GET | `/api/deals` | query: `customer_id`, `stage` (one key, or `open` / `closed`), `title` (search), `sales_user_id` (view_all only; id or `none`) | `200` array, newest first | `400` bad filter, `401` |
| GET | `/api/deals/summary` | same filters as the list | `200` `{ open_count, open_amount, won_count, won_amount, lost_count, by_stage: [{ stage, count, amount }] }` | `401` |
| GET | `/api/deals/:id` | | `200` deal | `404`, `401` |
| POST | `/api/deals` | `{ customer_id, title, amount, stage?, expected_close_date? }` | `201` deal | `400`, `404` customer, `401` |
| PUT | `/api/deals/:id` | any of `customer_id, title, amount, stage, expected_close_date` | `200` deal | `400`, `404`, `401` |
| DELETE | `/api/deals/:id` | | `200` deleted deal | `403` without `deals.delete`, `404`, `401` |

Notes:
- `/summary` is registered before `/:id`.
- PUT is a partial update (fields left out stay unchanged), like customers. `expected_close_date: null` clears the date.
- Validation: `title` required on create, 1–200 chars; `amount` required on create, a number `>= 0` with at most 2 decimals; `stage` must be a known key; `expected_close_date` must be `YYYY-MM-DD`.
- All SQL lives in `db.js` (`listDeals(user, filters)`, `getDealById(user, id)`, `createDeal(user, data)`, `updateDeal(user, id, data)`, `deleteDeal(user, id)`, `dealSummary(user, filters)`), each taking the caller `user` first.
- `GET /api/customers` gains `open_deals_count` per customer (see Q5) so the Customers table can show it.

### 6.2 AI agent

New tools (see Q4), all scoped through the same `db.js` functions and `req.user`:
- `search_deals` (by customer, stage, title)
- `add_deal` (`customer_id, title, amount, stage?, expected_close_date?`)
- `update_deal` (`deal_id` + any field, including stage)

**No delete tool**, same as customers. The system prompt mentions the stage keys and asks for deal lists as Markdown tables, with amounts in the app currency.

### 6.3 Swagger

New **Deals** tag, a shared `Deal` schema and `DealSummary` schema in `swagger.js`, and an `@openapi` block on every new route.

## 7. Frontend

- **Navigation:** a new **Deals** page (visible to every logged-in user).
  - Table: title, customer, amount, stage (coloured badge), expected close date, owner (view_all only), created.
  - Filters: search by title, stage (all / open / closed / each stage), owner (view_all only).
  - Toolbar: **New deal**, Refresh. Row actions: Edit, Delete (only with `deals.delete`), and Ask AI (when `onChat` is set).
  - Overdue open deals (expected close date in the past) show the date in a warning colour.
- **`DealForm` modal:** customer (select from the customers the user can see), title, amount, stage, expected close date.
- **Customers page:** a **Deals** action per row opens the Deals page filtered to that customer, and a "Open deals" count column. From there, **New deal** pre-selects the customer.
- **Dashboard:** cards for **Open pipeline** (count and total amount), **Won** (count and amount) and **Lost** (count), from `/api/deals/summary`.
- **Amounts** are formatted with `Intl.NumberFormat` in the app currency (`en-IN` grouping for INR shows `₹1,50,000.00`; Arabic uses Arabic locale formatting).
- **`api.js`:** `listDeals`, `getDealSummary`, `getDeal`, `createDeal`, `updateDeal`, `deleteDeal`.
- **Translations:** all new strings, including the stage names, in both `en` and `ar`.
- **Roles UI:** the new `deals.delete` permission appears in `RoleForm` with a translated label.

## 8. Customer deletion and reassignment

- Reassigning a customer (edit or bulk assign) needs no deal changes: deals follow the customer automatically.
- Deleting a customer **also deletes its deals** (Q3). The delete confirmation says how many deals will be deleted when there are any.
- Deleting a user doesn't touch deals (their customers are reassigned or unassigned as today; `created_by` becomes `NULL`).

## 9. Acceptance criteria

1. Priya (Sales) creates "Brochure printing – Q4" for Sunrise Hospital, ₹1,50,000, stage Lead, close 30 Nov; it appears on the Deals page and under the customer.
2. She moves it Lead → Qualified → Proposal → Won; `closed_at` is set at Won. Moving it back to Proposal clears `closed_at`.
3. She adds a second deal "ID cards" for the same customer; both are listed.
4. Another sales user can't see, edit or delete Priya's deals (`404`), and can't create a deal on her customer (`404`).
5. An admin sees all deals, the owner column and owner filter, and the dashboard totals cover all deals. A sales user's dashboard covers only their own.
6. Reassigning Sunrise Hospital to another sales user moves its deals to that user's view.
7. Without `deals.delete` the Delete button is hidden and `DELETE /api/deals/:id` returns `403`.
8. Invalid input (empty title, negative amount, unknown stage, bad date) returns `400` with a clear message.
9. Deleting a customer warns about and deletes its deals.
10. The AI Assistant can list, add and update deals for the user's own customers, and can't delete them.
11. Everything works in Arabic (RTL, translated stages, formatted amounts) and all endpoints work from Swagger.

## 10. Decisions

The user approved the defaults (in bold) on 2026-10-29.

- **Q1: Who can delete deals?** **A new `deals.delete` permission** (given to Admin and Sales by default). Alternative: reuse `customers.delete`.
- **Q2: Currency.** **One app-wide currency, INR (₹), set as a constant**; amounts stored without a currency column. Alternative: a currency per deal (adds a column and makes totals harder).
- **Q3: Deleting a customer that has deals.** **Delete its deals too (`ON DELETE CASCADE`), with a warning.** Alternative: block deleting a customer that has deals (`409`).
- **Q4: AI Assistant.** **Add search/add/update deal tools now.** Alternative: leave the agent for a later spec.
- **Q5: Customers table.** **Show an "Open deals" count column.** Alternative: no change to the Customers table apart from the Deals action.
