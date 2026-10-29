import pg from "pg";
import { SYSTEM_ROLES, can } from "./permissions.js";
import { CLOSED_STAGES, DEAL_STAGES, OPEN_STAGES } from "./deals.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// The user, role and customer owner schema is created on first use, like the knowledge table.
// The first run also creates the built-in roles and migrates the old sales/admin roles and job titles
// (spec 03, section 11.4). The old app_user.role/job_title_id columns and job_title table are left
// unused so an older deployment on the same database keeps working.
const sqlArray = (keys) => `ARRAY[${keys.map((k) => `'${k}'`).join(", ")}]::text[]`;

let authReady;
function ensureAuthSchema() {
  const { admin, sales } = SYSTEM_ROLES;
  authReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS role (
         role_id SERIAL PRIMARY KEY,
         name TEXT NOT NULL,
         permissions TEXT[] NOT NULL DEFAULT '{}',
         system_key TEXT UNIQUE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       CREATE UNIQUE INDEX IF NOT EXISTS role_name_lower_idx ON role (lower(name));
       CREATE TABLE IF NOT EXISTS app_user (
         user_id SERIAL PRIMARY KEY,
         name TEXT NOT NULL,
         email TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES role(role_id);
       ALTER TABLE customer ADD COLUMN IF NOT EXISTS sales_user_id INTEGER REFERENCES app_user(user_id);
       CREATE INDEX IF NOT EXISTS customer_sales_user_id_idx ON customer (sales_user_id);
       DO $$
       DECLARE
         has_old_role BOOLEAN := EXISTS (
           SELECT 1 FROM information_schema.columns WHERE table_name = 'app_user' AND column_name = 'role');
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM role WHERE system_key = 'admin') THEN
           INSERT INTO role (name, permissions, system_key) VALUES
             ('${admin.name}', ${sqlArray(admin.permissions)}, 'admin'),
             ('${sales.name}', ${sqlArray(sales.permissions)}, 'sales');
           IF has_old_role AND to_regclass('job_title') IS NOT NULL THEN
             INSERT INTO role (name, permissions)
               SELECT name, ${sqlArray(sales.permissions)} FROM job_title ON CONFLICT DO NOTHING;
             EXECUTE 'UPDATE app_user u SET role_id = r.role_id
                      FROM job_title jt JOIN role r ON lower(r.name) = lower(jt.name) AND r.system_key IS NULL
                      WHERE u.job_title_id = jt.job_title_id AND u.role = ''sales'' AND u.role_id IS NULL';
           END IF;
         END IF;
         IF has_old_role THEN
           EXECUTE 'UPDATE app_user u SET role_id = r.role_id FROM role r
                    WHERE u.role_id IS NULL AND r.system_key = u.role';
         END IF;
         UPDATE app_user SET role_id = (SELECT role_id FROM role WHERE system_key = 'sales') WHERE role_id IS NULL;
       END $$;`,
    )
    .catch((err) => {
      authReady = undefined;
      throw err;
    });
  return authReady;
}

// Runs fn, turning a unique-constraint violation into a 409 with the given message.
async function withConflict(message, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === "23505") {
      const conflict = new Error(message);
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

const EMAIL_TAKEN = "Email is already registered";

// Every user read includes the role and its permissions, so all user responses have the same shape.
const userSelect = (extra = "") => `
  SELECT u.user_id, u.name, u.email, u.role_id, r.name AS role, r.system_key AS role_key, r.permissions,
         u.created_at${extra}
  FROM app_user u JOIN role r ON r.role_id = u.role_id`;

// roleId defaults to the built-in Sales role (self-registration never passes one).
export async function createUser({ name, email, passwordHash, roleId = null }) {
  await ensureAuthSchema();
  const { rows } = await withConflict(EMAIL_TAKEN, () =>
    pool.query(
      `INSERT INTO app_user (name, email, password_hash, role_id)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT role_id FROM role WHERE system_key = 'sales'))) RETURNING user_id`,
      [name, email, passwordHash, roleId],
    ),
  );
  return getUserById(rows[0].user_id);
}

// Includes password_hash; only for verifying a login.
export async function getUserByEmail(email) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${userSelect(", u.password_hash")} WHERE u.email = $1`, [email]);
  return rows[0] ?? null;
}

export async function getUserById(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${userSelect()} WHERE u.user_id = $1`, [id]);
  return rows[0] ?? null;
}

const USER_WITH_COUNT = `${userSelect(", (SELECT count(*)::int FROM customer c WHERE c.sales_user_id = u.user_id) AS customer_count")}`;

export async function listUsersWithCounts() {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${USER_WITH_COUNT} ORDER BY u.user_id`);
  return rows;
}

