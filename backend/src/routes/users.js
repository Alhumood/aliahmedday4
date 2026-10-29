import { Router } from "express";
import * as db from "../db.js";
import { requirePermission, hashPassword, EMAIL_RE, MIN_PASSWORD_LENGTH } from "../auth.js";

const router = Router();
router.use(requirePermission("users.manage"));

// Validates the user fields in body and converts them for db.createUser/updateUser.
// On create, name, email and password are required. Returns { fields } or { error }.
async function readUserFields(body, { creating }) {
  const fields = {};
  const { name, email, password, role_id: roleId } = body ?? {};
  if (creating || name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return { error: "name is required" };
    fields.name = name.trim();
  }
  if (creating || email !== undefined) {
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) return { error: "a valid email is required" };
    fields.email = email.trim().toLowerCase();
  }
  if (creating || password !== undefined) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    fields.passwordHash = await hashPassword(password);
  }
  if (roleId !== undefined) {
    if (!(Number.isInteger(roleId) && (await db.getRole(roleId)))) return { error: "role_id must be an existing role" };
    fields.roleId = roleId;
  }
  return { fields };
}

// Checks moving user `id` to `roleId`. Returns { status, error } when it is not allowed, else null.
async function checkRoleChange(req, id, current, roleId) {
  if (roleId === current.role_id) return null;
  if (id === req.user.user_id) return { status: 400, error: "You cannot change your own role" };
  const role = await db.getRole(roleId);
  if (!role.permissions.includes("customers.own") && (await db.countCustomersOwnedBy(id)) > 0) {
    return { status: 409, error: "Reassign this user's customers before giving them a role that cannot own customers" };
  }
  return null;
}

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: List all users with their customer counts (users.manage)
 *     responses:
 *       200:
 *         description: Array of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/UserWithCount' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json(await db.listUsersWithCounts());
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user with their customer count (users.manage)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserWithCount' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: User not found }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const user = await db.getUserWithCount(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Add a user (users.manage)
 *     description: role_id defaults to the built-in Sales role. The admin sets the initial password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UserCreate' }
 *     responses:
 *       201:
 *         description: The new user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserWithCount' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: Email is already registered }
 */
router.post("/", async (req, res, next) => {
  try {
    const { fields, error } = await readUserFields(req.body, { creating: true });
    if (error) return res.status(400).json({ error });
    const user = await db.createUser(fields);
    res.status(201).json(await db.getUserWithCount(user.user_id));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   patch:
 *     tags: [Users]
 *     summary: Edit a user (users.manage)
 *     description: |
 *       Only the fields sent are changed. Sending `password` sets a new password.
 *       You cannot change your own role, and a user who owns customers cannot get a role without `customers.own`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UserUpdate' }
 *     responses:
 *       200:
 *         description: The updated user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserWithCount' }
 *       400: { description: Validation error, or changing your own role }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: User not found }
 *       409: { description: Email is already registered, or the user still owns customers and the new role cannot own them }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { fields, error } = await readUserFields(req.body, { creating: false });
    if (error) return res.status(400).json({ error });
    const current = await db.getUserById(id);
    if (!current) return res.status(404).json({ error: "User not found" });
    if (fields.roleId !== undefined) {
      const refused = await checkRoleChange(req, id, current, fields.roleId);
      if (refused) return res.status(refused.status).json({ error: refused.error });
    }
    await db.updateUser(id, fields);
    res.json(await db.getUserWithCount(id));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user (users.manage)
 *     description: |
 *       The user's customers are never deleted. They move to `reassign_to` (a user who can own customers),
 *       or become unassigned when it is null or omitted. You cannot delete yourself.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UserDelete' }
 *     responses:
 *       200:
 *         description: What was deleted and where the customers went
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserDeleteResult' }
 *       400: { description: Deleting your own account, or reassign_to is not another user who can own customers }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: User not found }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    if (id === req.user.user_id) return res.status(400).json({ error: "You cannot delete your own account" });
    const reassignTo = req.body?.reassign_to ?? null;
    if (reassignTo !== null && (reassignTo === id || !Number.isInteger(reassignTo) || !(await db.canOwnCustomers(reassignTo)))) {
      return res.status(400).json({ error: "reassign_to must be another user who can own customers, or null" });
    }
    const result = await db.deleteUser(id, reassignTo);
    if (!result) return res.status(404).json({ error: "User not found" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/users/{id}/role:
 *   patch:
 *     tags: [Users]
 *     summary: Change a user's role (users.manage)
 *     description: You cannot change your own role. A user who still owns customers cannot get a role without `customers.own`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UserRoleUpdate' }
 *     responses:
 *       200:
 *         description: The updated user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400: { description: Unknown role_id, or trying to change your own role }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: User not found }
 *       409: { description: The user still owns customers and the role cannot own customers }
 */
router.patch("/:id/role", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { role_id: roleId } = req.body ?? {};
    if (!(Number.isInteger(roleId) && (await db.getRole(roleId)))) {
      return res.status(400).json({ error: "role_id must be an existing role" });
    }
    if (id === req.user.user_id) return res.status(400).json({ error: "You cannot change your own role" });
    const current = await db.getUserById(id);
    if (!current) return res.status(404).json({ error: "User not found" });
    const refused = await checkRoleChange(req, id, current, roleId);
    if (refused) return res.status(refused.status).json({ error: refused.error });
    res.json(await db.setUserRole(id, roleId));
  } catch (err) {
    next(err);
  }
});

export default router;
