import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// The user table and the customer owner column are created on first use, like the knowledge table.
let authReady;
function ensureAuthSchema() {
  authReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS app_user (
         user_id SERIAL PRIMARY KEY,
         name TEXT NOT NULL,
         email TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         role TEXT NOT NULL DEFAULT 'sales',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       ALTER TABLE customer ADD COLUMN IF NOT EXISTS sales_user_id INTEGER REFERENCES app_user(user_id);
       CREATE INDEX IF NOT EXISTS customer_sales_user_id_idx ON customer (sales_user_id);`,
    )
    .catch((err) => {
      authReady = undefined;
      throw err;
    });
  return authReady;
}

const USER_COLUMNS = "user_id, name, email, role, created_at";

export async function createUser({ name, email, passwordHash }) {
  await ensureAuthSchema();
  try {
    const { rows } = await pool.query(
      `INSERT INTO app_user (name, email, password_hash, role) VALUES ($1, $2, $3, 'sales') RETURNING ${USER_COLUMNS}`,
      [name, email, passwordHash],
    );
    return rows[0];
  } catch (err) {
    if (err.code === "23505") {
      const conflict = new Error("Email is already registered");
      conflict.status = 409;
      throw conflict;
    }
    throw err;
  }
}

// Includes password_hash; only for verifying a login.
export async function getUserByEmail(email) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS}, password_hash FROM app_user WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function getUserById(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM app_user WHERE user_id = $1`, [id]);
  return rows[0] ?? null;
}

const USER_WITH_COUNT = `
  SELECT u.user_id, u.name, u.email, u.role, u.created_at, count(c.customer_id)::int AS customer_count
  FROM app_user u LEFT JOIN customer c ON c.sales_user_id = u.user_id`;

export async function listUsersWithCounts() {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${USER_WITH_COUNT} GROUP BY u.user_id ORDER BY u.user_id`);
  return rows;
}

export async function getUserWithCount(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${USER_WITH_COUNT} WHERE u.user_id = $1 GROUP BY u.user_id`, [id]);
  return rows[0] ?? null;
}

export async function setUserRole(id, role) {
  await ensureAuthSchema();
  const { rows } = await pool.query(`UPDATE app_user SET role = $2 WHERE user_id = $1 RETURNING ${USER_COLUMNS}`, [id, role]);
  return rows[0] ?? null;
}

export async function countCustomersOwnedBy(userId) {
  await ensureAuthSchema();
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM customer WHERE sales_user_id = $1", [userId]);
  return rows[0].n;
}

// Only sales users can own customers.
export async function isSalesUser(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query("SELECT 1 FROM app_user WHERE user_id = $1 AND role = 'sales'", [id]);
  return rows.length > 0;
}

// Customer access depends on the caller's role. Sales users are always limited to their own rows;
// admins reach every row, may filter by owner, and also get the owner's name.
const isAdmin = (user) => user.role === "admin";

function customerSelect(user, source) {
  const ownerName = isAdmin(user) ? ", u.name AS sales_user_name" : "";
  return `SELECT c.customer_id, c.name, c.email, c.phone, c.sales_user_id, c.created_at${ownerName}
          FROM ${source} c LEFT JOIN app_user u ON u.user_id = c.sales_user_id`;
}

// Returns the SQL condition limiting which customers `user` can reach, pushing its values onto params.
// salesUserId is an admin-only filter: an id, "none" for unassigned, or undefined for all.
function ownerScope(user, params, salesUserId) {
  if (!isAdmin(user)) {
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

export async function listCustomers(user, { name, salesUserId } = {}) {
  await ensureAuthSchema();
  const params = [];
  const conditions = [ownerScope(user, params, salesUserId)];
  if (name) {
    params.push(`%${name}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }
  const { rows } = await pool.query(
    `${customerSelect(user, "customer")} WHERE ${conditions.join(" AND ")} ORDER BY c.customer_id`,
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

// salesUserId is only honoured for admins (null = unassigned); sales users always own what they create.
export async function createCustomer(user, { name, email = null, phone = null, salesUserId = null }) {
  await ensureAuthSchema();
  const owner = isAdmin(user) ? salesUserId : user.user_id;
  const { rows } = await pool.query(
    `WITH changed AS (
       INSERT INTO customer (name, email, phone, sales_user_id) VALUES ($1, $2, $3, $4) RETURNING *
     ) ${customerSelect(user, "changed")}`,
    [name, email, phone, owner],
  );
  return rows[0];
}

// salesUserId: undefined leaves the owner unchanged, null unassigns; only honoured for admins.
export async function updateCustomer(user, id, { name, email, phone, salesUserId }) {
  await ensureAuthSchema();
  const params = [id, name ?? null, email ?? null, phone ?? null];
  const sets = ["name = COALESCE($2, name)", "email = COALESCE($3, email)", "phone = COALESCE($4, phone)"];
  if (isAdmin(user) && salesUserId !== undefined) {
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

// Admin-only bulk (re)assignment; all-or-nothing, so one unknown id changes nothing.
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

const KNOWLEDGE_COLUMNS = "article_id, title, category, content, created_at, updated_at";

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
