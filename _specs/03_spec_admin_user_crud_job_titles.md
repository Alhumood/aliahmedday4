# Spec 03: Admin Adds, Edits and Deletes Users, and Manages Roles

**Status:** Approved (2026-10-29), with the defaults from section 10. **Revised and approved (2026-10-29): job titles became roles with permissions, see [section 11](#11-revision-job-titles-become-roles-with-permissions).** Sections 1–10 describe the first version; where they talk about job titles, section 11 replaces them.
**Date:** 2026-10-29
**Builds on:** [Spec 02: admin account to manage users and their customers](02_spec_admin_user_management.md)

## 1. Background

With spec 02, an admin can list users and switch a user between the `sales` and `admin` roles. There are three gaps:
- New users can only join by registering themselves.
- An admin can't fix a user's name or email, or delete an account.
- There is nowhere to record what a person actually does (for example "Account Manager" or "Sales Representative").

Spec 02 listed "deleting user accounts" and "admins resetting other users' passwords" as out of scope. **This spec brings both into scope.**

## 2. Goals

1. An admin can **add** a user directly, choosing the name, email, initial password, role and job title.
2. An admin can **edit** a user's name, email, role, job title and (optionally) password.
3. An admin can **delete** a user. The user's customers are never deleted with them.
4. An admin can **add new job titles**, plus rename and delete them (see Q2), and give a job title to any user.
5. ~~**Job title is a label, not a permission.** Access is still decided only by role (`sales` / `admin`). Giving someone the title "Sales Manager" doesn't change what they can see.~~ *(Replaced by section 11: roles carry permissions.)*
6. Sales users keep exactly their current access, and get `403` on every new endpoint.
7. Everything can be tested in the Swagger UI.

## 3. Out of scope

- ~~Permissions based on job title.~~ *(Now in scope, see section 11.)*
- Deactivating (suspending) a user without deleting them.
- Users editing their own profile or password (only admins edit users).
- Email invitations or password-reset emails.
- Audit logs.

## 4. Data model

### 4.1 New table `job_title`

| Column | Type | Notes |
|---|---|---|
| `job_title_id` | `SERIAL PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | Unique, ignoring upper/lower case (`Sales Rep` and `sales rep` count as the same) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

### 4.2 Change to `app_user`

Add a column `job_title_id INTEGER REFERENCES job_title(job_title_id)`.
- It can be empty: existing users and self-registered users start with no job title.

### 4.3 Schema setup

- Created on first use, the same way as the existing tables (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).
- **No job titles are pre-filled.** The admin adds them (see Q4).

## 5. Rules

| Action | Rule |
|---|---|
| Add user | `name`, `email`, `password` (at least 8 characters) are required. `role` defaults to `sales`. `job_title_id` is optional. An email that's already registered returns `409`. |
| Edit user | Every field is optional, and only the fields sent are changed. Sending `password` sets a new password. |
| Edit your own account | An admin can change their own name, email, job title and password. **Not their own role**, which keeps the rule from spec 02. |
| Change role to admin | Still refused with `409` while the user owns customers (spec 02 rule). |
| Delete user | An admin **cannot delete themselves**. The user's customers are moved to a sales user the admin picks, or left **unassigned** (see Q1). |
| Deleted user's session | Their existing token stops working on the very next request (`401`). This already works, because `requireAuth` loads the user from the database. |
| Add / rename job title | The name is required and trimmed. A duplicate name (ignoring case) returns `409`. |
| Delete job title | Allowed even while users have it. Those users are left with no job title (see Q2). |

## 6. Backend

### 6.1 User endpoints (admin only, under the existing `/api/users`)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/users` | `{ name, email, password, role?, job_title_id? }` | `201` the new user | `400` validation, `409` email taken |
| PATCH | `/api/users/{id}` | any of `{ name, email, password, role, job_title_id }` (`job_title_id: null` clears it) | `200` the updated user | `400` validation or own role, `404`, `409` email taken or owns customers |
| DELETE | `/api/users/{id}` | optional `{ reassign_to: <sales user id> \| null }` | `200` `{ deleted_user, customers_moved, reassigned_to }` | `400` own account or a bad `reassign_to`, `404` |

Notes:
- The existing `PATCH /api/users/{id}/role` stays as it is, so the current Users page keeps working. The new `PATCH /api/users/{id}` does the same job for `role`.
- Every user response gains `job_title_id` and `job_title` (the title's name, or `null`). This applies to the Users list, `GET /api/auth/me`, and the login and register responses.
- **Delete runs in one transaction:**
  1. Move the user's customers to `reassign_to`, or unassign them if it is `null` or missing.
  2. Delete the user.
  - If anything fails, nothing changes.
  - The current customer foreign key would block the delete, so the customers must be moved first.
- `reassign_to` must be a sales user, and it can't be the user being deleted.

### 6.2 Job title endpoints

| Method | Path | Who | Success | Errors |
|---|---|---|---|---|
| GET | `/api/job-titles` | admin | `200` list with `job_title_id, name, user_count` | `403` |
| POST | `/api/job-titles` | admin | `201` the new title | `400`, `403`, `409` duplicate |
| PATCH | `/api/job-titles/{id}` | admin | `200` the renamed title | `400`, `403`, `404`, `409` |
| DELETE | `/api/job-titles/{id}` | admin | `200` the deleted title (its users are left with no title) | `403`, `404` |

### 6.3 AI agent

There are no changes. The agent doesn't manage users or job titles.

## 7. Swagger / OpenAPI

- **Users tag:** add `POST /api/users`, `PATCH /api/users/{id}` and `DELETE /api/users/{id}`.
- **New Job Titles tag:** the four job-title endpoints.
- **New schemas:**
  - `UserCreate`, `UserUpdate`, `UserDelete`, `UserDeleteResult`
  - `JobTitle`, `JobTitleInput`
- **Existing schemas:** `User` and `UserWithCount` gain `job_title_id` and `job_title`.
- Every new operation documents its `403` response.

## 8. Frontend

- **Users page (admin):**
  - An **Add user** button opens a form with name, email, password, role and job title (a dropdown of the existing titles).
  - Each row gets an **Edit** button that opens the same form, filled in.
    - The password field is empty, and leaving it empty keeps the current password.
    - Role is disabled on the admin's own row.
  - Each row gets a **Delete** button, but not on the admin's own row. It opens a confirmation that:
    - shows how many customers the user owns;
    - if there are any, asks where to move them: Unassigned, or one of the sales users.
  - A new **Job title** column.
- **Job titles (admin):** a **Job titles** section on the Users page.
  - It lists each title with how many users have it.
  - It has an input with an **Add** button to create a title.
  - Each title can be renamed or deleted.
- **Sidebar:** the user block shows the job title under the name when there is one. Otherwise it shows the role, as it does today.
- **Translations:** every new string is added to both `en` and `ar`.
- **Sales users:** no visible changes.

## 9. Acceptance criteria

1. An admin can create a sales user and an admin user. Both can log in with the password the admin set.
2. Creating a user with an existing email returns `409`. A password under 8 characters returns `400`.
3. An admin can edit another user's name, email, role, job title and password. After a password change, the old password fails and the new one works.
4. An admin can edit their own name, email, job title and password, but not their own role (`400`).
5. Deleting a user who owns customers, with `reassign_to` = sales user S, moves those customers to S, and S sees them. Without `reassign_to`, the customers become unassigned. The customers are never deleted.
6. An admin cannot delete themselves (`400`). A deleted user's existing token returns `401`.
7. An admin can add, rename and delete job titles. Duplicates (ignoring case) return `409`. Deleting a title that users have leaves them with no job title.
8. Users and `/api/auth/me` show `job_title`.
9. A sales user gets `403` on every new user and job-title endpoint.
10. All of the above works through Swagger **Authorize**.
11. In the frontend, the admin can add, edit and delete users, choose where a deleted user's customers go, and add, rename and delete job titles. The sidebar shows the job title. A sales user sees none of the admin controls. Everything works in English and Arabic.

## 10. Decisions

The user approved the defaults on 2026-10-29.

- **Q1: A deleted user's customers:** the admin chooses in the delete dialog. They are moved to a sales user (`reassign_to`), or left unassigned if none is chosen. They are never deleted.
- **Q2: Managing job titles:** add, rename and delete. Deleting a title that users have leaves them with no job title.
- **Q3: Passwords:** admins can set a user's password when adding or editing them.
- **Q4: Starting job titles:** the list starts empty, and admins add the titles.

## 11. Revision: job titles become roles with permissions

**Approved 2026-10-29**, with the defaults listed in 11.10.

### 11.1 Why

Two separate things used to describe a user: the fixed role (`sales` / `admin`), which decided access, and a job title, which was only a label. The user asked for the job titles section to become **roles**: an admin creates named roles, and each role decides what its users can do.

### 11.2 Goals

1. An admin can create, rename and delete roles, and choose each role's **permissions** from a fixed list.
2. Each user has exactly one role. Job titles are removed from the API and the UI, because roles take their place.
3. Nothing changes for anyone on migration: today's admins and sales users keep exactly the access they have now.
4. Every access check (backend, AI agent and frontend) uses permissions instead of `role === 'admin'`.
5. Everything can be tested in the Swagger UI.

Out of scope: several roles for one user, permissions for a single user, permissions for single customers or articles, and audit logs.

### 11.3 Permissions

The list is fixed in code (`backend/src/permissions.js`). Admins choose from it and can't add new keys.

| Key | Allows | Admin | Sales |
|---|---|---|---|
| `customers.view_all` | See and edit **every** customer, see owners and filter by owner. Without it, a user only sees their own customers. | ✓ | |
| `customers.own` | Customers can be assigned to this user. Replaces "only sales users can own customers". | | ✓ |
| `customers.delete` | Delete the customers they can see. | ✓ | ✓ |
| `customers.assign` | Bulk-assign customers (`POST /api/customers/assign`). Needs `customers.view_all`. | ✓ | |
| `customers.export` | Export customers to Excel or PDF. | ✓ | ✓ |
| `knowledge.manage` | Add, edit and delete knowledge articles. Everyone can read them. | ✓ | ✓ |
| `agent.use` | Use the AI Assistant. | ✓ | ✓ |
| `users.manage` | The Users page: add, edit and delete users, and manage roles. | ✓ | |

Every logged-in user can still read the knowledge bank, and add and edit the customers they can see.

A role must have `customers.view_all` or `customers.own` (or both), otherwise its users could neither see nor own any customer (`400`).

### 11.4 Data model

New table `role`:

| Column | Type | Notes |
|---|---|---|
| `role_id` | `SERIAL PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | Unique, ignoring case |
| `permissions` | `TEXT[] NOT NULL DEFAULT '{}'` | Only keys from 11.3 |
| `system_key` | `TEXT UNIQUE` | `'admin'` or `'sales'` for the two built-in roles, `NULL` for custom roles |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

`app_user` gets `role_id INTEGER REFERENCES role(role_id)`.

**Migration** (runs once on first use, in one transaction, the first time the built-in roles are created):
1. Create **Admin** and **Sales** with the permissions in 11.3.
2. Every existing job title (for example Contracter and Legale) becomes a **custom role with the Sales permissions**. Sales users who had that title move to it, so their access doesn't change. Admins who had a title stay Admin.
3. Every other user gets Admin or Sales from their old `role`.

The old `app_user.role` and `app_user.job_title_id` columns and the `job_title` table are **left in place but no longer used**, so the backend that is currently deployed keeps working against the same database until this version is deployed. They can be dropped in a later cleanup. On every start, users with no `role_id` (for example someone registered through the old deployment) get one from their old `role`.

### 11.5 Rules

| Action | Rule |
|---|---|
| Built-in Admin | Can't be renamed, deleted or have its permissions changed (`400`). It always has every permission except `customers.own`. |
| Built-in Sales | Can't be deleted (`400`). Its name and permissions can be changed. Self-registered users get it. |
| Custom role | Created, renamed, deleted, permissions changed. The name is required, trimmed, at most 100 characters, and unique ignoring case (`409`). |
| Delete a role | Refused with `409` while users have it. Move them first. |
| Your own role | An admin can't change their own role (spec 02 rule stays), and can't remove `users.manage` from their own role (`400`). Together with "you can't delete yourself", this means someone can always manage users. |
| Owning customers | Moving a user to a role without `customers.own` while they own customers is `409`. Removing `customers.own` from a role while any of its users own customers is `409`. (This generalizes the spec 02 "can't make them admin" rule.) |
| Changes | Apply on the user's next request, because `requireAuth` already reloads the user from the database. |
| Unknown permission key | `400`. |

### 11.6 Backend

- **Auth:** `requireAuth` sets `req.user = { user_id, email, role_id, role, permissions }`. `requireAdmin` is replaced by `requirePermission(key)`, which returns `403`.
- **User responses** (`/api/auth/me`, login, register, Users endpoints) return `role_id`, `role` (the role's name), `role_key` (`'admin'`, `'sales'` or `null`) and `permissions`. `job_title_id` and `job_title` are removed.
- **Customers:** `ownerScope()` and `customerSelect()` check `customers.view_all`. `isSalesUser()` becomes `canOwnCustomers()` (checks `customers.own`). The owner inputs (`sales_user_id` in a body or query) are ignored for users without `customers.view_all`.
- **New `GET /api/customers/owners`** (needs `customers.view_all`): the users who can own customers (`user_id`, `name`), for the owner filter, the customer form and bulk assign. Before, these pages read `/api/users`, which a "Sales Manager" role without `users.manage` couldn't call.
- **Endpoints:**

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/roles` | `users.manage` | `role_id, name, permissions, system_key, user_count` |
| GET | `/api/roles/permissions` | `users.manage` | The fixed permission list (`key`, `description`) |
| POST | `/api/roles` | `users.manage` | `{ name, permissions }` → `201` |
| PATCH | `/api/roles/{id}` | `users.manage` | Any of `{ name, permissions }` |
| DELETE | `/api/roles/{id}` | `users.manage` | `409` while users have it |
| POST, PATCH | `/api/users`, `/api/users/{id}` | `users.manage` | Take `role_id` instead of `role` and `job_title_id`. `role_id` defaults to Sales on create. |
| PATCH | `/api/users/{id}/role` | `users.manage` | Takes `{ role_id }` |
| DELETE | `/api/users/{id}` | `users.manage` | `reassign_to` must be a user who can own customers |
| POST | `/api/customers/assign` | `customers.assign` | |
| DELETE | `/api/customers/{id}` | `customers.delete` | |
| GET | `/api/customers/export` | `customers.export` | The Owner column is included with `customers.view_all` |
| POST, PUT, DELETE | `/api/knowledge…` | `knowledge.manage` | Reading stays open to every user |
| POST, DELETE | `/api/agent/chat…` | `agent.use` | |
| — | `/api/job-titles/*` | — | **Removed** |

- **Agent:** the system prompt describes access from `customers.view_all` instead of the role name. The agent still has no delete tool and no owner field.
- **`npm run make-admin`** gives the user the built-in Admin role.

### 11.7 Swagger

A **Roles** tag replaces **Job Titles**. New schemas `Role`, `RoleInput`, `Permission`. `User`, `UserCreate`, `UserUpdate` and `RoleUpdate` use `role_id` / `role` / `permissions`. Every protected operation documents its `403`.

### 11.8 Frontend

- `auth.jsx` gets `can(key)`. Every `role === 'admin'` check becomes a `can(...)` check:
  - Users nav item and page: `users.manage`. AI Assistant nav item and every "Ask AI" / "Chat with agent" button: `agent.use`.
  - Owner column, owner filter, Owner field in the customer form, dashboard Unassigned card: `customers.view_all`. Bulk select and assign: `customers.assign`. Delete buttons: `customers.delete`. Export menu: `customers.export`.
  - Knowledge add/edit/delete: `knowledge.manage`.
- **Users page:** the Job title column goes away. The Role dropdown lists every role. The user form has one Role dropdown. The stat cards show total users, customer owners and user managers.
- **Roles card** (replaces Job titles): each role shows its name, a "Built-in" tag, its user count and its permissions. **Add role** and **Edit** open a form with the name and one checkbox per permission. The Admin role can't be edited, and built-in roles can't be deleted.
- **Sidebar:** the role name under the user's name. The built-in roles show their translated name while they keep their original name.
- Every new string is in both `en` and `ar`, including each permission's label.

### 11.9 Acceptance criteria

1. After the migration, the existing admin and sales users can do exactly what they could before. Test d51 has the role **Contracter** with the Sales permissions. Legale is a role with no users. The job title column and section are gone.
2. An admin can create a role "Sales Manager" with `customers.view_all` and `customers.assign`. A user given it sees every customer, the owner filter and bulk assign, and gets `403` on the Users and Roles endpoints.
3. Removing `agent.use` from a role hides the AI Assistant for its users, and `/api/agent/chat` returns `403` for them.
4. Removing `knowledge.manage` hides the article add/edit/delete buttons, and those endpoints return `403`. Removing `customers.delete` / `customers.export` does the same for those features.
5. A role in use can't be deleted (`409`). The built-in Admin role can't be changed (`400`). An admin can't remove `users.manage` from their own role (`400`).
6. Moving a user who owns customers to a role without `customers.own` returns `409`.
7. All of the above works through Swagger **Authorize**, and in the frontend in English and Arabic.

### 11.10 Decisions

The user approved the proposed defaults on 2026-10-29:
- **Existing job titles** become custom roles with the Sales permissions.
- **Deleting a role that users have** is refused until they are moved.
- **Permissions:** the eight keys in 11.3.
- **The built-in Sales role** can be renamed and its permissions changed. Admin is locked.
