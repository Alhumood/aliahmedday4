# Plan 02: Admin Account to Manage Users and Their Customers

**Spec:** [`_specs/02_spec_admin_user_management.md`](../_specs/02_spec_admin_user_management.md) (approved for planning 2026-10-29, defaults from section 10)
**Status:** Approved (2026-10-29)

## 0. Before starting

- Commit the spec and this plan, so the branch is clean before implementation (`CLAUDE.md` workflow rule).
- No new dependencies or env vars are needed.

## 1. Backend: data layer (`backend/src/db.js`)

1. **Customer functions take the whole `user` instead of `userId`.** For example, `listCustomers(user, { name, salesUserId })` and `getCustomerById(user, id)`.
   - A shared helper builds the owner condition:
     - for sales, `sales_user_id = $n`;
     - for admin, no condition;
     - for admin with a filter, `sales_user_id = $n` or `sales_user_id IS NULL` (for `none`).
   - Ownership still lives inside the SQL, as in plan 01.
   - Merge `listCustomers` and `searchCustomersByName` into one `listCustomers(user, { name, salesUserId })`, because the filters now combine.
2. **Admin results include the owner's name.** Every customer query does `LEFT JOIN app_user u ON u.user_id = c.sales_user_id`. Add `u.name AS sales_user_name` to the column list only for admins, so sales responses stay exactly as they are.
3. **`createCustomer(user, data)` and `updateCustomer(user, id, data)`:**
   - For sales, `sales_user_id` is always `user.user_id` on create, and it is never changed on update.
   - For admin, `data.salesUserId` is used when present: `undefined` means don't change it, and `null` means unassign.
   - Because `COALESCE` can't tell "no value" apart from `null`, the admin update builds its `SET` list from the fields that are present.
4. **Users:**
   - `isSalesUser(id)` checks that a user exists and has the role `sales`.
   - `listUsersWithCounts()` returns every user, with a `customer_count` from a `LEFT JOIN` and `GROUP BY`.
   - `getUserWithCount(id)` returns one user with the same count.
   - `setUserRole(id, role)` changes the role.
   - `countCustomersOwnedBy(id)` counts a user's customers.
5. **`assignCustomers(ids, salesUserId)`** runs one `UPDATE ... WHERE customer_id = ANY($1) RETURNING ...`. If the number of updated rows doesn't match the number of ids, it throws an error with `status = 400`. Everything runs inside a transaction (`BEGIN`/`ROLLBACK`), so a bad id changes nothing.

## 2. Backend: auth (`backend/src/auth.js`)

- `requireAuth` checks the token as it does now, then loads the user with `db.getUserById(sub)`.
  - If the user is missing, it responds `401`.
  - Otherwise it sets `req.user` from the database row, so the role is always the current one.
  - `requireAuth` becomes `async` and passes database errors to `next(err)`.
- New `requireAdmin` responds `403 { error: "Admin access required" }` unless `req.user.role === "admin"`.

## 3. Backend: routes

1. **`routes/customers.js`**
   - Pass `req.user` into every `db` call.
   - `GET /` reads `sales_user_id` from the query only for admins, as an integer or `none`. Sales users' query parameter is ignored.
   - `POST` and `PUT` read `sales_user_id` from the body only for admins.
     - The value must be `null`, or a user id that `isSalesUser` accepts. Anything else gets `400 "sales_user_id must be a sales user"`.
     - `PUT` uses `"sales_user_id" in body` to tell an omitted field apart from `null`.
   - New `POST /assign` with `requireAdmin`.
     - It validates that `customer_ids` is a non-empty array of positive integers.
     - It validates the target with `isSalesUser`, or accepts `null`.
     - Then it calls `db.assignCustomers`.
     - **Register it before `/:id`**, so Express doesn't read "assign" as a customer id.
2. **New `routes/users.js`**, with `requireAdmin` on the whole router:
   - `GET /` lists every user with a customer count.
   - `GET /:id` returns one user, or `404`.
   - `PATCH /:id/role`
     - `role` must be `sales` or `admin`; anything else is `400`.
     - Changing your own account is `400 "You cannot change your own role"`.
     - A missing user is `404`.
     - Promoting a user who still owns customers is `409`, using `countCustomersOwnedBy`.
3. **`app.js`:** mount `app.use("/api/users", requireAuth, usersRoutes)`.

## 4. Backend: make-admin script

- New `backend/scripts/make-admin.js`:
  - It loads `dotenv/config` and reads the email from `process.argv[2]`.
  - It looks the user up with `getUserByEmail` and promotes them with `setUserRole(id, "admin")`.
  - It prints the result, then closes the pool.
  - It exits with code 1 if no email was given or the user doesn't exist, and exits 0 if the user is already an admin.
- Promoting a user who owns customers is refused, with a message to reassign them first (the same rule as the API).
- In `package.json`, add `"make-admin": "node scripts/make-admin.js"`.
- `vercel.json` only bundles `src/**`, so the script is never deployed. It is meant to be run locally.

## 5. Backend: agent (`backend/src/agent.js`)

- `executeTool(user, name, input)` passes `user` into `db.js`.
  - `get_customer_by_name` becomes `listCustomers(user, { name })`.
  - For admins, `add_customer` creates an unassigned customer (no `salesUserId`).
  - `update_customer` never passes `salesUserId`, so ownership can't change through the agent.
