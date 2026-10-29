# Plan 01: User Registration, Login and Per-User Customer Access

**Spec:** [`_specs/01_spec_userlogin_registration.md`](../_specs/01_spec_userlogin_registration.md) (approved 2026-10-29)
**Status:** Approved (2026-10-29)

## 0. Before starting

- Commit any uncommitted changes on the branch first (`CLAUDE.md` workflow rule).
- Install the new backend dependencies: `cd backend && npm install jsonwebtoken bcryptjs`.
- Add `JWT_SECRET` to `backend/.env`. For local use, generate one with `openssl rand -hex 32`.

## 1. Backend: data layer (`backend/src/db.js`)

1. Add `ensureAuthSchema()`, which runs once and caches its promise. It copies `ensureKnowledgeTable()`, including clearing the cache if setup fails, and runs:
   - `CREATE TABLE IF NOT EXISTS app_user (...)`, using the columns from spec 4.1.
   - `ALTER TABLE customer ADD COLUMN IF NOT EXISTS sales_user_id INTEGER REFERENCES app_user(user_id)`.
   - `CREATE INDEX IF NOT EXISTS customer_sales_user_id_idx ON customer (sales_user_id)`.
2. Add the user functions:
   - `createUser({ name, email, passwordHash })`. It inserts the row with role `'sales'` and returns the user without the hash. It maps the Postgres unique violation (`23505`) to an error with `status = 409`.
   - `getUserByEmail(email)`, which returns the row including `password_hash`. Only the login code uses it.
   - `getUserById(id)`, which returns the user without the hash.
3. Scope the customer functions to a user. Each one takes `userId` as its first argument, calls `ensureAuthSchema()`, and adds `sales_user_id = $n` to its `WHERE` clause:
   - `listCustomers(userId)`
   - `getCustomerById(userId, id)`
   - `searchCustomersByName(userId, name)`
   - `createCustomer(userId, {...})`, which inserts `sales_user_id`.
   - `updateCustomer(userId, id, {...})`, which never touches `sales_user_id`.
   - `deleteCustomer(userId, id)`
4. Add `sales_user_id` to `COLUMNS`.

## 2. Backend: auth module (new `backend/src/auth.js`)

This module holds the shared JWT and password logic. Routes and middleware import it.

- `getSecret()` throws a `status = 503` error if `JWT_SECRET` is missing. This mirrors `getClient()` in `agent.js`.
- `hashPassword` and `verifyPassword` use `bcryptjs` with cost 10.
- `signToken(user)` puts `{ sub: user_id, email, role }` in the token, with `expiresIn: "8h"`.
- `requireAuth(req, res, next)` is Express middleware:
  - It parses the `Authorization: Bearer` header and verifies the token.
  - It sets `req.user = { user_id, email, role }`.
  - If the token is missing or invalid, it responds `401 { error: "Authentication required" }`.
  - If the token is expired, it responds `401 { error: "Session expired, please log in again" }`.

## 3. Backend: auth routes (new `backend/src/routes/auth.js`)

Validation follows the style in `routes/customers.js`, and the `@openapi` JSDoc goes above each handler.

- `POST /register`
  - Validates `name`, `email` (simple regex check) and `password` (at least 8 characters).
  - Lower-cases and trims the email.
  - Ignores any `role` in the body.
  - Responds `201 { user, token }`.
- `POST /login`
  - Looks up the user by email and compares the bcrypt hash.
  - Responds `401 { error: "Invalid email or password" }` for both an unknown email and a wrong password.
  - Responds `200 { user, token }` on success.
- `GET /me` is protected by `requireAuth`. It responds with `getUserById(req.user.user_id)`, or `401` if that user was deleted.

## 4. Backend: wiring (`backend/src/app.js`)

- Mount the routers:
  - `app.use("/api/auth", authRoutes)`
  - `app.use("/api/customers", requireAuth, customerRoutes)`
  - `app.use("/api/knowledge", requireAuth, knowledgeRoutes)`
  - `app.use("/api/agent", requireAuth, agentRoutes)`
- `/api/health` adds `auth: Boolean(process.env.JWT_SECRET)` to its response.

## 5. Backend: customer routes (`backend/src/routes/customers.js`)

- Pass `req.user.user_id` into every `db.*Customer*` call.
- `POST` and `PUT` only read `name`, `email` and `phone` from the body, so `sales_user_id` is ignored automatically. Check that no `...req.body` spread is added.
- The `404 Customer not found` responses already exist. They now also cover customers that belong to another user.

## 6. Backend: agent (`backend/src/agent.js`, `routes/agent.js`)

1. Change `chat(message, conversationId)` to `chat(user, message, conversationId)`.
2. Change `executeTool(name, input)` to `executeTool(userId, name, input)`. Every customer case passes `userId` into `db.js`.
   - The tool `input_schema`s stay as they are, with no owner field.
   - The `add_customer` and `update_customer` cases already pick named fields only. `update_customer` currently passes `input` whole: change it to pass `{ name, email, phone }` explicitly.
