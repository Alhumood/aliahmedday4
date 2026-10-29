import { Router } from "express";
import * as db from "../db.js";
import { requireAdmin } from "../auth.js";

const router = Router();
router.use(requireAdmin);

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

// Returns the trimmed name, or null after sending a 400.
function readName(req, res) {
  const name = req.body?.name;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    res.status(400).json({ error: "name is required (at most 100 characters)" });
    return null;
  }
  return name.trim();
}

/**
 * @openapi
 * /api/job-titles:
 *   get:
 *     tags: [Job Titles]
 *     summary: List job titles with how many users have each (admin only)
 *     responses:
 *       200:
 *         description: Array of job titles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/JobTitle' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/", async (_req, res, next) => {
  try {
    res.json(await db.listJobTitles());
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/job-titles:
 *   post:
 *     tags: [Job Titles]
 *     summary: Add a job title (admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/JobTitleInput' }
 *     responses:
 *       201:
 *         description: The new job title
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/JobTitle' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: A job title with this name already exists (case-insensitive) }
 */
router.post("/", async (req, res, next) => {
  try {
    const name = readName(req, res);
    if (name === null) return;
    res.status(201).json(await db.createJobTitle(name));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/job-titles/{id}:
 *   patch:
 *     tags: [Job Titles]
 *     summary: Rename a job title (admin only)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/JobTitleInput' }
 *     responses:
 *       200:
 *         description: The renamed job title
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/JobTitle' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Job title not found }
 *       409: { description: A job title with this name already exists (case-insensitive) }
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const name = readName(req, res);
    if (name === null) return;
    const title = await db.renameJobTitle(id, name);
    if (!title) return res.status(404).json({ error: "Job title not found" });
    res.json(title);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/job-titles/{id}:
 *   delete:
 *     tags: [Job Titles]
 *     summary: Delete a job title (admin only)
 *     description: Users who had this title are left with no job title.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The deleted job title (user_count is how many users lost it)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/JobTitle' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Job title not found }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const title = await db.deleteJobTitle(id);
    if (!title) return res.status(404).json({ error: "Job title not found" });
    res.json(title);
  } catch (err) {
    next(err);
  }
});

export default router;