export async function getUserWithCount(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${USER_WITH_COUNT} WHERE u.user_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function setUserRole(id, roleId) {
  return updateUser(id, { roleId });
}

// Changes only the fields present in `fields`.
export async function updateUser(id, fields) {
  await ensureAuthSchema();
  const columns = { name: "name", email: "email", passwordHash: "password_hash", roleId: "role_id" };
  const params = [id];
  const sets = [];
  for (const [key, column] of Object.entries(columns)) {
    if (key in fields) {
      params.push(fields[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length > 0) {
    const { rowCount } = await withConflict(EMAIL_TAKEN, () =>
      pool.query(`UPDATE app_user SET ${sets.join(", ")} WHERE user_id = $1`, params),
    );
    if (rowCount === 0) return null;
  }
  return getUserById(id);
}

// Moves the user's customers to reassignTo (null = unassigned), then deletes the user, all-or-nothing.
// Customers are never deleted with their owner.
export async function deleteUser(id, reassignTo = null) {
  await ensureAuthSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const moved = await client.query("UPDATE customer SET sales_user_id = $2 WHERE sales_user_id = $1", [id, reassignTo]);
    const { rows } = await client.query(
      `DELETE FROM app_user u WHERE u.user_id = $1
       RETURNING u.user_id, u.name, u.email, (SELECT name FROM role WHERE role_id = u.role_id) AS role`,
      [id],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return { deleted_user: rows[0], customers_moved: moved.rowCount, reassigned_to: reassignTo };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function countCustomersOwnedBy(userId) {
  await ensureAuthSchema();
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM customer WHERE sales_user_id = $1", [userId]);
  return rows[0].n;
}

// Only users whose role has customers.own can own customers.
export async function canOwnCustomers(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT 1 FROM app_user u JOIN role r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND 'customers.own' = ANY(r.permissions)`,
    [id],
  );
  return rows.length > 0;
}

// Users who can own customers, for owner pickers and filters.
export async function listCustomerOwners() {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT u.user_id, u.name FROM app_user u JOIN role r ON r.role_id = u.role_id
     WHERE 'customers.own' = ANY(r.permissions) ORDER BY lower(u.name)`,
  );
  return rows;
}

// Roles carry the permissions; system_key marks the built-in Admin and Sales roles.
const ROLE_TAKEN = "A role with this name already exists";
const ROLE_SELECT = `
  SELECT r.role_id, r.name, r.permissions, r.system_key, r.created_at,
         (SELECT count(*)::int FROM app_user u WHERE u.role_id = r.role_id) AS user_count
  FROM role r`;

export async function listRoles() {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${ROLE_SELECT} ORDER BY r.system_key IS NULL, r.system_key, lower(r.name)`);
  return rows;
}

export async function getRole(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${ROLE_SELECT} WHERE r.role_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getSystemRole(key) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${ROLE_SELECT} WHERE r.system_key = $1`, [key]);
  return rows[0] ?? null;
}

export async function createRole({ name, permissions }) {
  await ensureAuthSchema();
  const { rows } = await withConflict(ROLE_TAKEN, () =>
    pool.query("INSERT INTO role (name, permissions) VALUES ($1, $2) RETURNING role_id", [name, permissions]),
  );
  return getRole(rows[0].role_id);
}

// Changes only the fields present (name, permissions).
export async function updateRole(id, { name, permissions }) {
  await ensureAuthSchema();
  const { rowCount } = await withConflict(ROLE_TAKEN, () =>
    pool.query(
      "UPDATE role SET name = COALESCE($2, name), permissions = COALESCE($3, permissions) WHERE role_id = $1",
      [id, name ?? null, permissions ?? null],
    ),
  );
  return rowCount === 0 ? null : getRole(id);
}

// The caller makes sure no users have the role; the foreign key would refuse it anyway.
export async function deleteRole(id) {
  await ensureAuthSchema();
  const role = await getRole(id);
  if (!role) return null;
  await pool.query("DELETE FROM role WHERE role_id = $1", [id]);
  return role;
}

export async function countCustomersOwnedByRole(roleId) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM customer c JOIN app_user u ON u.user_id = c.sales_user_id WHERE u.role_id = $1",
    [roleId],
  );
  return rows[0].n;
}

// Customer access depends on the caller's permissions. Without customers.view_all a user is always
// limited to their own rows; with it they reach every row, may filter by owner, and get the owner's name.
const seesAll = (user) => can(user, "customers.view_all");

function customerSelect(user, source) {
  const ownerName = seesAll(user) ? ", u.name AS sales_user_name" : "";
  return `SELECT c.customer_id, c.name, c.email, c.phone, c.sales_user_id, c.created_at${ownerName}
          FROM ${source} c LEFT JOIN app_user u ON u.user_id = c.sales_user_id`;
}

// Returns the SQL condition limiting which customers `user` can reach, pushing its values onto params.
// salesUserId is a view_all-only filter: an id, "none" for unassigned, or undefined for all.
function ownerScope(user, params, salesUserId) {
  if (!seesAll(user)) {
    params.push(user.user_id);
    return `c.sales_user_id = $${params.length}`;
  }
  if (salesUserId === "none") return "c.sales_user_id IS NULL";
  if (salesUserId !== undefined) {
    params.push(salesUserId);
    return `c.sales_user_id = $${params.length}`;
  }
  return "TRUE";
}

// The list also counts each customer's deals (all, and open ones), for the Customers table and delete warning.
export async function listCustomers(user, { name, salesUserId } = {}) {
  await ensureDealSchema();
  const params = [];
  const conditions = [ownerScope(user, params, salesUserId)];
  if (name) {
    params.push(`%${name}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  params.push(OPEN_STAGES);
  const { rows } = await pool.query(
    `SELECT l.*, COALESCE(dc.deals_count, 0) AS deals_count, COALESCE(dc.open_deals_count, 0) AS open_deals_count
     FROM (${customerSelect(user, "customer")} WHERE ${conditions.join(" AND ")}) l
     LEFT JOIN (
       SELECT customer_id, count(*)::int AS deals_count,
              (count(*) FILTER (WHERE stage = ANY($${params.length}::text[])))::int AS open_deals_count
       FROM deal GROUP BY customer_id
     ) dc ON dc.customer_id = l.customer_id
     ORDER BY l.customer_id`,
    params,
  );
  return rows;
}

export async function getCustomerById(user, id) {
  await ensureAuthSchema();
  const params = [id];
  const { rows } = await pool.query(
    `${customerSelect(user, "customer")} WHERE c.customer_id = $1 AND ${ownerScope(user, params)}`,
    params,
  );
  return rows[0] ?? null;
}

// salesUserId is only honoured with customers.view_all (null = unassigned); others always own what they create.
export async function createCustomer(user, { name, email = null, phone = null, salesUserId = null }) {
  await ensureAuthSchema();
  const owner = seesAll(user) ? salesUserId : user.user_id;
  const { rows } = await pool.query(
    `WITH changed AS (
       INSERT INTO customer (name, email, phone, sales_user_id) VALUES ($1, $2, $3, $4) RETURNING *
     ) ${customerSelect(user, "changed")}`,
    [name, email, phone, owner],
  );
  return rows[0];
}

// salesUserId: undefined leaves the owner unchanged, null unassigns; only honoured with customers.view_all.
export async function updateCustomer(user, id, { name, email, phone, salesUserId }) {
  await ensureAuthSchema();
  const params = [id, name ?? null, email ?? null, phone ?? null];
  const sets = ["name = COALESCE($2, name)", "email = COALESCE($3, email)", "phone = COALESCE($4, phone)"];
  if (seesAll(user) && salesUserId !== undefined) {
    params.push(salesUserId);
    sets.push(`sales_user_id = $${params.length}`);
  }
  const scope = ownerScope(user, params);
  const { rows } = await pool.query(
    `WITH changed AS (
       UPDATE customer c SET ${sets.join(", ")} WHERE c.customer_id = $1 AND ${scope} RETURNING c.*
     ) ${customerSelect(user, "changed")}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteCustomer(user, id) {
  await ensureAuthSchema();
  const params = [id];
  const scope = ownerScope(user, params);
  const { rows } = await pool.query(
    `WITH changed AS (
       DELETE FROM customer c WHERE c.customer_id = $1 AND ${scope} RETURNING c.*
     ) ${customerSelect(user, "changed")}`,
    params,
  );
  return rows[0] ?? null;
}

// Bulk (re)assignment (customers.assign); all-or-nothing, so one unknown id changes nothing.
export async function assignCustomers(user, customerIds, salesUserId) {
  await ensureAuthSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `WITH changed AS (
         UPDATE customer SET sales_user_id = $2 WHERE customer_id = ANY($1::int[]) RETURNING *
       ) ${customerSelect(user, "changed")} ORDER BY c.customer_id`,
      [customerIds, salesUserId],
    );
    if (rows.length !== new Set(customerIds).size) {
      const err = new Error("One or more customer_ids do not exist");
      err.status = 400;
      throw err;
    }
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Deals (spec 05) belong to a customer and have no owner of their own: every deal query joins the customer
// and uses ownerScope(), so a deal is visible exactly when its customer is.
// The first run also gives the built-in Admin and Sales roles the new deals.delete permission. It only runs
// while the deal table doesn't exist yet, so an admin who later removes it from Sales isn't overridden.
let dealsReady;
function ensureDealSchema() {
  dealsReady ??= ensureAuthSchema()
    .then(() =>
      pool.query(
        `DO $$
         BEGIN
           IF to_regclass('deal') IS NULL THEN
             UPDATE role SET permissions = array_append(permissions, 'deals.delete')
             WHERE system_key IN ('admin', 'sales') AND NOT 'deals.delete' = ANY(permissions);
           END IF;
         END $$;
         CREATE TABLE IF NOT EXISTS deal (
           deal_id SERIAL PRIMARY KEY,
           customer_id INTEGER NOT NULL REFERENCES customer(customer_id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
           stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN (${DEAL_STAGES.map((s) => `'${s}'`).join(", ")})),
           expected_close_date DATE,
           closed_at TIMESTAMPTZ,
           created_by INTEGER REFERENCES app_user(user_id) ON DELETE SET NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS deal_customer_id_idx ON deal (customer_id);`,
      ),
    )
    .catch((err) => {
      dealsReady = undefined;
      throw err;
    });
  return dealsReady;
}

const customerNotFound = () => Object.assign(new Error("Customer not found"), { status: 404 });

function dealSelect(user, source) {
  const owner = seesAll(user) ? ", c.sales_user_id, u.name AS sales_user_name" : "";
  return `SELECT d.deal_id, d.customer_id, c.name AS customer_name, d.title, d.amount::float8 AS amount, d.stage,
                 to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date, d.closed_at, d.created_by,
                 d.created_at, d.updated_at${owner}
          FROM ${source} d JOIN customer c ON c.customer_id = d.customer_id
          LEFT JOIN app_user u ON u.user_id = c.sales_user_id`;
}

// The condition for deals whose customer `user` can reach, as a subquery on d.customer_id.
function dealScope(user, params) {
  return `d.customer_id IN (SELECT c.customer_id FROM customer c WHERE ${ownerScope(user, params)})`;
}

// WHERE conditions for the deal list and summary (the query joins customer c). salesUserId as for customers.
function dealFilters(user, params, { customerId, stage, title, salesUserId } = {}) {
  const conditions = [ownerScope(user, params, salesUserId)];
  if (customerId !== undefined) {
    params.push(customerId);
    conditions.push(`d.customer_id = $${params.length}`);
  }
  if (stage !== undefined) {
    params.push(stage === "open" ? OPEN_STAGES : stage === "closed" ? CLOSED_STAGES : [stage]);
    conditions.push(`d.stage = ANY($${params.length}::text[])`);
  }
  if (title) {
    params.push(`%${title}%`);
    conditions.push(`d.title ILIKE $${params.length}`);
  }
  return conditions.join(" AND ");
}

export async function listDeals(user, filters = {}) {
  await ensureDealSchema();
  const params = [];
  const where = dealFilters(user, params, filters);
  const { rows } = await pool.query(
    `${dealSelect(user, "deal")} WHERE ${where} ORDER BY d.created_at DESC, d.deal_id DESC`,
    params,
  );
  return rows;
}

// Counts and totals per stage for the same filters as the list. Every stage is present, zeros included.
export async function dealSummary(user, filters = {}) {
  await ensureDealSchema();
  const params = [];
  const where = dealFilters(user, params, filters);
  const { rows } = await pool.query(
    `SELECT d.stage, count(*)::int AS count, COALESCE(sum(d.amount), 0)::float8 AS amount
     FROM deal d JOIN customer c ON c.customer_id = d.customer_id
     WHERE ${where} GROUP BY d.stage`,
    params,
  );
  const byStage = DEAL_STAGES.map(
    (stage) => rows.find((row) => row.stage === stage) ?? { stage, count: 0, amount: 0 },
  );
  const total = (stages) =>
    byStage
      .filter((row) => stages.includes(row.stage))
      .reduce((sum, row) => ({ count: sum.count + row.count, amount: sum.amount + row.amount }), { count: 0, amount: 0 });
  const open = total(OPEN_STAGES);
  const won = total(["won"]);
  return {
    open_count: open.count,
    open_amount: open.amount,
    won_count: won.count,
    won_amount: won.amount,
    lost_count: total(["lost"]).count,
    by_stage: byStage,
  };
}

export async function getDealById(user, id) {
  await ensureDealSchema();
  const params = [id];
  const { rows } = await pool.query(`${dealSelect(user, "deal")} WHERE d.deal_id = $1 AND ${dealScope(user, params)}`, params);
  return rows[0] ?? null;
}

// Throws a 404 when the customer is not visible to `user`.
export async function createDeal(user, { customerId, title, amount, stage = "lead", expectedCloseDate = null }) {
  await ensureDealSchema();
  const params = [customerId, title, amount, stage, expectedCloseDate, CLOSED_STAGES, user.user_id];
  const scope = ownerScope(user, params);
  const { rows } = await pool.query(
    `WITH changed AS (
       INSERT INTO deal (customer_id, title, amount, stage, expected_close_date, closed_at, created_by)
       SELECT c.customer_id, $2, $3, $4, $5::date, CASE WHEN $4::text = ANY($6::text[]) THEN now() END, $7
       FROM customer c WHERE c.customer_id = $1 AND ${scope}
       RETURNING *
     ) ${dealSelect(user, "changed")}`,
    params,
  );
  if (!rows[0]) throw customerNotFound();
  return rows[0];
}

// Only the fields present change (expectedCloseDate: null clears the date). closed_at is set when the deal
// moves from an open to a closed stage and cleared when it moves back to an open one.
// Returns null when the deal is not visible; throws a 404 when a new customerId is not visible.
export async function updateDeal(user, id, fields) {
  await ensureDealSchema();
  if (fields.customerId !== undefined && !(await getCustomerById(user, fields.customerId))) throw customerNotFound();
  const columns = { customerId: "customer_id", title: "title", amount: "amount", expectedCloseDate: "expected_close_date" };
  const params = [id];
  const sets = ["updated_at = now()"];
  for (const [key, column] of Object.entries(columns)) {
    if (key in fields) {
      params.push(fields[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (fields.stage !== undefined) {
    params.push(fields.stage, CLOSED_STAGES);
    const [stage, closed] = [`$${params.length - 1}::text`, `$${params.length}::text[]`];
    sets.push(
      `stage = ${stage}`,
      `closed_at = CASE WHEN ${stage} = ANY(${closed}) THEN CASE WHEN d.stage = ANY(${closed}) THEN d.closed_at ELSE now() END END`,
    );
  }
  const scope = dealScope(user, params);
  const { rows } = await pool.query(
    `WITH changed AS (
       UPDATE deal d SET ${sets.join(", ")} WHERE d.deal_id = $1 AND ${scope} RETURNING d.*
     ) ${dealSelect(user, "changed")}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteDeal(user, id) {
  await ensureDealSchema();
  const params = [id];
  const scope = dealScope(user, params);
  const { rows } = await pool.query(
    `WITH changed AS (
       DELETE FROM deal d WHERE d.deal_id = $1 AND ${scope} RETURNING d.*
     ) ${dealSelect(user, "changed")}`,
    params,
  );
  return rows[0] ?? null;
}

const KNOWLEDGE_COLUMNS ="article_id, title, category, content, created_at, updated_at";

// The knowledge table is created on first use, so no separate migration step is needed.
let knowledgeReady;
function ensureKnowledgeTable() {
  knowledgeReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS knowledge_article (
         article_id SERIAL PRIMARY KEY,
         title TEXT NOT NULL,
         category TEXT,
         content TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .catch((err) => {
      knowledgeReady = undefined;
      throw err;
    });
  return knowledgeReady;
}

export async function listArticles() {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(`SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_article ORDER BY updated_at DESC`);
  return rows;
}

export async function searchArticles(query) {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(
    `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_article
     WHERE title ILIKE $1 OR content ILIKE $1 OR category ILIKE $1
     ORDER BY updated_at DESC`,
    [`%${query}%`],
  );
  return rows;
}

export async function getArticleById(id) {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(`SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_article WHERE article_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createArticle({ title, category = null, content }) {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(
    `INSERT INTO knowledge_article (title, category, content) VALUES ($1, $2, $3) RETURNING ${KNOWLEDGE_COLUMNS}`,
    [title, category, content],
  );
  return rows[0];
}

export async function updateArticle(id, { title, category, content }) {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(
    `UPDATE knowledge_article SET
       title = COALESCE($2, title),
       category = COALESCE($3, category),
       content = COALESCE($4, content),
       updated_at = now()
     WHERE article_id = $1 RETURNING ${KNOWLEDGE_COLUMNS}`,
    [id, title ?? null, category ?? null, content ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteArticle(id) {
  await ensureKnowledgeTable();
  const { rows } = await pool.query(
    `DELETE FROM knowledge_article WHERE article_id = $1 RETURNING ${KNOWLEDGE_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}
