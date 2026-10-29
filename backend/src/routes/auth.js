import { Router } from "express";
import * as db from "../db.js";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../auth.js";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isBlank = (value) => typeof value !== "string" || !value.trim();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new sales user
 *     description: The role is always `sales`; a role in the body is ignored. Returns a token to use with **Authorize**.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterInput' }
 *     responses:
 *       201:
 *         description: Registered user and access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400: { description: Validation error }
 *       409: { description: Email is already registered }
 */
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body ?? {};
    if (isBlank(name)) return res.status(400).json({ error: "name is required" });
    if (isBlank(email) || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: "a valid email is required" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    const user = await db.createUser({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password),
    });
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in and get an access token
 *     description: Copy the returned `token`, click **Authorize** and paste it to call the protected endpoints.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginInput' }
 *     responses:
 *       200:
 *         description: Logged-in user and access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400: { description: email and password are required }
 *       401: { description: Invalid email or password }
 */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (isBlank(email) || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const found = await db.getUserByEmail(email.trim().toLowerCase());
    if (!found || !(await verifyPassword(password, found.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const { password_hash: _hash, ...user } = found;
    res.json({ user, token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the logged-in user
 *     responses:
 *       200:
 *         description: The current user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.user_id);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
