# Customer Hub

Two projects:

| Project    | Stack                                              | Port |
|------------|----------------------------------------------------|------|
| `backend`  | Node.js, Express, PostgreSQL (`pg`), Swagger, Anthropic SDK | 4000 |
| `frontend` | React + Vite                                       | 5173 |

## Backend

```bash
cd backend
npm install
# put your Anthropic key in backend/.env -> ANTHROPIC_API_KEY=sk-ant-...
# and a token-signing secret            -> JWT_SECRET=<output of: openssl rand -hex 32>
npm run dev
```

- Swagger UI: http://localhost:4000/swagger
- Health: `GET /api/health`
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- CRUD (needs a token): `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/{id}`, `GET /api/customers?name=kan`
- Export (needs a token): `GET /api/customers/export?format=xlsx|pdf` downloads the customer list as Excel or PDF. It takes the same `name` and (admin only) `sales_user_id` filters as the list, plus `lang=en|ar` for the headers and right-to-left layout. Sales users only get their own customers, and only admins get the Owner column. The Customers page has an **Export** menu that exports what the table shows. The PDF fonts (Noto Sans and Noto Naskh Arabic, SIL Open Font License) are in `backend/src/fonts/`.
- Deals (needs a token): `GET/POST /api/deals`, `GET/PUT/DELETE /api/deals/{id}`, `GET /api/deals/summary`. See **Deals** below.
- Agent (needs a token): `POST /api/agent/chat` with `{ "message": "get all customers" }`.
  Send the returned `conversationId` back to continue the conversation.

The agent uses Claude (`claude-opus-5-5`) with these tools: `get_all_customers`,
`get_customer_by_name`, `get_customer_by_id`, `add_customer`, `update_customer`, `search_deals`, `add_deal`,
`update_deal`, `search_knowledge`, `list_knowledge_articles`.
The agent cannot delete customers or deals. Deleting only works through the REST API and the UI.
CORS allows `FRONTEND_ORIGIN` (default `http://localhost:5173`).

### Authentication and per-user access

- `POST /api/auth/register` `{ name, email, password }` creates a user with the built-in Sales role and returns `{ user, token }`. `POST /api/auth/login` `{ email, password }` returns the same. Tokens are valid for 8 hours.
- Every `/api/customers`, `/api/knowledge` and `/api/agent` call needs `Authorization: Bearer <token>`, otherwise it returns `401`.
- Each customer belongs to one user (`customer.sales_user_id`). Users without `customers.view_all` only see and change their own customers, and another user's customer returns `404`. The agent follows the same rule.
- The knowledge bank is shared by all logged-in users.
- **Testing in Swagger:** call register or login, copy the `token`, click **Authorize**, paste it, then try the other endpoints.
- The `app_user` table and the `sales_user_id` column are created on first use. Customers that existed before have no owner, and only users with `customers.view_all` can see them until they are assigned.

### Roles and permissions

- Each user has **one role**, and the role's **permissions** decide what they can do. The permissions are a fixed list in `backend/src/permissions.js`:

  | Permission | Allows |
  |---|---|
  | `customers.view_all` | See and edit every customer, with the owner's name (`sales_user_name`), and filter with `?sales_user_id=<id>` or `?sales_user_id=none`. Without it, users only see their own customers. |
  | `customers.own` | Customers can be assigned to this user. |
  | `customers.delete` | Delete the customers they can see. |
  | `customers.assign` | `POST /api/customers/assign` `{ customer_ids: [...], sales_user_id }`. Needs `customers.view_all`. |
  | `customers.export` | `GET /api/customers/export`. |
  | `deals.delete` | `DELETE /api/deals/{id}` for the deals they can see. |
  | `knowledge.manage` | Add, edit and delete knowledge articles (everyone can read them). |
  | `agent.use` | `/api/agent/*`. |
  | `users.manage` | `/api/users/*` and `/api/roles/*`. |

