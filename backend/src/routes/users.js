import { Router } from "express";
import * as db from "../db.js";
import { requireAdmin } from "../auth.js";

const router = Router();
router.use(requireAdmin);

const ROLES = ["sales", "admin"];

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
      return res.status(409).json({ error: "Reassign this user's customers before making them an admin" });
    }
    res.json(await db.setUserRole(id, role));
  } catch (err) {
    next(err);
  }
});

export default router;
