# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Customer Hub": two independent npm projects in one git repo, deployed as two separate Vercel projects.

- `backend/`: Node ≥20 ESM, Express 5, PostgreSQL via `pg`, Swagger (`swagger-jsdoc`), Anthropic SDK. Port 4000.
- `frontend/`: React 19 + Vite. Port 5173. No router library; plain JS (no TypeScript).

There is no test suite in either project (`backend` `npm test` is the npm placeholder).

## Workflow: spec-driven development

Follow these steps in order for every feature or change:

1. **Spec:** write the spec in `_specs/` and get the user's approval before going further.
2. **Plan:** once the spec is approved, write the implementation plan in `_plans/`.
3. **Implement:** before writing any code, make sure the current branch has no uncommitted changes. If it does, commit them first (or ask the user), so the implementation starts from a clean commit.

## Commands

```bash
# Backend (needs backend/.env, see backend/.env.example)
cd backend && npm install
npm run dev      # node --watch src/server.js
npm start        # node src/server.js
npm run make-admin -- <email>   # promote a registered user to admin (local only, not deployed)

# Frontend (backend URL from VITE_API_URL in frontend/.env, default http://localhost:4000)
cd frontend && npm install
npm run dev      # vite
npm run build    # vite build -> dist/
npm run lint     # oxlint (config: frontend/.oxlintrc.json)
```

Swagger UI: http://localhost:4000/swagger (spec at `/swagger.json`). Health: `GET /api/health` reports DB connectivity and whether `ANTHROPIC_API_KEY` and `JWT_SECRET` are set.

## Backend architecture

- **Entry points:** `src/app.js` builds and exports the Express app. `src/server.js` calls `listen` and is used only locally. `api/index.js` re-exports the app as a Vercel serverless function, and `backend/vercel.json` rewrites every path to `/api` and bundles `src/**`. Register new routes in `app.js` so they work in both places.
- **Data layer:** `src/db.js` holds the shared `pg.Pool` (SSL with `rejectUnauthorized: false`, from `DATABASE_URL`) and every SQL function. Routes and the agent both call these functions. Neither writes SQL directly.
  - The `customer` table already exists in the database. Columns: `customer_id, name, email, phone, sales_user_id, created_at`.
  - The tables are created lazily on first use, with no migration tool. `ensureKnowledgeTable()` creates `knowledge_article`. `ensureAuthSchema()` creates `app_user`, `job_title` (names unique, ignoring case) and the columns `customer.sales_user_id` and `app_user.job_title_id` (`ON DELETE SET NULL`).
  - **Every user read goes through `userSelect()`**, so all user responses include `job_title_id` and `job_title`. Writes re-read the user with `getUserById`. `updateUser()` only changes the fields present, and unique-email violations become `409` through `withConflict()`.
  - `deleteUser(id, reassignTo)` is one transaction: it moves the user's customers to `reassignTo` (or unassigns them), then deletes the user. Customers are never deleted with their owner, and `customer.sales_user_id` has no `ON DELETE` rule, so always go through this function.
  - **Every customer function takes the caller `user` (`{ user_id, role }`) as its first argument.** `ownerScope()` builds the condition: sales users are always filtered to `sales_user_id = user_id`, while admins see every row and can filter by owner. Admin results also include `sales_user_name`, through `customerSelect()`. Never add a customer query that skips `ownerScope()`. Another user's row returns `null`, which the routes turn into `404`.
  - Only `sales` users can own customers (`isSalesUser()`). Admin-only inputs, such as `sales_user_id` in a body or query, must be ignored for sales users, not rejected.
  - Updates use `COALESCE`, so fields left out stay unchanged (PUT acts like a partial update).
- **Routes** (`src/routes/*.js`): `auth`, `users` and `jobTitles` (admin only), `customers`, `knowledge`, `agent`. In `customers.js`, `GET /export` and `POST /assign` are registered before `/:id`, and `listFilters(req)` parses the `name` / admin-only `sales_user_id` query for both the list and the export. Errors go to the error handler in `app.js` through `next(err)`, and `err.status` sets the HTTP code.
- **Auth** (`src/auth.js`):
  - JWT bearer tokens signed with `JWT_SECRET`, valid for 8 hours, plus bcrypt password hashing.
  - `app.js` mounts the `requireAuth` middleware in front of the users, customers, knowledge and agent routers. It **reloads the user from the database on every request** and sets `req.user = { user_id, email, role }`, so a role change applies immediately. `requireAdmin` returns `403` to non-admins.
  - Roles are `sales` and `admin`. `/api/auth/register` and `/api/auth/login` are public, and registration always assigns `sales`. Admins are made with `backend/scripts/make-admin.js`, or by an admin through the Users endpoints (`POST /api/users`, `PATCH /api/users/{id}`, `PATCH /api/users/{id}/role`). Admins can't change their own role or delete themselves. A **job title is a label, not a permission**: never use it for access checks. `EMAIL_RE` and `MIN_PASSWORD_LENGTH` in `auth.js` are shared by registration and the admin user forms.
  - The specs are `_specs/01_spec_userlogin_registration.md`, `_specs/02_spec_admin_user_management.md` and `_specs/03_spec_admin_user_crud_job_titles.md`. The customer export is `_specs/04_spec_customer_export_excel_pdf.md`.