- Two built-in roles: **Admin** (every permission except `customers.own`; can't be changed) and **Sales** (`customers.own`, `customers.delete`, `customers.export`, `deals.delete`, `knowledge.manage`, `agent.use`; can be renamed and edited, can't be deleted). Self-registered users get Sales.
- **Roles:** `GET/POST /api/roles`, `PATCH/DELETE /api/roles/{id}`, and `GET /api/roles/permissions` for the list. Names are unique, ignoring upper/lower case. A role needs `customers.view_all` or `customers.own`. A role can't be deleted while users have it, you can't remove `users.manage` from your own role, and `customers.own` can't be removed while the role's users own customers.
- With `customers.view_all`, `sales_user_id` on customer POST and PUT sets the owner (`null` unassigns it), and `GET /api/customers/owners` lists the users who can own customers. Without it, any `sales_user_id` sent is ignored.
- A missing permission returns `403`. The role is checked in the database on every request, so changes apply immediately, even to existing tokens.
- **Making the first admin:** register normally, then run locally:

  ```bash
  cd backend
  npm run make-admin -- you@example.com
  ```

- **Managing users** (`users.manage`): `GET /api/users` lists users with their customer counts. `POST /api/users` adds a user (name, email, initial password, `role_id`). `PATCH /api/users/{id}` edits any of those; sending `password` sets a new one. `PATCH /api/users/{id}/role` `{ role_id }` changes only the role. A user who owns customers can't get a role without `customers.own`. `DELETE /api/users/{id}` deletes a user, with an optional `{ reassign_to: <user id> }` that receives their customers. Without it, the customers become unassigned. **Customers are never deleted with their owner.** You can't delete your own account or change your own role.
- The roles were introduced by migrating the old `sales`/`admin` roles and job titles (each job title became a role with the Sales permissions). The old `app_user.role`, `app_user.job_title_id` and `job_title` are left in the database unused, and can be dropped once this version is deployed.
- In the UI, the menu and buttons follow the permissions: the **Users** page with its **Roles** section, the **Owner** column, filter and form field, bulk **Assign to…**, delete, export, knowledge editing, the AI Assistant, and the "Unassigned customers" dashboard card.

### Deals

- A **deal** is one sales opportunity with one customer: `title`, `amount` (INR, at most 2 decimals), `stage` and an optional `expected_close_date` (`YYYY-MM-DD`). A customer can have many deals.
- Stages: `lead` → `qualified` → `proposal` → `won` / `lost`. Any stage can be set at any time. Moving to `won`/`lost` sets `closed_at`; moving back to an open stage clears it.
- **Deals follow their customer.** You can see and edit a deal exactly when you can see its customer, so reassigning a customer moves its deals too. A deal of a customer you can't see returns `404`.
- `GET /api/deals` filters: `customer_id`, `stage` (a stage, `open` or `closed`), `title`, and (with `customers.view_all`) `sales_user_id`. `GET /api/deals/summary` takes the same filters and returns open/won/lost counts and amounts.
- `POST /api/deals` `{ customer_id, title, amount, stage?, expected_close_date? }`; `PUT /api/deals/{id}` changes only the fields sent (`expected_close_date: null` clears it). Deleting needs `deals.delete`.
- **Deleting a customer also deletes its deals.** The customer list returns `deals_count` and `open_deals_count`, and the UI warns before deleting.
- The `deal` table is created on first use. That first run also adds `deals.delete` to the built-in Admin and Sales roles; custom roles get it through the Roles screen.
- In the UI: a **Deals** page (filters, add/edit form, Ask AI), a **Deals** button and an **Open deals** column on the Customers page, and Open pipeline / Won / Lost cards on the dashboard.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and register or log in. The **Customers** page has search, add, edit and delete. The **AI Assistant** page is the chat.
The backend URL is set by `VITE_API_URL` in `frontend/.env`.

## Deploying to Vercel

Create **two** Vercel projects from this repo, one per folder.

### Backend (Root Directory: `backend`)

- `api/index.js` exports the Express app (`src/app.js`) as a serverless function; `vercel.json` rewrites every path to it.
- `src/server.js` is only used for local `npm run dev` / `npm start`.
- Swagger UI loads its assets from the jsDelivr CDN, so `/swagger` works on Vercel. The spec is at `/swagger.json` and uses the current host as its server URL.
- Environment variables to set in Vercel: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGIN` (the frontend's Vercel URL; comma-separate several).
- Agent conversation history is kept in memory, so on serverless it can reset between requests.

### Frontend (Root Directory: `frontend`)

- Framework preset: Vite (build `npm run build`, output `dist`).
- Environment variable: `VITE_API_URL` = the backend's Vercel URL (no trailing slash).

Secrets live only in `.env` files, which are git-ignored. Use the `.env.example` files as templates.
