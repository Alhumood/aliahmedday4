# Plan 03: Admin Adds, Edits and Deletes Users, and Manages Roles

**Spec:** [`_specs/03_spec_admin_user_crud_job_titles.md`](../_specs/03_spec_admin_user_crud_job_titles.md) (approved 2026-10-29, defaults from section 10)
**Status:** Approved (2026-10-29). Sections 0–9 built the job-title version. **Section 10 is the plan for the spec 03 revision (section 11 of the spec): job titles become roles with permissions.**

## 0. Before starting

- Commit the spec and this plan, so the branch is clean before implementation (`CLAUDE.md` workflow rule).
- No new dependencies or env vars are needed. Password hashing reuses `hashPassword` from `auth.js`.

## 1. Backend: schema (`backend/src/db.js`)

Extend `ensureAuthSchema()`, which is still one cached promise and still runs on first use:

- `CREATE TABLE IF NOT EXISTS job_title (job_title_id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
- `CREATE UNIQUE INDEX IF NOT EXISTS job_title_name_lower_idx ON job_title (lower(name))`, which makes names unique regardless of upper and lower case.
- `ALTER TABLE app_user ADD COLUMN IF NOT EXISTS job_title_id INTEGER REFERENCES job_title(job_title_id) ON DELETE SET NULL`
  - `ON DELETE SET NULL` means deleting a title automatically clears it from its users (spec Q2). No extra query is needed.

The statements are ordered so that `job_title` exists before the `app_user` column refers to it.

## 2. Backend: user queries (`db.js`)

1. **Every user read includes the job title.**
   - Replace the plain `USER_COLUMNS` reads with one `userSelect` that does `LEFT JOIN job_title jt ON jt.job_title_id = u.job_title_id` and returns `u.user_id, u.name, u.email, u.role, u.job_title_id, jt.name AS job_title, u.created_at`.
   - `getUserById`, `getUserByEmail` (still adding `password_hash`), `listUsersWithCounts` and `getUserWithCount` all use it.
   - So `/api/auth/me`, login, register and the Users list all return `job_title` with no route changes.
   - Writes that return a user (`createUser`, `setUserRole`, the new update) use `RETURNING user_id` and then re-read with `getUserById`, so every response has the same shape.
2. **`createUser({ name, email, passwordHash, role = 'sales', jobTitleId = null })`.**
   - Registration keeps calling it without `role`, so it still always creates `sales` users.
   - It keeps the existing `23505` → `409` handling. That handling is moved into a shared helper so the update can reuse it.
3. **`updateUser(id, fields)`.**
   - It builds the `SET` list from the fields that were sent (`name`, `email`, `passwordHash`, `role`, `jobTitleId`), using `in` checks so that `jobTitleId: null` clears the title.
   - It maps `23505` to `409 "Email is already registered"`.
   - It returns `null` if the user doesn't exist.
4. **`deleteUser(id, reassignTo)`.** One transaction on a dedicated client, like `assignCustomers`:
   1. `UPDATE customer SET sales_user_id = $2 WHERE sales_user_id = $1` (with `null` for unassigned), keeping the number of rows moved;
   2. `DELETE FROM app_user WHERE user_id = $1 RETURNING user_id, name, email, role`;
   3. `ROLLBACK` and return `null` if no user was deleted.
   - It returns `{ deleted_user, customers_moved, reassigned_to }`.
5. **`jobTitleExists(id)`**, used to validate `job_title_id` on create and update.

## 3. Backend: job title queries (`db.js`)

- `listJobTitles()` returns `job_title_id, name, created_at, user_count`, using a `LEFT JOIN app_user` with `GROUP BY`, ordered by `lower(name)`.
- `createJobTitle(name)`, `renameJobTitle(id, name)` and `deleteJobTitle(id)`. Create and rename map `23505` to `409 "A job title with this name already exists"`.

## 4. Backend: routes

1. **`routes/users.js`** (already behind `requireAdmin`). The validation helpers are shared by create and update:
   - `name` is required on create and can't be blank on update.
   - `email` is checked with the regex from `routes/auth.js`, then trimmed and lower-cased. The `EMAIL_RE` constant moves to a small shared spot (exported from `auth.js`) so the two places don't drift apart.
   - `password` must be at least 8 characters and is hashed with `hashPassword`.
   - `role` must be `sales` or `admin`.
   - `job_title_id` must be `null` or an id for which `jobTitleExists` is true.
   - **`POST /`** creates the user and responds `201` with `getUserWithCount`.
   - **`PATCH /:id`**
     - Changing your own role, to anything other than your current role, is `400`.
     - A user that doesn't exist is `404`.
     - Setting `role: admin` on a user who owns customers is `409`, the same check as `/role`.
     - It responds with the updated user plus `customer_count`.
   - **`DELETE /:id`**
     - Deleting your own account is `400 "You cannot delete your own account"`.
     - `reassign_to`, when present and not `null`, must be a sales user and can't be the user being deleted. Anything else is `400`.
     - A user that doesn't exist is `404`.
     - The body is read from `req.body ?? {}`, because `DELETE` bodies are allowed and `express.json()` already parses them.
   - `PATCH /:id/role` stays as it is.
2. **New `routes/jobTitles.js`**, with `router.use(requireAdmin)`: the GET, POST, PATCH and DELETE routes from spec 6.2. Names are trimmed and must be 1–100 characters.
3. **`app.js`:** `app.use("/api/job-titles", requireAuth, jobTitlesRoutes)`.

## 5. Backend: Swagger

- **`swagger.js`:**
  - Add the schemas `UserCreate`, `UserUpdate`, `UserDelete`, `UserDeleteResult`, `JobTitle` (with `user_count`) and `JobTitleInput`.
  - Add `job_title_id` and `job_title` to `User`. `UserWithCount` gets them automatically through `allOf`.
- **JSDoc:**
  - The three new user operations and the four job-title operations, under the tags **Users** and **Job Titles**.
  - Each documents its `400`/`404`/`409` responses and `403` (`Forbidden`).

## 6. Frontend

1. **`api.js`:**
   - `createUser(body)`, `updateUser(id, body)`, `deleteUser(id, reassignTo)`, which sends `{ reassign_to }` as the `DELETE` body. `request()` already serializes `body` for any method.
   - `listJobTitles()`, `createJobTitle(name)`, `renameJobTitle(id, name)`, `deleteJobTitle(id)`.
2. **New `components/UserForm.jsx`**, modeled on `CustomerForm.jsx`:
   - Fields: name, email, password, role and job title. The job title is a `<select>` of the existing titles plus "No job title".
   - On edit, the password is optional (hint: "Leave empty to keep the current password"), and only fields that changed are sent.
   - Role is disabled when editing yourself.
3. **`UsersPage.jsx`:**
   - Add an **Add user** button in the header.
   - Add a **Job title** column (or "—").
   - Each row gets **Edit** and **Delete** buttons. Delete is hidden on your own row.
   - The inline role `<select>` stays, so quick role switches still work.
   - **Delete** opens a `Modal` that:
     - shows the confirmation text and `customer_count`;
     - when the count is above 0, offers a "Move their customers to" `<select>`: Unassigned (the default), or each **other** sales user.
     - Errors show inside the modal.
   - **Job titles card**, below the users table:
     - a list of titles with their user count;
     - an inline add input with an **Add** button;
     - each row has **Rename**, which switches the row to an input with Save and Cancel, and **Delete**, which uses a small confirm `Modal`.
   - After any change, reload both lists and show a toast, as the page does today.
4. **`App.jsx`:** the sidebar's `user-role` line shows `user.job_title ?? t.roles[user.role]`. The value comes from `api.me()`, which `auth.jsx` already re-fetches on load, so a title change appears after the next reload or login.
5. **`i18n.jsx`:** every new key in both `en` and `ar`: add/edit user, password hint, job title(s), no job title, the delete confirmation and reassignment text, rename, the toasts, and so on.
6. **`index.css`:** small styles for the job-titles card rows and the inline rename input, using the existing variables.

## 7. Docs

- **`README.md`:** the new user and job-title endpoints, and the rule that a deleted user's customers are moved or unassigned, never deleted.
- **`CLAUDE.md`:**
  - The `job_title` table, and that a job title is a label, not a permission.
  - Every user read goes through `userSelect`.
  - The `deleteUser` transaction.
  - The new routes file.

## 8. Verification

There is no test suite, so verify by hand against spec section 9. Every test user, title and customer is cleaned up afterwards, and **your account (Ali) and its data are not touched.**

1. Using a temporary admin token (a temporary user promoted with `npm run make-admin`):
   - create a sales user and an admin user, and check that both can log in;
   - check the `409` on a duplicate email and the `400` on a short password;
   - check the job-title validation `400`.
2. **Edit:**
   - change another user's name, email, role, title and password, and check that the old password fails and the new one works;
   - edit your own details, and get `400` when changing your own role;
   - promoting a user who owns customers gives `409`.
3. **Delete:**
   - a user with customers and `reassign_to` = S: the customers move to S, and S sees them;
   - without `reassign_to`: the customers become unassigned;
   - deleting yourself is `400`, `reassign_to` set to an admin is `400`, and a deleted user's token gets `401`.
4. **Job titles:** add, check the case-insensitive duplicate `409`, rename, and delete a title that users have. Those users end up with `job_title: null`.
5. Check that `/api/auth/me`, login and the Users list include `job_title`, and that a sales user gets `403` on every new endpoint.
6. Spot-check the same flows in the Swagger UI.
7. **Frontend:**
   - `npm run lint` and `npm run build` pass.
   - In Chrome, logged in as a temporary admin: add, edit and delete a user (including reassigning their customers), and add, rename and delete job titles.
   - Check the sidebar's job title, the Arabic UI, and that a sales user sees no admin controls.
   - **Before testing in Chrome, check whether you're logged in there, and ask before logging you out.**

## 9. Risks / notes

- **Deleting users:** the `customer.sales_user_id` foreign key has no `ON DELETE` rule, so a user who owns customers can't be deleted until the customers are moved. The transaction in 2.4 does exactly that, inside the same transaction.
- **Admins handling passwords** (spec Q3): passwords are only ever stored hashed and are never returned by the API. The edit form never shows the current password.
- **Admin count:** an admin can't delete or demote themselves, so there is always at least one admin. Two admins could still demote each other. That is accepted, as in spec 02.

## 10. Revision: roles with permissions (spec section 11)

### 10.0 Before starting

Commit the revised spec and this plan so the implementation starts from a clean tree. No new dependencies or env vars.

### 10.1 Backend: `src/permissions.js` (new)

- `PERMISSIONS`: the eight keys with an English description each, in display order.
- `SYSTEM_ROLES = { admin: { name: 'Admin', permissions }, sales: { name: 'Sales', permissions } }` from spec 11.3.
- `can(user, key)`, used by routes, `db.js`, `export.js` and the agent.

### 10.2 Backend: schema and migration (`db.js`)

`ensureAuthSchema()` stays one cached promise and one multi-statement query (Postgres runs it as one transaction):
1. `CREATE TABLE IF NOT EXISTS role (...)` and the `lower(name)` unique index.
2. `CREATE TABLE IF NOT EXISTS app_user` now without the old `role` column; `ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES role(role_id)`. The customer owner column and index stay.
3. A `DO` block that runs only when the built-in Admin role doesn't exist yet: insert Admin and Sales; if the `job_title` table exists, insert each title as a role with the Sales permissions (`ON CONFLICT DO NOTHING`) and point its sales users at it. The statements that touch the old columns use `EXECUTE`, so a fresh database without them still works.
4. On every start: users with `role_id IS NULL` get the role matching their old `role` column (when it exists), else Sales.

The old columns and the `job_title` table are not dropped (spec 11.4).

### 10.3 Backend: queries (`db.js`)

- `userSelect()` joins `role` and returns `role_id`, `r.name AS role`, `r.system_key AS role_key`, `r.permissions`. Every user read already goes through it.
- `createUser({ ..., roleId })` defaults to the Sales role. `updateUser` maps `roleId` → `role_id`. `setUserRole(id, roleId)`.
- `canOwnCustomers(id)` replaces `isSalesUser`. `listCustomerOwners()` for the new endpoint.
- Roles: `listRoles()` (with `user_count`), `getRole(id)`, `createRole`, `updateRole` (only the fields sent), `deleteRole`, `countRoleUsers`, `countCustomersOwnedByRole`, `getSystemRole(key)`. Duplicate names → `409` through `withConflict()`.
- Customer queries: `isAdmin(user)` becomes `can(user, 'customers.view_all')`.
- Job-title functions are removed.

### 10.4 Backend: auth and routes

- `auth.js`: `requireAuth` adds `role_id`, `role`, `permissions` to `req.user`. `requirePermission(key)` replaces `requireAdmin`. The token payload drops `role`.
- `routes/roles.js` (new, replaces `jobTitles.js`): the five endpoints from spec 11.6, with the rules from 11.5 (Admin locked, system roles not deletable, `view_all` or `own` required, `assign` needs `view_all`, own `users.manage`, owned customers, role in use).
- `routes/users.js`: `requirePermission('users.manage')`; `role_id` replaces `role` / `job_title_id` in `readUserFields`; the own-role and owns-customers checks use the target role's permissions; `reassign_to` uses `canOwnCustomers`.
- `routes/customers.js`: `isAdmin(req)` → `can(req.user, 'customers.view_all')`; `GET /owners` (before `/:id`); permission checks on assign, delete and export.
- `routes/knowledge.js`: `requirePermission('knowledge.manage')` on POST, PUT, DELETE.
- `app.js`: mount `/api/roles`, drop `/api/job-titles`, and put `requirePermission('agent.use')` on `/api/agent`.
- `export.js`: the Owner column depends on `customers.view_all`.
- `agent.js`: `ACCESS_RULES` keyed by `customers.view_all`.
- `scripts/make-admin.js`: assigns the built-in Admin role.

### 10.5 Backend: Swagger

`swagger.js`: `Role`, `RoleInput`, `Permission` replace `JobTitle` / `JobTitleInput`; `User` gets `role_id`, `role`, `role_key`, `permissions`; `UserCreate` / `UserUpdate` / `RoleUpdate` take `role_id`; the `Forbidden` response says "Permission required"; the description mentions roles. JSDoc for every changed route, including `403`s.

### 10.6 Frontend

1. `api.js`: `listRoles`, `listPermissions`, `createRole`, `updateRole`, `deleteRole`, `listCustomerOwners`; `setUserRole(id, roleId)`; job-title calls removed.
2. `auth.jsx`: `can(key)` on the context value.
3. `App.jsx`: nav items carry a `permission`; the Users page needs `users.manage`; `onChat` is only passed when the user has `agent.use`, and pages hide AI buttons when it is missing; the sidebar shows the role name through a `roleName()` helper in `i18n.jsx` (translates built-in roles that keep their default name).
4. `CustomersPage.jsx`, `DashboardPage.jsx`, `KnowledgePage.jsx`: permission checks from spec 11.8; owners come from `api.listCustomerOwners()`.
5. `UsersPage.jsx` / `UserForm.jsx`: role dropdowns from `listRoles()`, job title removed, new stat cards.
6. `RolesCard.jsx` + `RoleForm.jsx` (new, replace `JobTitlesCard.jsx`): role list with permission tags, add/edit modal with checkboxes, delete confirm.
7. `i18n.jsx`: remove job-title keys, add role and permission keys in `en` and `ar`.
8. `index.css`: rename the job-title styles to role styles and add permission tags/checkbox grid.

### 10.7 Docs

`README.md` and `CLAUDE.md`: roles and permissions replace job titles and the fixed sales/admin roles.

### 10.8 Verification

No test suite, so by hand against spec 11.9, using temporary users and roles that are deleted afterwards. **Ali's account and data are not changed** apart from the migration itself.
1. Restart the backend, then check that Ali is Admin, Ali d5 is Sales, Test d51 is Contracter (Sales permissions), and Legale exists with no users.
2. With a temporary admin token: create, edit and delete a role; check every `400`/`409` rule from 11.5.
3. A temporary "Sales Manager" user: sees all customers, `/owners` works, can bulk-assign, `403` on Users/Roles.
4. Remove `agent.use`, `knowledge.manage`, `customers.delete`, `customers.export` from a temporary role and check the `403`s.
5. `npm run lint` and `npm run build` in `frontend`; then check the Users page, Roles card and a restricted user's UI in Chrome (asking before logging Ali out).