3. Change the conversations map to `Map<id, { userId, messages }>`.
   - Continue a conversation only when the stored entry exists and `entry.userId === user.user_id`. Otherwise start a new one.
   - Change `resetConversation(userId, id)` to delete the conversation only if that user owns it.
4. Add one sentence to `SYSTEM_PROMPT`: "You only have access to the customers assigned to the signed-in sales person; if a customer is not found, say so and do not speculate about other users' data."
5. In `routes/agent.js`, pass `req.user` and `req.user.user_id` through.

## 7. Backend: Swagger (`backend/src/swagger.js` + JSDoc)

- Add `components.securitySchemes.bearerAuth = { type: "http", scheme: "bearer", bearerFormat: "JWT" }`.
- Set a top-level `security: [{ bearerAuth: [] }]` so every operation requires the token by default.
- Add `security: []` in the JSDoc of `POST /api/auth/register` and `POST /api/auth/login` to make them public.
- Add the schemas `RegisterInput`, `LoginInput`, `User` and `AuthResponse`.
- Add `sales_user_id` to `Customer` with `readOnly: true`.
- Add a reusable `components.responses.Unauthorized` and reference it with `401` on the customer, knowledge and agent operations.
- Update the `404` description on `/api/customers/{id}` to "Customer not found or not assigned to you".
- Update the `info.description` with the steps for testing in the Swagger UI (register → copy token → **Authorize**).
- In the `swaggerHtml` in `app.js`, add `persistAuthorization: true` so a page refresh keeps the token.

## 8. Frontend

1. **`src/api.js`**
   - Keep the token in a module-level variable, plus `setAuthToken(token)` and `onUnauthorized(handler)`.
   - `request()` adds the `Authorization` header when a token is set. On a `401` it calls the handler before throwing.
   - Add `register`, `login` and `me`.
2. **New `src/auth.jsx`** (follows the `i18n.jsx` pattern)
   - `AuthProvider` and `useAuth()` provide `{ user, login, register, logout }`.
   - The token and user are saved in `localStorage` under `auth` (wrapped in try/catch like the `lang` value).
   - On startup, a saved token is checked with `api.me()`.
   - It registers `api.onUnauthorized(logout)`.
3. **New `src/components/AuthPage.jsx`**: one card that switches between login and register.
   - Register has name, email and password fields. Login has email and password.
   - Errors are shown inline. It reuses the existing form and card CSS classes.
4. **`src/main.jsx`**: wrap `<App />` in `<AuthProvider>`, inside `LanguageProvider`.
5. **`src/App.jsx`**
   - Show `<AuthPage />` when there is no user. The language toggle stays visible there.
   - Otherwise show the current layout, with the user's name and role and a **Log out** button in the sidebar footer.
   - Logging out resets the page to the dashboard. `ChatPage` unmounts, so its conversation state is dropped.
6. **`src/i18n.jsx`**: add every new key to both `en` and `ar`: login, register, the field labels, the toggle links, the errors, log out, and role `sales`.
7. **`src/index.css`**: styles for the centered auth card and the sidebar user block, using the existing variables.

## 9. Docs

- `backend/.env.example`: add `JWT_SECRET=change-me`.
- `README.md`:
  - Describe the auth endpoints and the Swagger **Authorize** flow.
  - Add `JWT_SECRET` to the Vercel env vars.
  - Note that existing customers are unassigned and give a SQL example for assigning them.
- `CLAUDE.md`:
  - Note the `auth.js` and `requireAuth` mounting.
  - Note that every customer `db.js` function takes `userId` first.
  - Note that agent tools get the `userId` from the token, never from the model.
  - Add `JWT_SECRET`.

## 10. Verification

There is no test suite, so verify by hand against spec section 9, with `npm run dev` in the backend.

1. Use `curl` to register users A and B and save both tokens. Check the role, the `409` on a duplicate email, and the `401` on a bad login.
2. With no token, a bad token, or an expired token, check that customer, knowledge and agent calls return `401`.
3. User A creates a customer. A can see it and B can't. B's GET, PUT and DELETE on A's id all return `404`, and the row is unchanged. A `sales_user_id` sent in the body is ignored.
4. Agent:
   - User A: "get all customers" returns only A's customers.
   - User B: asking for A's customer by id or name returns not found.
   - User B sending A's `conversationId` gets a new conversation.
5. Repeat steps 1 and 3 in the Swagger UI using **Authorize**.
6. Frontend:
   - `npm run lint` and `npm run build` pass.
   - Register, log in and log out in the browser, in English and in Arabic (RTL).
   - The Customers, Dashboard and Chat pages show only the user's own data.
   - An expired token returns to the login page.
7. Check that `/api/health` and `/swagger` work without a token.

## 11. Risks / notes

- **`ALTER TABLE` permission:** it needs owner rights on `customer` in the Render database. If it fails, the user must run the statement manually; the error is returned through the existing error handler.
- **Existing customers:** after deploy, they are invisible until assigned (spec Q1).
- **Agent conversations on Vercel:** they are still kept in memory. That was already the case, and per-user ownership doesn't change it.
