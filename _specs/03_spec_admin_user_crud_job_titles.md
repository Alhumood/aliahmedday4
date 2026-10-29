# Spec 03: Admin Adds, Edits and Deletes Users, and Manages Job Titles

**Status:** Approved (2026-10-29), with the defaults from section 10
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
5. **Job title is a label, not a permission.** Access is still decided only by role (`sales` / `admin`). Giving someone the title "Sales Manager" doesn't change what they can see.
6. Sales users keep exactly their current access, and get `403` on every new endpoint.
7. Everything can be tested in the Swagger UI.

## 3. Out of scope

- Permissions based on job title.
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
