# Spec 01: User Registration, Login and Per-User Customer Access

**Status:** Approved (2026-10-29), with the defaults from section 10
**Date:** 2026-10-29

## 1. Background

The project started without authentication: every caller could read and change every customer, through the REST API, the Swagger UI, the frontend and the AI agent.

This feature adds user registration and login. Each customer belongs to one sales person, and a logged-in user can only see and manage their own customers. The same rules apply everywhere: REST API, Swagger UI, frontend and AI agent.

## 2. Goals

1. A new user can register. New users always get the role `sales`.
2. A registered user can log in and receive an access token.
3. Each customer is linked to the sales person who owns it.
4. Customer CRUD works as it does today, but only on the logged-in user's own customers.
5. The AI agent can only read or change the logged-in user's customers.
6. Any attempt to read or change another user's customer is denied.
7. Developers can test registration, login and per-user access in the Swagger UI (via **Authorize**) or with plain API calls.

## 3. Out of scope

- Roles other than `sales` (e.g. admin or manager views of all customers).
- Password reset, email verification, refresh tokens, social login.
- Reassigning a customer to a different sales person.
- Access control on the knowledge bank beyond requiring a login (see 5.6).

## 4. Data model

### 4.1 New table `app_user`

`user` is a reserved word in PostgreSQL, so the table is called `app_user`.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `SERIAL PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | Display name |
| `email` | `TEXT NOT NULL UNIQUE` | Stored lower-cased and used to log in |
| `password_hash` | `TEXT NOT NULL` | bcrypt hash, never returned by the API |
| `role` | `TEXT NOT NULL DEFAULT 'sales'` | Only `sales` for now |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### 4.2 Change to the `customer` table

Add a column `sales_user_id INTEGER REFERENCES app_user(user_id)`.

- New customers get `sales_user_id` = the logged-in user. Clients cannot set or change it.
- Existing customers start with `sales_user_id = NULL`, so nobody can see them until they are assigned (see open question Q1).

### 4.3 Schema setup

This follows the existing `knowledge_article` pattern in `backend/src/db.js`, with no migration tool. On first use, the backend runs these once:

- `CREATE TABLE IF NOT EXISTS app_user (...)`
- `ALTER TABLE customer ADD COLUMN IF NOT EXISTS sales_user_id ...`

## 5. Backend behaviour

### 5.1 Authentication method

- Stateless JWT bearer tokens, so login works on Vercel serverless with no session store.
- Tokens are signed with a new env var `JWT_SECRET` and expire after 8 hours.
- Token claims: `sub` (user_id), `email`, `role`.
- Clients send the token as `Authorization: Bearer <token>`.
- Passwords are hashed with bcrypt.

### 5.2 New endpoints (public)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` | `201` `{ user, token }` | `400` missing or invalid fields (password shorter than 8 characters, bad email); `409` email already registered |
| POST | `/api/auth/login` | `{ email, password }` | `200` `{ user, token }` | `400` missing fields; `401` wrong email or password (one generic message for both) |

A `role` sent in the register body is ignored; the role is always `sales`.

### 5.3 New endpoint (requires a login)

| Method | Path | Success |
|---|---|---|
| GET | `/api/auth/me` | `200` with the current user (`user_id, name, email, role, created_at`) |

### 5.4 Protected endpoints

These endpoints require a valid token. A missing, invalid or expired token returns `401 { error }`.

- `/api/customers/*`
- `/api/agent/*`
- `/api/knowledge/*`

These stay public: `/api/health`, `/api/auth/register`, `/api/auth/login`, `/swagger`, `/swagger.json`.

### 5.5 Per-user customer access

Every customer query in `db.js` takes the current user's id and filters on `sales_user_id`.

| Endpoint | Behaviour |
|---|---|
| `GET /api/customers` (and `?name=`) | Returns only the caller's customers |
| `GET /api/customers/{id}` | Returns the customer if the caller owns it, otherwise `404` |
| `POST /api/customers` | Creates the customer with `sales_user_id` = caller |
| `PUT /api/customers/{id}` | Updates only if the caller owns it, otherwise `404`. A `sales_user_id` in the body is ignored. |
| `DELETE /api/customers/{id}` | Deletes only if the caller owns it, otherwise `404` |

Requests for another user's customer are denied with `404 Customer not found`, the same response as for a customer that doesn't exist. This way a user cannot find out which customer IDs exist (see open question Q2).

Ownership is checked inside the SQL (`WHERE customer_id = $1 AND sales_user_id = $2`), not by fetching the row first and comparing afterwards.

