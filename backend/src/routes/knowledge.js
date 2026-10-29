import { Router } from "express";
import * as db from "../db.js";

const router = Router();

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

const isBlank = (value) => typeof value !== "string" || !value.trim();

/**
 * @openapi
 * /api/knowledge:
 *   get:
 *     tags: [Knowledge]
 *     summary: List knowledge articles, optionally filtered by a search term
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Case-insensitive match on title, category or content
 *     responses:
 *       200:
 *         description: Array of articles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Article' }
 */
router.get("/", async (req, res, next) => {
  try {
    const { q } = req.query;
    res.json(q ? await db.searchArticles(String(q)) : await db.listArticles());
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/knowledge/{id}:
 *   get:
 *     tags: [Knowledge]
 *     summary: Get a knowledge article by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The article
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Article' }
 *       404: { description: Article not found }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const article = await db.getArticleById(id);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/knowledge:
 *   post:
 *     tags: [Knowledge]
 *     summary: Create a knowledge article
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ArticleInput' }
 *     responses:
 *       201:
 *         description: Created article
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Article' }
 *       400: { description: Validation error }
 */
router.post("/", async (req, res, next) => {
  try {
    const { title, category, content } = req.body ?? {};
    if (isBlank(title)) return res.status(400).json({ error: "title is required" });
    if (isBlank(content)) return res.status(400).json({ error: "content is required" });
    res.status(201).json(
      await db.createArticle({ title: title.trim(), category: category?.trim() || null, content: content.trim() }),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/knowledge/{id}:
 *   put:
 *     tags: [Knowledge]
 *     summary: Update a knowledge article (only provided fields change)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ArticleUpdate' }
 *     responses:
 *       200:
 *         description: Updated article
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Article' }
 *       404: { description: Article not found }
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { title, category, content } = req.body ?? {};
    if (title !== undefined && isBlank(title)) return res.status(400).json({ error: "title cannot be empty" });
    if (content !== undefined && isBlank(content)) return res.status(400).json({ error: "content cannot be empty" });
    const article = await db.updateArticle(id, { title: title?.trim(), category: category?.trim(), content: content?.trim() });
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/knowledge/{id}:
 *   delete:
 *     tags: [Knowledge]
 *     summary: Delete a knowledge article
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Deleted article
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Article' }
 *       404: { description: Article not found }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const article = await db.deleteArticle(id);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
  } catch (err) {
    next(err);
  }
});

export default router;
