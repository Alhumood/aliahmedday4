# Spec 02: Admin Account to Manage Users and Their Customers

**Status:** Approved for planning (2026-10-29), with the defaults from section 10
**Date:** 2026-10-29
**Builds on:** [Spec 01: user registration, login and per-user customer access](01_spec_userlogin_registration.md)

## 1. Background

Spec 01 gave every user the role `sales`. Each sales user can only see and change the customers assigned to them (`customer.sales_user_id`).

Nobody can see all customers or move a customer from one sales person to another. The customers that existed before spec 01 are still unassigned and invisible to everyone. Fixing either today means running SQL by hand.

This spec adds an `admin` role. An admin can see every user and every customer, assign customers to sales users, and manage users' roles.

## 2. Goals

1. There is a safe way to create the first admin account, without anyone being able to make themselves an admin through the API.
2. An admin can list all users, with how many customers each one has.
3. An admin can see, search, create, edit and delete **any** customer, and can see who owns each one.
4. An admin can assign or reassign a customer to any sales user, including the existing unassigned customers.
5. An admin can promote a user to admin or demote one to sales.
6. Sales users keep exactly the access they have today (spec 01). None of the new admin endpoints or fields work for them.
7. The AI agent gives an admin the same all-customer view, and still limits sales users to their own customers.
8. Everything can be tested in the Swagger UI.

## 3. Out of scope

- Deleting or deactivating user accounts.
- Admins resetting other users' passwords.
- Roles other than `sales` and `admin`.
- Audit logs of who changed what.
- Changes to the knowledge bank (it stays shared by all logged-in users).

## 4. Roles and permissions

| Action | sales | admin |
|---|---|---|
| Register or log in | ✅ | ✅ |
| See / search customers | Own only | All, with owner shown |
| Create customer | Assigned to self | Assigned to any sales user, or unassigned |
| Edit / delete customer | Own only (`404` otherwise) | Any |
| Change a customer's owner | ❌ (field ignored) | ✅ |
| List users | ❌ `403` | ✅ |
| Change a user's role | ❌ `403` | ✅ (but not their own role) |
| AI agent | Own customers only | All customers |

A customer can only be assigned to a user with the role `sales`. Admins manage customers but don't own them.

## 5. Creating the first admin

- Registration through the API **always** creates a `sales` user, exactly as in spec 01. A `role` field in the request is still ignored.
- A new backend script, `npm run make-admin -- <email>`, promotes an **already registered** user to `admin`. It runs locally against `DATABASE_URL`. It prints an error if the email doesn't exist, and does nothing if the user is already an admin.
- After that, admins can promote or demote other users through the API or the UI (section 6.3).
- An admin cannot change their own role. This prevents the last admin from accidentally removing themselves.

## 6. Backend behaviour

### 6.1 Role is checked on every request

The role is read from the database on each request, not from the token. Otherwise a demoted admin would keep admin rights until their token expired, which can take up to 8 hours.

`requireAuth` loads the user by the token's `sub`. If the user no longer exists, it responds `401`. It then sets `req.user = { user_id, email, role }` from the database row. This adds one small primary-key query per request.

A new middleware, `requireAdmin`, responds `403 { error: "Admin access required" }` when `req.user.role !== 'admin'`.

### 6.2 Customer endpoints (existing paths, role-aware)

