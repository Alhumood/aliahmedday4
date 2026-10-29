import { Router } from "express";
import * as db from "../db.js";
import { requireAdmin } from "../auth.js";

const router = Router();

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

const isAdmin = (req) => req.user.role === "admin";
const OWNER_ERROR = "sales_user_id must be a sales user";

// Admin-only owner from the request body. Returns undefined when absent (or for sales users,
// whose value is ignored), null to unassign, the id when valid, or false after sending a 400.
async function readOwner(req, res) {
  const body = req.body ?? {};
  if (!isAdmin(req) || !("sales_user_id" in body)) return undefined;
  const value = body.sales_user_id;
  if (value === null) return null;
  if (Number.isInteger(value) && value > 0 && (await db.isSalesUser(value))) return value;
  res.status(400).json({ error: OWNER_ERROR });
  return false;
}

/**
 * @openapi
 * /api/customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers (sales users get their own; admins get all)
 *     parameters:
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Case-insensitive partial match on customer name
 *       - in: query
 *         name: sales_user_id
 *         schema: { type: string, example: "none" }
 *         description: Admin only, ignored for sales users. A sales user's id, or `none` for unassigned customers.
 *     responses:
 *       200:
 *         description: Array of customers (admins also get sales_user_name)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Customer' }
 *       400: { description: Invalid sales_user_id filter }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", async (req, res, next) => {
  try {
    const { name, sales_user_id: owner } = req.query;
    let salesUserId;
    if (isAdmin(req) && owner !== undefined) {
      salesUserId = owner === "none" ? "none" : Number(owner);
      if (salesUserId !== "none" && !(Number.isInteger(salesUserId) && salesUserId > 0)) {
        return res.status(400).json({ error: "sales_user_id must be a user id or 'none'" });
      }
    }
    res.json(await db.listCustomers(req.user, { name: name ? String(name) : undefined, salesUserId }));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/assign:
 *   post:
 *     tags: [Customers]
 *     summary: Assign several customers to a sales user (admin only)
 *     description: All-or-nothing. Use `sales_user_id = null` to unassign.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AssignInput' }
 *     responses:
 *       200:
 *         description: The updated customers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Customer' }
 *       400: { description: Invalid customer_ids, unknown customer, or target is not a sales user }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/assign", requireAdmin, async (req, res, next) => {
  try {
    const { customer_ids: ids, sales_user_id: owner } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: "customer_ids must be a non-empty array of positive integers" });
    }
    if (owner !== null && !(Number.isInteger(owner) && owner > 0 && (await db.isSalesUser(owner)))) {
      return res.status(400).json({ error: OWNER_ERROR });
    }
    res.json(await db.assignCustomers(req.user, ids, owner));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   get:
 *     tags: [Customers]
 *     summary: Get a customer by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: The customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Customer' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Customer not found or not assigned to you }
 */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const customer = await db.getCustomerById(req.user, id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers:
 *   post:
 *     tags: [Customers]
 *     summary: Create a customer
 *     description: Sales users always own what they create. Admins may set `sales_user_id` (omit or null for unassigned).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AdminCustomerInput' }
 *     responses:
 *       201:
 *         description: Created customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Customer' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/", async (req, res, next) => {
  try {
    const { name, email, phone } = req.body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const salesUserId = await readOwner(req, res);
    if (salesUserId === false) return;
    res.status(201).json(await db.createCustomer(req.user, { name: name.trim(), email, phone, salesUserId: salesUserId ?? null }));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   put:
 *     tags: [Customers]
 *     summary: Update a customer (only provided fields change)
 *     description: Admins may reassign with `sales_user_id` (null unassigns); it is ignored for sales users.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AdminCustomerUpdate' }
 *     responses:
 *       200:
 *         description: Updated customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Customer' }
 *       400: { description: Validation error }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Customer not found or not assigned to you }
 */
router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const { name, email, phone } = req.body ?? {};
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    const salesUserId = await readOwner(req, res);
    if (salesUserId === false) return;
    const customer = await db.updateCustomer(req.user, id, { name: name?.trim(), email, phone, salesUserId });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/{id}:
 *   delete:
 *     tags: [Customers]
 *     summary: Delete a customer
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Deleted customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Customer' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: Customer not found or not assigned to you }
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req, res);
    if (id === null) return;
    const customer = await db.deleteCustomer(req.user, id);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

export default router;
