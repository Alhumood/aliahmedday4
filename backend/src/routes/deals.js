import { Router } from "express";
import * as db from "../db.js";
import { requirePermission } from "../auth.js";
import { can } from "../permissions.js";
import { readDeal, readDealFilters } from "../deals.js";

const router = Router();

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

// Filters shared by the list and the summary. sales_user_id needs customers.view_all (ignored otherwise):
// a user id or "none" for deals of unassigned customers. Throws a 400 error when a filter is invalid.
function listFilters(req) {
  const filters = readDealFilters(req.query);
  const owner = req.query.sales_user_id;
  if (can(req.user, "customers.view_all") && owner !== undefined && owner !== "") {
    filters.salesUserId = owner === "none" ? "none" : Number(owner);
    if (filters.salesUserId !== "none" && !(Number.isInteger(filters.salesUserId) && filters.salesUserId > 0)) {
      throw Object.assign(new Error("sales_user_id must be a user id or 'none'"), { status: 400 });
    }
  }
  return filters;
}

/**
 * @openapi
 * components:
 *   parameters:
 *     DealCustomerFilter:
 *       in: query
 *       name: customer_id
 *       schema: { type: integer }
 *       description: Only deals of this customer
 *     DealStageFilter:
 *       in: query
 *       name: stage
 *       schema: { type: string, enum: [open, closed, lead, qualified, proposal, won, lost] }
 *       description: A stage, or `open` (lead, qualified, proposal) / `closed` (won, lost)
 *     DealTitleFilter:
 *       in: query
 *       name: title
 *       schema: { type: string }
 *       description: Case-insensitive partial match on the deal title
 *     DealOwnerFilter:
 *       in: query
 *       name: sales_user_id
 *       schema: { type: string, example: "none" }
 *       description: Needs customers.view_all, ignored otherwise. The customer owner's user id, or `none` for unassigned customers.
 */

/**
 * @openapi
 * /api/deals:
 *   get:
 *     tags: [Deals]
 *     summary: List deals of the customers you can see, newest first
 *     parameters:
 *       - $ref: '#/components/parameters/DealCustomerFilter'
 *       - $ref: '#/components/parameters/DealStageFilter'
 *       - $ref: '#/components/parameters/DealTitleFilter'
 *       - $ref: '#/components/parameters/DealOwnerFilter'
 *     responses:
 *       200:
 *         description: Array of deals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Deal' }
 *       400: { description: Invalid filter }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", async (req, res, next) => {
  try {
    res.json(await db.listDeals(req.user, listFilters(req)));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/deals/summary:
 *   get:
 *     tags: [Deals]
 *     summary: Pipeline counts and totals for the deals you can see
 *     description: Takes the same filters as `GET /api/deals`.
 *     parameters:
 *       - $ref: '#/components/parameters/DealCustomerFilter'
 *       - $ref: '#/components/parameters/DealStageFilter'
 *       - $ref: '#/components/parameters/DealTitleFilter'
 *       - $ref: '#/components/parameters/DealOwnerFilter'
 *     responses:
 *       200:
 *         description: The summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DealSummary' }
 *       400: { description: Invalid filter }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/summary", async (req, res, next) => {
  try {
    res.json(await db.dealSummary(req.user, listFilters(req)));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/deals/{id}:
 *   get:
 *     tags: [Deals]
 *     summary: Get a deal by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The deal
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Deal' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Deal not found, or its customer is not visible to you }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const deal = await db.getDealById(req.user, id);
    if (!deal) return res.status(404).json({ error: "Deal not found" });
    res.json(deal);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/deals:
 *   post:
 *     tags: [Deals]
 *     summary: Create a deal for a customer you can see
 *     description: The stage defaults to `lead`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DealInput' }
 *     responses:
 *       201:
 *         description: The created deal
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Deal' }
 *       400: { description: Invalid input }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Customer not found, or not visible to you }
 */
router.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await db.createDeal(req.user, readDeal(req.body)));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/deals/{id}:
 *   put:
 *     tags: [Deals]
 *     summary: Update a deal (fields left out stay unchanged)
 *     description: Moving to `won` or `lost` sets `closed_at`; moving back to an open stage clears it. `expected_close_date` null clears the date.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DealUpdate' }
 *     responses:
 *       200:
 *         description: The updated deal
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Deal' }
 *       400: { description: Invalid input }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Deal or new customer not found, or not visible to you }
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const deal = await db.updateDeal(req.user, id, readDeal(req.body, { partial: true }));
    if (!deal) return res.status(404).json({ error: "Deal not found" });
    res.json(deal);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/deals/{id}:
 *   delete:
 *     tags: [Deals]
 *     summary: Delete a deal (deals.delete)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The deleted deal
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Deal' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Deal not found, or its customer is not visible to you }
 */
router.delete("/:id", requirePermission("deals.delete"), async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const deal = await db.deleteDeal(req.user, id);
    if (!deal) return res.status(404).json({ error: "Deal not found" });
    res.json(deal);
  } catch (err) {
    next(err);
  }
});

export default router;
