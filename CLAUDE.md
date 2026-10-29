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
  - The tables are created lazily on first use, with no migration tool. `ensureKnowledgeTable()` creates `knowledge_article`. `ensureAuthSchema()` creates `app_user` and adds `customer.sales_user_id`.
  - **Every customer function takes `userId` as its first argument** and filters on `sales_user_id` inside the SQL. Never add a customer query that isn't scoped to the user. Another user's row returns `null`, which the routes turn into `404`.
  - Updates use `COALESCE`, so fields left out stay unchanged (PUT acts like a partial update).
- **Routes** (`src/routes/*.js`): `auth`, `customers`, `knowledge`, `agent`. Errors go to the error handler in `app.js` through `next(err)`, and `err.status` sets the HTTP code.
- **Auth** (`src/auth.js`):
  - JWT bearer tokens signed with `JWT_SECRET`, valid for 8 hours, plus bcrypt password hashing.
  - `app.js` mounts the `requireAuth` middleware in front of the customers, knowledge and agent routers, and it sets `req.user = { user_id, email, role }`.
  - `/api/auth/register` and `/api/auth/login` are public. Registration always assigns the role `sales`.
  - The spec is `_specs/01_spec_userlogin_registration.md`.
- **Swagger:** the OpenAPI docs are `@openapi` JSDoc comments above each route handler, collected by the `apis` glob in `src/swagger.js`. Shared schemas (`Customer`, `Article`, `User`, `AuthResponse`, etc.) and the `Unauthorized` response are defined in `swagger.js`. The whole spec sets `security: [{ bearerAuth: [] }]` as the default, and public operations override it with `security: []` in their JSDoc. When you add or change an endpoint, update its JSDoc block. The Swagger UI HTML is served inline from `app.js` and loads its assets from the jsDelivr CDN, because `swagger-ui-express` static files don't work on Vercel.
- **Agent** (`src/agent.js`): a manual tool-use loop over `anthropic.beta.messages.create` (model `claude-opus-5-5`, up to `MAX_TOOL_ROUNDS = 8`). The tools cover customer get/search/add/update plus knowledge search and list. **The agent has no delete tool on purpose**: deleting is only possible through REST and the UI. To add a tool, add its schema to `tools` and a case to `executeTool(userId, name, input)`, which validates input and calls `db.js`. The `userId` always comes from the token (`req.user`), never from the model's tool input, and tool schemas must not include an owner field. Conversation history lives in an in-memory `Map` of `conversationId → { userId, messages }`. A conversation only continues for the user who owns it, and the history resets between serverless invocations on Vercel. History is only appended to, never rewritten. The system prompt asks for replies in the user's language (Arabic or English) and for customer lists as Markdown tables.
- **CORS:** `FRONTEND_ORIGIN` (comma-separated list). If it is unset, all origins are allowed.

## Frontend architecture

- `src/App.jsx` switches pages with `useState` (dashboard / customers / knowledge / chat) instead of a router. Pages get an `onChat(prompt)` callback so they can open the AI Assistant with a pre-filled prompt.
- `src/api.js` is the only place that calls `fetch`. Add new endpoints here. It attaches the bearer token set by `setAuthToken()`, and on a `401` it calls the `onUnauthorized` handler, which logs the user out.
- `src/auth.jsx`: `AuthProvider`/`useAuth()` (`user, login, register, logout`), with the session saved in `localStorage` under `auth`. `App.jsx` shows `AuthPage` when no one is logged in. Otherwise it renders `MainLayout` keyed by `user_id`, so all page and chat state is reset on logout.
- `src/i18n.jsx`: the English and Arabic `translations` objects plus `LanguageProvider`/`useI18n()`. It sets `<html lang/dir>` (RTL for Arabic) and saves the choice in `localStorage`. All UI text goes through `t.<key>`. Some keys are functions, e.g. `askAboutPrompt(c)`. **Add every new key to both `en` and `ar`.**
- Chat replies are rendered with `react-markdown` + `remark-gfm` (so the agent's tables display). Styling is all in `src/index.css`.

## Deployment and secrets

- Backend Vercel env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGIN`. Frontend: `VITE_API_URL` (backend URL, no trailing slash).
- `.env*` files (except `.env.example`) and `Prompt.txt` (it contains the real DB connection string) are git-ignored. Keep them that way.