| Endpoint | sales (unchanged) | admin |
|---|---|---|
| `GET /api/customers` | Own customers | All customers. Optional filter `?sales_user_id=<id>`, or `?sales_user_id=none` for unassigned. Can be combined with `?name=`. |
| `GET /api/customers/{id}` | Own, else `404` | Any, else `404` |
| `POST /api/customers` | Assigned to self, `sales_user_id` ignored | `sales_user_id` in body (a sales user's id, or `null` for unassigned). If omitted, the customer is unassigned. |
| `PUT /api/customers/{id}` | Own, `sales_user_id` ignored | Any. A `sales_user_id` in the body reassigns the customer (`null` unassigns it). |
| `DELETE /api/customers/{id}` | Own, else `404` | Any, else `404` |

Admin responses include an extra field `sales_user_name`, so the owner's name can be shown without a second request. It is `null` when the customer is unassigned.

If an admin sends a `sales_user_id` that doesn't exist, or that belongs to an admin, the API responds `400 { error: "sales_user_id must be a sales user" }`.

### 6.3 New user-management endpoints (admin only)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| GET | `/api/users` | — | `200` list of users: `user_id, name, email, role, created_at, customer_count` | `403` |
| GET | `/api/users/{id}` | — | `200` the user, with `customer_count` | `403`, `404` |
| PATCH | `/api/users/{id}/role` | `{ role: "sales" \| "admin" }` | `200` the updated user | `400` invalid role or own account; `403`; `404` |

**Demoting rule:** an admin can be demoted to sales. A sales user who is promoted to admin and still owns customers is refused with `409 { error: "Reassign this user's customers before making them an admin" }`, because admins can't own customers (section 4).

To see one user's customers, use `GET /api/customers?sales_user_id={id}`. No separate endpoint is needed.

### 6.4 Bulk assign (admin only)

`POST /api/customers/assign` with body `{ customer_ids: [1, 2, 3], sales_user_id: 5 }` (or `null` to unassign).

- Assigns all listed customers in one statement and returns the updated customers.
- Responds `400` if the target isn't a sales user, or if any id doesn't exist.

This makes it practical to hand out the existing unassigned customers in one step.

### 6.5 AI agent

- `executeTool` receives the full `req.user` (id and role) instead of only the id.
- For an **admin**, the customer tools work across all customers, and their results include `sales_user_id` and `sales_user_name`.
  - `add_customer` creates an unassigned customer.
  - Admins don't get any new agent tools for reassigning customers or changing roles. Those stay in the UI and REST API, so no ownership change happens through natural language.
- For a **sales** user, nothing changes from spec 01.
- The system prompt line about access depends on the role. For an admin it says the assistant can see every sales person's customers and should mention the owner when listing them.
- As before, the role and user id always come from the authenticated request, never from the model's input.

## 7. Swagger / OpenAPI

- New **Users** tag for `/api/users` and `/api/users/{id}/role`, with `403` documented.
- New schemas:
  - `UserWithCount`
  - `RoleUpdate`
  - `AssignInput`
  - `AdminCustomerInput`, which is `CustomerInput` plus `sales_user_id`
- Update the `Customer` schema:
  - `sales_user_name` is added (read-only, admin responses only).
  - `sales_user_id` is described as "set from the token for sales users; settable by admins".
- On the customer endpoints:
  - Document the admin-only `sales_user_id` query parameter and body field.
  - Add a reusable `Forbidden` (`403`) response.
- The API description explains how to try the admin features: make an admin with `npm run make-admin`, log in as that user, then click **Authorize**.

## 8. Frontend

- **Sidebar:** admins see a new **Users** item. The role label shows "Admin" or "Sales" (translated).
- **Users page (admin only):**
  - A table of users with name, email, role, customer count and created date.
  - Each row has:
    - a role switch (Sales/Admin), disabled for the admin's own row;
    - a **View customers** link that opens the Customers page filtered to that user.
- **Customers page for admins:**
  - An **Owner** column.
  - An owner filter: All / Unassigned / each sales user.
  - Checkboxes with an **Assign to…** action for bulk assignment.
- **Customer form for admins:** an **Owner** dropdown (sales users plus "Unassigned").
- **Dashboard for admins:** the existing cards cover all customers, plus a new "Unassigned customers" card.
- **Sales users:** the UI is unchanged.
- **Translations:** every new string is added to both `en` and `ar`.

## 9. Acceptance criteria

1. `npm run make-admin -- <email>` promotes an existing user. An unknown email prints an error and changes nothing.
2. Registering with `"role": "admin"` still creates a `sales` user.
3. A sales user calling `/api/users`, `/api/users/{id}/role` or `/api/customers/assign` gets `403`. A `sales_user_id` they send in a customer request is still ignored, and `?sales_user_id=` doesn't widen their results.
4. An admin's `GET /api/customers` returns every customer with `sales_user_name`. `?sales_user_id=none` returns only the unassigned ones.
5. An admin can create, edit, delete and reassign any customer. Assigning to a non-existent user or to an admin returns `400`.
6. After an admin assigns customer X to sales user S, S sees X and the previous owner no longer does.
7. Bulk assigning the existing unassigned customers to a sales user works in one call.
8. An admin can promote and demote other users, but not themselves. Promoting a user who still owns customers returns `409`.
9. A demoted admin loses admin access on their very next request, with the same token.
10. An admin asking the agent "get all customers" gets every customer with owners. A sales user still gets only their own.
11. All of the above works in the Swagger UI.
12. In the frontend, an admin sees the Users page, the owner column and filter, the owner dropdown and bulk assign. A sales user sees none of them. Everything works in English and Arabic.

## 10. Decisions

The user asked for the plan on 2026-10-29, so these are the defaults. They can still be changed before implementation starts.

- **Q1: Creating the first admin:** a local script, `npm run make-admin -- <email>`.
- **Q2: Can admins own customers?** No. Only sales users own customers.
- **Q3: AI agent for admins:** it sees all customers, with their owners.
- **Q4: Customers an admin creates without an owner:** they are allowed and stay unassigned.