- **Swagger:** the OpenAPI docs are `@openapi` JSDoc comments above each route handler, collected by the `apis` glob in `src/swagger.js`. Shared schemas (`Customer`, `Article`, `User`, `AuthResponse`, etc.) and the `Unauthorized`/`Forbidden` responses are defined in `swagger.js`. The whole spec sets `security: [{ bearerAuth: [] }]` as the default, and public operations override it with `security: []` in their JSDoc. When you add or change an endpoint, update its JSDoc block. The Swagger UI HTML is served inline from `app.js` and loads its assets from the jsDelivr CDN, because `swagger-ui-express` static files don't work on Vercel.
- **Agent** (`src/agent.js`): a manual tool-use loop over `anthropic.beta.messages.create` (model from `ANTHROPIC_MODEL`, default `claude-opus-5-5`; effort from `AGENT_EFFORT`, default `low`; up to `MAX_TOOL_ROUNDS = 8`). The server-side refusal `fallbacks` are only sent for models in `FALLBACK_MODELS`, because Haiku 5.5 has none. The tools cover customer get/search/add/update plus knowledge search and list. **The agent has no delete tool on purpose**: deleting is only possible through REST and the UI. To add a tool, add its schema to `tools` and a case to `executeTool(user, name, input)`, which validates input and calls `db.js`. The `user` always comes from `req.user`, never from the model's tool input. Tool schemas must not include an owner field, so ownership can't be changed through the agent. `systemPrompt(user)` is rebuilt on every call: sales users get the own-customers rule, and admins get the all-customers rule. Conversation history lives in an in-memory `Map` of `conversationId → { userId, messages }`. A conversation only continues for the user who owns it, and the history resets between serverless invocations on Vercel. History is only appended to, never rewritten. The system prompt asks for replies in the user's language (Arabic or English) and for customer lists as Markdown tables.
- **Export** (`src/export.js`): `buildCustomersXlsx` (`exceljs`) and `buildCustomersPdf` (`pdfkit`) turn the rows from `listCustomers` into files, so `ownerScope()` still applies. The export's English and Arabic labels live in `LABELS` there (the backend has no i18n file). pdfkit shapes a single Arabic word but doesn't order right-to-left text, so the PDF writer splits text into words, orders them with `bidi-js` (direction from the first strong letter, like `dir="auto"`), and draws each word with the Latin or Arabic Noto font from `src/fonts/` (bundled on Vercel through `src/**`). Cells are one line, truncated with an ellipsis.
- **CORS:** `FRONTEND_ORIGIN` (comma-separated list). If it is unset, all origins are allowed. `Content-Disposition` is in `exposedHeaders` so the frontend can read export file names.

## Frontend architecture

- `src/App.jsx` switches pages with `useState` (dashboard / customers / knowledge / chat / users) instead of a router. Nav items marked `adminOnly` only show for admins. `openCustomers(owner)` opens Customers filtered by owner. Pages get an `onChat(prompt)` callback so they can open the AI Assistant with a pre-filled prompt.
- `src/api.js` is the only place that calls `fetch`. Add new endpoints here. It attaches the bearer token set by `setAuthToken()`, and on a `401` it calls the `onUnauthorized` handler, which logs the user out. JSON calls go through `request()`; file downloads go through `download()` (returns `{ blob, filename }`) and `saveBlob()`.
- `src/auth.jsx`: `AuthProvider`/`useAuth()` (`user, login, register, logout`), with the session saved in `localStorage` under `auth`. `App.jsx` shows `AuthPage` when no one is logged in. Otherwise it renders `MainLayout` keyed by `user_id`, so all page and chat state is reset on logout.
- `src/i18n.jsx`: the English and Arabic `translations` objects plus `LanguageProvider`/`useI18n()`. It sets `<html lang/dir>` (RTL for Arabic) and saves the choice in `localStorage`. All UI text goes through `t.<key>`. Some keys are functions, e.g. `askAboutPrompt(c)`. **Add every new key to both `en` and `ar`.**
- Admin-only UI checks `useAuth().user.role === 'admin'`: the Users page, the owner column, filter and bulk assign in `CustomersPage`, the `salesUsers` prop on `CustomerForm`, the Unassigned card on the dashboard, and `UsersPage` with `UserForm` and `JobTitlesCard`. The backend enforces the same rules anyway. The sidebar shows `user.job_title`, falling back to the role, and `useAuth().refresh()` re-reads the current user after an admin edits their own details.
- Chat replies are rendered with `react-markdown` + `remark-gfm` (so the agent's tables display). Styling is all in `src/index.css`.

## Deployment and secrets

- Backend Vercel env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGIN`, and optionally `ANTHROPIC_MODEL` and `AGENT_EFFORT`. Frontend: `VITE_API_URL` (backend URL, no trailing slash).
- `.env*` files (except `.env.example`) and `Prompt.txt` (it contains the real DB connection string) are git-ignored. Keep them that way.
