import { Router } from "express";
import * as db from "../db.js";
import { requirePermission } from "../auth.js";
import { PERMISSIONS, PERMISSION_KEYS } from "../permissions.js";

const router = Router();
router.use(requirePermission("users.manage"));

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

// Validates name and permissions from the body. On create both are required.
// Returns { fields } or { error }; permissions come back de-duplicated in the PERMISSIONS order.
function readRoleFields(body, { creating }) {
  const fields = {};
  const { name, permissions } = body ?? {};
  if (creating || name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return { error: "name is required (at most 100 characters)" };
    }
    fields.name = name.trim();
  }
  if (creating || permissions !== undefined) {
    if (!Array.isArray(permissions) || !permissions.every((key) => PERMISSION_KEYS.includes(key))) {
      return { error: `permissions must be an array of: ${PERMISSION_KEYS.join(", ")}` };
    }
    const keys = PERMISSION_KEYS.filter((key) => permissions.includes(key));
    if (!keys.includes("customers.view_all") && !keys.includes("customers.own")) {
      return { error: "A role needs customers.view_all or customers.own" };
    }
    if (keys.includes("customers.assign") && !keys.includes("customers.view_all")) {
      return { error: "customers.assign needs customers.view_all" };
    }
    fields.permissions = keys;
  }
  return { fields };
}

/**
 * @openapi
 * /api/roles:
 *   get:
 *     tags: [Roles]
 *     summary: List roles with their permissions and how many users have each (users.manage)
 *     responses:
 *       200:
 *         description: Array of roles, built-in roles first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Role' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json(await db.listRoles());
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/roles/permissions:
 *   get:
 *     tags: [Roles]
 *     summary: The fixed list of permissions a role can grant (users.manage)
 *     responses:
 *       200:
 *         description: Array of permissions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Permission' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/permissions", (_req, res) => {
  res.json(PERMISSIONS);
});

/**
 * @openapi
 * /api/roles:
 *   post:
 *     tags: [Roles]
 *     summary: Add a role (users.manage)
 *     description: A role needs `customers.view_all` or `customers.own`, and `customers.assign` needs `customers.view_all`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RoleInput' }
 *     responses:
 *       201:
 *         description: The new role
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Role' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: A role with this name already exists (case-insensitive) }
 */
router.post("/", async (req, res, next) => {
  try {
    const { fields, error } = readRoleFields(req.body, { creating: true });
    if (error) return res.status(400).json({ error });
    res.status(201).json(await db.createRole(fields));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/roles/{id}:
 *   patch:
 *     tags: [Roles]
 *     summary: Rename a role or change its permissions (users.manage)
 *     description: |
 *       Only the fields sent are changed. The built-in Admin role cannot be changed.
 *       You cannot remove `users.manage` from your own role, and `customers.own` cannot be removed
 *       while users with this role own customers.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RoleUpdate' }
 *     responses:
 *       200:
 *         description: The updated role
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Role' }
 *       400: { description: Validation error, the Admin role, or removing users.manage from your own role }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Role not found }
 *       409: { description: Duplicate name, or users with this role still own customers }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { fields, error } = readRoleFields(req.body, { creating: false });
    if (error) return res.status(400).json({ error });
    const role = await db.getRole(id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.system_key === "admin") return res.status(400).json({ error: "The built-in Admin role cannot be changed" });
    const { permissions } = fields;
    if (permissions) {
      if (id === req.user.role_id && !permissions.includes("users.manage")) {
        return res.status(400).json({ error: "You cannot remove users.manage from your own role" });
      }
      if (
        role.permissions.includes("customers.own") &&
        !permissions.includes("customers.own") &&
        (await db.countCustomersOwnedByRole(id)) > 0
      ) {
        return res.status(409).json({ error: "Users with this role still own customers; reassign them first" });
      }
    }
    res.json(await db.updateRole(id, fields));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/roles/{id}:
 *   delete:
 *     tags: [Roles]
 *     summary: Delete a role (users.manage)
 *     description: Built-in roles cannot be deleted, and a role cannot be deleted while users have it.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The deleted role
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Role' }
 *       400: { description: Built-in role }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Role not found }
 *       409: { description: Users still have this role }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const role = await db.getRole(id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.system_key) return res.status(400).json({ error: "Built-in roles cannot be deleted" });
    if (role.user_count > 0) {
      return res.status(409).json({ error: "Move this role's users to another role before deleting it" });
    }
    res.json(await db.deleteRole(id));
  } catch (err) {
    next(err);
  }
});

export default router;
