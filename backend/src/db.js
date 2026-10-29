import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// The user, job title and customer owner schema is created on first use, like the knowledge table.
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
       CREATE INDEX IF NOT EXISTS customer_sales_user_id_idx ON customer (sales_user_id);
       CREATE TABLE IF NOT EXISTS job_title (
         job_title_id SERIAL PRIMARY KEY,
         name TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );
       CREATE UNIQUE INDEX IF NOT EXISTS job_title_name_lower_idx ON job_title (lower(name));
       ALTER TABLE app_user ADD COLUMN IF NOT EXISTS job_title_id INTEGER
         REFERENCES job_title(job_title_id) ON DELETE SET NULL;`,
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

// Every user read includes the job title, so all user responses have the same shape.
const userSelect = (extra = "") => `
  SELECT u.user_id, u.name, u.email, u.role, u.job_title_id, jt.name AS job_title, u.created_at${extra}
  FROM app_user u LEFT JOIN job_title jt ON jt.job_title_id = u.job_title_id`;

export async function createUser({ name, email, passwordHash, role = "sales", jobTitleId = null }) {
  await ensureAuthSchema();
  const { rows } = await withConflict(EMAIL_TAKEN, () =>
    pool.query(
      `INSERT INTO app_user (name, email, password_hash, role, job_title_id) VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
      [name, email, passwordHash, role, jobTitleId],
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

export async function setUserRole(id, role) {
  return updateUser(id, { role });
}

// Changes only the fields present in `fields`; jobTitleId: null clears the job title.
export async function updateUser(id, fields) {
  await ensureAuthSchema();
  const columns = { name: "name", email: "email", passwordHash: "password_hash", role: "role", jobTitleId: "job_title_id" };
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
      "DELETE FROM app_user WHERE user_id = $1 RETURNING user_id, name, email, role",
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

// Only sales users can own customers.
export async function isSalesUser(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query("SELECT 1 FROM app_user WHERE user_id = $1 AND role = 'sales'", [id]);
  return rows.length > 0;
}

// Job titles are descriptive labels only; access is decided by role.
const JOB_TITLE_TAKEN = "A job title with this name already exists";
const JOB_TITLE_SELECT = `
  SELECT jt.job_title_id, jt.name, jt.created_at,
         (SELECT count(*)::int FROM app_user u WHERE u.job_title_id = jt.job_title_id) AS user_count
  FROM job_title jt`;

export async function listJobTitles() {
  await ensureAuthSchema();
  const { rows } = await pool.query(`${JOB_TITLE_SELECT} ORDER BY lower(jt.name)`);
  return rows;
}

async function getJobTitle(id) {
  const { rows } = await pool.query(`${JOB_TITLE_SELECT} WHERE jt.job_title_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function jobTitleExists(id) {
  await ensureAuthSchema();
  const { rows } = await pool.query("SELECT 1 FROM job_title WHERE job_title_id = $1", [id]);
  return rows.length > 0;
}

export async function createJobTitle(name) {
  await ensureAuthSchema();
  const { rows } = await withConflict(JOB_TITLE_TAKEN, () =>
    pool.query("INSERT INTO job_title (name) VALUES ($1) RETURNING job_title_id", [name]),
  );
  return getJobTitle(rows[0].job_title_id);
}

export async function renameJobTitle(id, name) {
  await ensureAuthSchema();
  const { rowCount } = await withConflict(JOB_TITLE_TAKEN, () =>
    pool.query("UPDATE job_title SET name = $2 WHERE job_title_id = $1", [id, name]),
  );
  return rowCount === 0 ? null : getJobTitle(id);
}

// Users with this title are left without one (ON DELETE SET NULL).
export async function deleteJobTitle(id) {
  await ensureAuthSchema();
  const title = await getJobTitle(id);
  if (!title) return null;
  await pool.query("DELETE FROM job_title WHERE job_title_id = $1", [id]);
  return title;
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