- `SYSTEM_PROMPT` becomes a function, `systemPrompt(user)`:
  - **sales:** the current line about "only the signed-in sales person's customers".
  - **admin:** "You are assisting an administrator who can see every customer; mention the owning sales person (sales_user_name) when listing customers, and 'Unassigned' when there is none."
- Conversations already store `userId`. They don't need to store the role, because the prompt is rebuilt on every call from the current `req.user`.

## 6. Backend: Swagger

- In `swagger.js`:
  - Add the schemas `UserWithCount`, `RoleUpdate`, `AssignInput` and `AdminCustomerInput`.
  - Add `sales_user_name` to `Customer`.
  - Add a reusable `components.responses.Forbidden`.
  - Add a section to `info.description` on testing as an admin.
- In the JSDoc:
  - Add the **Users** tag operations.
  - Document `POST /api/customers/assign`.
  - Document the admin-only `sales_user_id` query parameter on `GET /api/customers`, and the body field on POST and PUT. Each description says "admin only; ignored for sales users".
  - Add `403` to the admin-only operations.

## 7. Frontend

1. **`api.js`**
   - `listCustomers(name, salesUserId)` builds its query string with `URLSearchParams`.
   - New: `listUsers()`, `setUserRole(id, role)`, `assignCustomers(ids, salesUserId)`.
2. **`App.jsx`**
   - Show the `users` nav item only when `user.role === 'admin'`.
   - Add `customerOwner` state, the same way `chatPrompt` works, plus an `openCustomers(ownerFilter)` function. The Users page uses it for its "View customers" link.
3. **New `components/UsersPage.jsx`**
   - It uses the existing table, card, stat-card and toast classes.
   - It shows stat cards for total users, admins and sales.
   - Each row has a role `<select>`.
     - It is disabled on the admin's own row.
     - When a change fails (`409`/`400`), the API's message appears in the alert.
   - Each row also has a "View customers" button.
4. **`CustomersPage.jsx`** (admin only, when `user.role === 'admin'`)
   - Load the sales users once with `api.listUsers()`.
   - Add an owner `<select>` in the toolbar: All / Unassigned / each sales user. It starts from the `initialOwner` prop.
   - Add an **Owner** column, showing `sales_user_name` or "Unassigned".
   - Add a checkbox column, and an "Assign to…" select with an **Assign** button that appears when rows are selected.
   - Pass `salesUsers` into `CustomerForm`.
5. **`CustomerForm.jsx`**
   - Show an **Owner** `<select>` when a `salesUsers` prop is given. It defaults to the current owner, or to Unassigned for a new customer.
   - Submit `sales_user_id` (a number, or `null`).
6. **`DashboardPage.jsx`**
   - For admins, replace the "Missing details" stat card with "Unassigned customers", which counts customers whose `sales_user_id` is `null`.
   - Move "Missing details" into the existing Contact details card, which already shows the same data.
   - If keeping all four cards is preferred, add a fifth card instead.
7. **`i18n.jsx`**
   - Add every new key in both `en` and `ar`: nav Users, users page strings, owner, unassigned, assign, the role names, and so on.
   - Add `admin` to `roles`.
8. **`index.css`**
   - Styles for the checkbox column and the bulk-assign bar, using the existing variables.

## 8. Docs

- **`README.md`:** the admin role, `npm run make-admin -- <email>`, the users and assign endpoints, and how to hand out the existing unassigned customers.
- **`CLAUDE.md`:**
  - Customer `db.js` functions now take `user`, not `userId`.
  - Roles come from the database on every request.
  - Admin-only fields must be ignored for sales users.
  - The make-admin script.

## 9. Verification

There is no test suite, so verify by hand against spec section 9. All test users and customers are cleaned up afterwards.

1. Register users S1, S2 and A. Run `npm run make-admin -- <A's email>`, and check the unknown-email and already-admin cases.
2. **As S1:**
   - `/api/users`, `/api/users/{id}/role` and `/api/customers/assign` return `403`.
   - `?sales_user_id=` and a `sales_user_id` in the body don't change anything.
3. **As A:**
   - Check listing all customers, `?sales_user_id=none` and `?sales_user_id=<S1>`.
   - Create a customer with S1 as owner and one with no owner.
   - Reassign from S1 to S2, then check that S2 sees it and S1 doesn't.
   - Bulk assign; a bad id or an admin as the target gives `400` and changes nothing.
   - Delete a customer that belongs to someone else.
4. **Roles:**
   - A can't change their own role.
   - Promoting S1 while they own customers gives `409`.
   - Promote S2 after moving their customers away, then demote S2. S2's existing token immediately gets `403` on `/api/users`.
5. **Agent:**
   - `ANTHROPIC_API_KEY` is still invalid, so use the same mocked-client check as plan 01.
   - Admin tool calls return all customers with `sales_user_name`.
   - Sales tool calls stay scoped.
   - `update_customer` can't change the owner.
6. **Swagger:** repeat steps 2 and 3 using **Authorize**.
7. **Frontend:**
   - `npm run lint` and `npm run build` pass.
   - In Chrome, as the admin, check the Users page, the owner filter and column, the form's owner dropdown and bulk assign. Check that a sales user sees none of these. Check Arabic.

## 10. Risks / notes

- **Extra database query:** `requireAuth` now looks up the user on every request. It's a primary-key lookup, so the cost is small.
- **Duplicated owner checks:** the owner filter must never be skipped for sales users. All the branching lives in one `db.js` helper, so the check isn't repeated across routes.
- **Existing customers:** your 5 existing customers stay unassigned until an admin assigns them. Bulk assign makes that one step.
