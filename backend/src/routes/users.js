import { Router } from "express";
import * as db from "../db.js";
import { requireAdmin, hashPassword, EMAIL_RE, MIN_PASSWORD_LENGTH } from "../auth.js";

const router = Router();
router.use(requireAdmin);

const ROLES = ["sales", "admin"];

// Validates the user fields in body and converts them for db.createUser/updateUser.
// On create, name, email and password are required. Returns { fields } or { error }.
async function readUserFields(body, { creating }) {
  const fields = {};
  const { name, email, password, role, job_title_id: jobTitleId } = body ?? {};
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
  if (role !== undefined) {
    if (!ROLES.includes(role)) return { error: "role must be 'sales' or 'admin'" };
    fields.role = role;
  }
  if (jobTitleId !== undefined) {
    if (jobTitleId !== null && !(Number.isInteger(jobTitleId) && (await db.jobTitleExists(jobTitleId)))) {
      return { error: "job_title_id must be an existing job title or null" };
    }
    fields.jobTitleId = jobTitleId;
  }
  return { fields };
}

const OWNS_CUSTOMERS = "Reassign this user's customers before making them an admin";

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
 *     summary: List all users with their customer counts (admin only)
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
 *     summary: Get a user with their customer count (admin only)
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
 *     summary: Add a user (admin only)
 *     description: Role defaults to sales. The admin sets the initial password.
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
 *     summary: Edit a user (admin only)
 *     description: |
 *       Only the fields sent are changed. Sending `password` sets a new password; `job_title_id: null` clears the title.
 *       Admins cannot change their own role, and a user who owns customers cannot be made an admin.
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
 *       409: { description: Email is already registered, or the user still owns customers }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { fields, error } = await readUserFields(req.body, { creating: false });
    if (error) return res.status(400).json({ error });
    const current = await db.getUserById(id);
    if (!current) return res.status(404).json({ error: "User not found" });
    if (fields.role !== undefined && fields.role !== current.role) {
      if (id === req.user.user_id) return res.status(400).json({ error: "You cannot change your own role" });
      if (fields.role === "admin" && (await db.countCustomersOwnedBy(id)) > 0) {
        return res.status(409).json({ error: OWNS_CUSTOMERS });
      }
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
 *     summary: Delete a user (admin only)
 *     description: |
 *       The user's customers are never deleted. They move to `reassign_to` (a sales user),
 *       or become unassigned when it is null or omitted. Admins cannot delete themselves.
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
 *       400: { description: Deleting your own account, or reassign_to is not another sales user }
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
    if (reassignTo !== null && (reassignTo === id || !Number.isInteger(reassignTo) || !(await db.isSalesUser(reassignTo)))) {
      return res.status(400).json({ error: "reassign_to must be another sales user or null" });
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
 *     summary: Change a user's role (admin only)
 *     description: Admins cannot change their own role. A user who still owns customers cannot be made an admin.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RoleUpdate' }
 *     responses:
 *       200:
 *         description: The updated user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400: { description: Invalid role, or trying to change your own role }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: User not found }
 *       409: { description: The user still owns customers }
 */
router.patch("/:id/role", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { role } = req.body ?? {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: "role must be 'sales' or 'admin'" });
    if (id === req.user.user_id) return res.status(400).json({ error: "You cannot change your own role" });
    if (!(await db.getUserById(id))) return res.status(404).json({ error: "User not found" });
    if (role === "admin" && (await db.countCustomersOwnedBy(id)) > 0) {
      return res.status(409).json({ error: OWNS_CUSTOMERS });
    }
    res.json(await db.setUserRole(id, role));
  } catch (err) {
    next(err);
  }
});

export default router;
