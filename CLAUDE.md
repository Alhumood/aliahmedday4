# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Customer Hub": two independent npm projects in one git repo, deployed as two separate Vercel projects.

- `backend/`: Node ≥20 ESM, Express 5, PostgreSQL via `pg`, Swagger (`swagger-jsdoc`), Anthropic SDK. Port 4000.
- `frontend/`: React 19 + Vite. Port 5173. No router library; plain JS (no TypeScript).

There is no test suite in either project (`backend` `npm test` is the npm placeholder).

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

Swagger UI: http://localhost:4000/swagger (spec at `/swagger.json`). Health: `GET /api/health` reports DB connectivity and whether `ANTHROPIC_API_KEY` is set.

## Backend architecture

- **Entry points:** `src/app.js` builds and exports the Express app. `src/server.js` calls `listen` and is used only locally. `api/index.js` re-exports the app as a Vercel serverless function, and `backend/vercel.json` rewrites every path to `/api` and bundles `src/**`. Register new routes in `app.js` so they work in both places.
- **Data layer:** `src/db.js` holds the shared `pg.Pool` (SSL with `rejectUnauthorized: false`, from `DATABASE_URL`) and every SQL function. Routes and the agent both call these functions. Neither writes SQL directly.
  - The `customer` table already exists in the database. Columns: `customer_id, name, email, phone, created_at`.
  - The `knowledge_article` table is created lazily (`CREATE TABLE IF NOT EXISTS` via `ensureKnowledgeTable()`) on first use. There is no migration tool.
  - Updates use `COALESCE`, so fields left out stay unchanged (PUT acts like a partial update).
- **Routes** (`src/routes/*.js`): `customers`, `knowledge`, `agent`. Errors go to the error handler in `app.js` through `next(err)`, and `err.status` sets the HTTP code.
- **Swagger:** the OpenAPI docs are `@openapi` JSDoc comments above each route handler, collected by the `apis` glob in `src/swagger.js`. Shared schemas (`Customer`, `Article` and their Input/Update variants) are defined in `swagger.js`. When you add or change an endpoint, update its JSDoc block. The Swagger UI HTML is served inline from `app.js` and loads its assets from the jsDelivr CDN, because `swagger-ui-express` static files don't work on Vercel.
- **Agent** (`src/agent.js`): a manual tool-use loop over `anthropic.beta.messages.create` (model `claude-opus-5-5`, up to `MAX_TOOL_ROUNDS = 8`). The tools cover customer get/search/add/update plus knowledge search and list. **The agent has no delete tool on purpose**: deleting is only possible through REST and the UI. To add a tool, add its schema to `tools` and a case to `executeTool`, which validates input and calls `db.js`. Conversation history lives in an in-memory `Map` keyed by `conversationId`, so it resets between serverless invocations on Vercel. History is only appended to, never rewritten. The system prompt asks for replies in the user's language (Arabic or English) and for customer lists as Markdown tables.
- **CORS:** `FRONTEND_ORIGIN` (comma-separated list). If it is unset, all origins are allowed.

## Frontend architecture

- `src/App.jsx` switches pages with `useState` (dashboard / customers / knowledge / chat) instead of a router. Pages get an `onChat(prompt)` callback so they can open the AI Assistant with a pre-filled prompt.
- `src/api.js` is the only place that calls `fetch`. Add new endpoints here.
- `src/i18n.jsx`: the English and Arabic `translations` objects plus `LanguageProvider`/`useI18n()`. It sets `<html lang/dir>` (RTL for Arabic) and saves the choice in `localStorage`. All UI text goes through `t.<key>`. Some keys are functions, e.g. `askAboutPrompt(c)`. **Add every new key to both `en` and `ar`.**
- Chat replies are rendered with `react-markdown` + `remark-gfm` (so the agent's tables display). Styling is all in `src/index.css`.

## Deployment and secrets

- Backend Vercel env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `FRONTEND_ORIGIN`. Frontend: `VITE_API_URL` (backend URL, no trailing slash).
- `.env*` files (except `.env.example`) and `Prompt.txt` (it contains the real DB connection string) are git-ignored. Keep them that way.