### 5.6 Knowledge bank

The knowledge bank stays shared: any logged-in user can read and manage all articles. It now requires a login, but it has no per-user ownership.

### 5.7 AI agent

- `POST /api/agent/chat` and `DELETE /api/agent/chat/{id}` require a login.
- `chat()` receives the authenticated user. Every customer tool (`get_all_customers`, `get_customer_by_name`, `get_customer_by_id`, `add_customer`, `update_customer`) calls the user-scoped `db.js` functions.
- The user id always comes from the token, never from the model's tool input. The tool schemas do not include a user or owner field.
- When the agent asks for another user's customer, the tool returns the same `Customer not found` result as the REST API.
- Each conversation is tied to the user who started it. Sending another user's `conversationId` starts a new conversation and does not continue theirs. A user also cannot reset someone else's conversation.
- The system prompt adds one line: the assistant only has access to the current sales person's customers.
- The agent still has no delete tool.

## 6. Swagger / OpenAPI

- Add a `bearerAuth` security scheme (HTTP bearer, JWT) to `components.securitySchemes` in `backend/src/swagger.js`.
- Document `security: [{ bearerAuth: [] }]` on every protected operation. The public auth endpoints override this with `security: []`.
- Add an **Auth** tag and schemas: `RegisterInput`, `LoginInput`, `User`, `AuthResponse` (`{ user, token }`).
- Add `sales_user_id` to the `Customer` schema as read-only. It is not part of `CustomerInput` or `CustomerUpdate`.
- Document the `401` response on protected operations, and the `404` "not found or not yours" behaviour on `/api/customers/{id}`.
- Update the API description to mention login and per-user access.
- Testing in Swagger UI: call `POST /api/auth/register` or `POST /api/auth/login`, copy the `token`, click **Authorize**, paste it, then call the customer and agent endpoints.

## 7. Frontend

- **New pages:** Login and Register. They are shown when there is no valid token. You can switch between them, and both support English and Arabic.
- **After login or registration:**
  - The token and user are saved in `localStorage`.
  - `api.js` adds `Authorization: Bearer <token>` to every request.
  - A `401` response logs the user out and returns to Login.
- **Sidebar:** shows the logged-in user's name and role, plus a **Log out** button. Logging out clears the token and resets the chat.
- **Customers, Dashboard and AI Assistant pages:** they work as they do today, showing only the user's own customers. The UI needs no ownership logic because the backend filters the data.
- **Translations:** every new UI string is added to both `en` and `ar` in `i18n.jsx`.

## 8. Configuration

- New backend env var: `JWT_SECRET`. Add it to `backend/.env.example` with a placeholder, to the README, and to `CLAUDE.md`.
- If `JWT_SECRET` is missing, the auth endpoints return `503` with a clear message, the same way a missing `ANTHROPIC_API_KEY` is handled today.
- `/api/health` also reports whether auth is configured.
- New backend dependencies: `jsonwebtoken`, `bcryptjs`.

## 9. Acceptance criteria

1. Registering with a new email returns `201` and a token. The role is `sales`, even if the body asks for another role.
2. Registering an existing email returns `409`.
3. Logging in with the right password returns a token. A wrong password or unknown email returns `401`.
4. Calling any customer, agent or knowledge endpoint without a token, or with an invalid or expired one, returns `401`.
5. User A creates a customer. User A sees it in `GET /api/customers`; user B does not.
6. User B's `GET`, `PUT` and `DELETE` on user A's customer id all return `404`, and the record is unchanged.
7. Sending `sales_user_id` in a POST or PUT body has no effect.
8. Asked "get all customers", the agent lists only the caller's customers.
9. Asked by user B to show or update user A's customer by id or by name, the agent reports that it can't find the customer, and nothing changes.
10. User B cannot continue or reset user A's agent conversation.
11. All of the above can be done in the Swagger UI using **Authorize**.
12. The frontend shows Login/Register when logged out. After login it shows only the user's own customers, and Log out returns to Login. Everything works in English and in Arabic (RTL).
13. `/api/health` and `/swagger` work without a token.

## 10. Decisions

The user approved the defaults on 2026-10-29.

- **Q1: Existing customers:** they stay unassigned (`sales_user_id = NULL`), so no user can see them. They can be assigned later with SQL.
- **Q2: Another user's customer:** the API returns `404 Customer not found`, so customer IDs aren't revealed.
- **Q3: Knowledge bank:** a login is required. The articles are shared by all logged-in users.
- **Q4: Token lifetime:** 8 hours.
