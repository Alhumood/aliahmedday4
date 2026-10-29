import { Router } from "express";
import * as db from "../db.js";
import { requirePermission } from "../auth.js";
import { can } from "../permissions.js";
import { CONTENT_TYPES, LABELS as EXPORT_LABELS, buildCustomersPdf, buildCustomersXlsx, fileName } from "../export.js";

const router = Router();

function parseId(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "id must be a positive integer" });
    return null;
  }
  return id;
}

const seesAll = (req) => can(req.user, "customers.view_all");
const OWNER_ERROR = "sales_user_id must be a user who can own customers";

// Filters shared by the list and the export. sales_user_id needs customers.view_all (ignored otherwise):
// a user id or "none" for unassigned. Throws a 400 error when it is invalid.
function listFilters(req) {
  const { name, sales_user_id: owner } = req.query;
  let salesUserId;
  if (seesAll(req) && owner !== undefined) {
    salesUserId = owner === "none" ? "none" : Number(owner);
    if (salesUserId !== "none" && !(Number.isInteger(salesUserId) && salesUserId > 0)) {
      throw Object.assign(new Error("sales_user_id must be a user id or 'none'"), { status: 400 });
    }
  }
  return { name: name ? String(name) : undefined, salesUserId };
}

// Owner from the request body (customers.view_all only). Returns undefined when absent (or without
// the permission, when the value is ignored), null to unassign, the id when valid, or false after sending a 400.
async function readOwner(req, res) {
  const body = req.body ?? {};
  if (!seesAll(req) || !("sales_user_id" in body)) return undefined;
  const value = body.sales_user_id;
  if (value === null) return null;
  if (Number.isInteger(value) && value > 0 && (await db.canOwnCustomers(value))) return value;
  res.status(400).json({ error: OWNER_ERROR });
  return false;
}

/**
 * @openapi
 * /api/customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers (all of them with customers.view_all, otherwise your own)
 *     parameters:
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Case-insensitive partial match on customer name
 *       - in: query
 *         name: sales_user_id
 *         schema: { type: string, example: "none" }
 *         description: Needs customers.view_all, ignored otherwise. An owner's user id, or `none` for unassigned customers.
 *     responses:
 *       200:
 *         description: Array of customers (with customers.view_all, also sales_user_name)
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
    res.json(await db.listCustomers(req.user, listFilters(req)));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/export:
 *   get:
 *     tags: [Customers]
 *     summary: Download the customer list as Excel or PDF
 *     description: >
 *       Exports the same rows as `GET /api/customers` with the same filters, so users without customers.view_all
 *       only get their own customers. The Owner column is included with customers.view_all only.
 *     parameters:
 *       - in: query
 *         name: format
 *         required: true
 *         schema: { type: string, enum: [xlsx, pdf] }
 *       - in: query
 *         name: name
 *         schema: { type: string }
 *         description: Case-insensitive partial match on customer name
 *       - in: query
 *         name: sales_user_id
 *         schema: { type: string, example: "none" }
 *         description: Needs customers.view_all, ignored otherwise. An owner's user id, or `none` for unassigned customers.
 *       - in: query
 *         name: lang
 *         schema: { type: string, enum: [en, ar], default: en }
 *         description: Language of the headers. `ar` also makes the file right-to-left.
 *     responses:
 *       200:
 *         description: The file
 *         headers:
 *           Content-Disposition:
 *             schema: { type: string, example: 'attachment; filename="customers-2026-10-29.xlsx"' }
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *       400: { description: Missing or unknown format, or invalid sales_user_id filter }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/export", requirePermission("customers.export"), async (req, res, next) => {
  try {
    const { format } = req.query;
    if (typeof format !== "string" || !Object.hasOwn(CONTENT_TYPES, format)) {
      return res.status(400).json({ error: "format must be 'xlsx' or 'pdf'" });
    }
    const filters = listFilters(req);
    const lang = req.query.lang === "ar" ? "ar" : "en";
    const rows = await db.listCustomers(req.user, filters);
    const exportedBy = (await db.getUserById(req.user.user_id))?.name ?? req.user.email;

    // The owner filter shown in the PDF header (customers.view_all only).
    let ownerLabel;
    if (seesAll(req)) {
      const { salesUserId } = filters;
      if (salesUserId === "none") ownerLabel = EXPORT_LABELS[lang].unassigned;
      else if (salesUserId === undefined) ownerLabel = EXPORT_LABELS[lang].all;
      else ownerLabel = (await db.getUserById(salesUserId))?.name ?? `#${salesUserId}`;
    }

    const build = format === "xlsx" ? buildCustomersXlsx : buildCustomersPdf;
    const file = await build(rows, { user: req.user, lang, exportedBy, filters: { name: filters.name, ownerLabel } });
    res.set({
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${fileName(format)}"`,
    });
    res.send(file);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/assign:
 *   post:
 *     tags: [Customers]
 *     summary: Assign several customers to an owner (customers.assign)
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
 *       400: { description: Invalid customer_ids, unknown customer, or target cannot own customers }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/assign", requirePermission("customers.assign"), async (req, res, next) => {
  try {
    const { customer_ids: ids, sales_user_id: owner } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: "customer_ids must be a non-empty array of positive integers" });
    }
    if (owner !== null && !(Number.isInteger(owner) && owner > 0 && (await db.canOwnCustomers(owner)))) {
      return res.status(400).json({ error: OWNER_ERROR });
    }
    res.json(await db.assignCustomers(req.user, ids, owner));
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/customers/owners:
 *   get:
 *     tags: [Customers]
 *     summary: Users who can own customers (customers.view_all)
 *     description: For owner pickers and the owner filter. Lists users whose role has `customers.own`.
 *     responses:
 *       200:
 *         description: Array of possible owners
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CustomerOwner' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/owners", requirePermission("customers.view_all"), async (_req, res, next) => {
  try {
    res.json(await db.listCustomerOwners());
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
 *     description: Without customers.view_all you always own what you create. With it you may set `sales_user_id` (omit or null for unassigned).
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
 *     description: With customers.view_all you may reassign with `sales_user_id` (null unassigns); otherwise it is ignored.
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
 *     summary: Delete a customer (customers.delete)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Deleted customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Customer' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Customer not found or not assigned to you }
 */
router.delete("/:id", requirePermission("customers.delete"), async (req, res, next) => {
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
