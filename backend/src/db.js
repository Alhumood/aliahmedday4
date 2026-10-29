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

// Every customer query is scoped to the owning sales user, so other users' rows are never visible.
const COLUMNS = "customer_id, name, email, phone, sales_user_id, created_at";

export async function listCustomers(userId) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM customer WHERE sales_user_id = $1 ORDER BY customer_id`,
    [userId],
  );
  return rows;
}

export async function getCustomerById(userId, id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM customer WHERE customer_id = $1 AND sales_user_id = $2`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function searchCustomersByName(userId, name) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM customer WHERE name ILIKE $1 AND sales_user_id = $2 ORDER BY customer_id`,
    [`%${name}%`, userId],
  );
  return rows;
}

export async function createCustomer(userId, { name, email = null, phone = null }) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `INSERT INTO customer (name, email, phone, sales_user_id) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [name, email, phone, userId],
  );
  return rows[0];
}

export async function updateCustomer(userId, id, { name, email, phone }) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `UPDATE customer SET
       name = COALESCE($3, name),
       email = COALESCE($4, email),
       phone = COALESCE($5, phone)
     WHERE customer_id = $1 AND sales_user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId, name ?? null, email ?? null, phone ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteCustomer(userId, id) {
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `DELETE FROM customer WHERE customer_id = $1 AND sales_user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId],
  );
  return rows[0] ?? null;
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
