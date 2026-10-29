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
- Agent (needs a token): `POST /api/agent/chat` with `{ "message": "get all customers" }`.
  Send the returned `conversationId` back to continue the conversation.

The agent uses Claude (`claude-opus-5-5`) with these tools: `get_all_customers`,
`get_customer_by_name`, `get_customer_by_id`, `add_customer`, `update_customer`.
The agent cannot delete. Deleting only works through the REST API and the UI.
CORS allows `FRONTEND_ORIGIN` (default `http://localhost:5173`).

### Authentication and per-user access

- `POST /api/auth/register` `{ name, email, password }` creates a user with the `sales` role and returns `{ user, token }`. `POST /api/auth/login` `{ email, password }` returns the same. Tokens are valid for 8 hours.
- Every `/api/customers`, `/api/knowledge` and `/api/agent` call needs `Authorization: Bearer <token>`, otherwise it returns `401`.
- Each customer belongs to one sales user (`customer.sales_user_id`). Users only see and change their own customers, and another user's customer returns `404`. The agent follows the same rule.
- The knowledge bank is shared by all logged-in users.
- **Testing in Swagger:** call register or login, copy the `token`, click **Authorize**, paste it, then try the other endpoints.
- The `app_user` table and the `sales_user_id` column are created on first use. Customers that existed before have no owner, and only an admin can see them until they are assigned.

### Admin role

- Admins see and manage **every** customer, with the owner's name (`sales_user_name`). They can filter with `GET /api/customers?sales_user_id=<id>` or `?sales_user_id=none` for unassigned customers.
- Admins can set or change a customer's owner with `sales_user_id` on POST and PUT (`null` unassigns it), or assign many at once with `POST /api/customers/assign` `{ customer_ids: [...], sales_user_id }`. Only sales users can own customers.
- `GET /api/users` lists users with their customer counts. `PATCH /api/users/{id}/role` `{ role: "sales" | "admin" }` changes a role. An admin can't change their own role, and a user who still owns customers can't be made an admin.
- Sales users get `403` on these endpoints, and any `sales_user_id` they send is ignored.
- The role is checked in the database on every request, so a role change applies immediately, even to existing tokens.
- **Making the first admin:** register normally, then run locally:

  ```bash
  cd backend
  npm run make-admin -- you@example.com
  ```

- In the UI, admins get a **Users** page, an **Owner** column and filter, bulk **Assign to…** on Customers, an **Owner** field in the customer form, and an "Unassigned customers" card on the Dashboard.

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
