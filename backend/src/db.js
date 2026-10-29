import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const COLUMNS = "customer_id, name, email, phone, created_at";

export async function listCustomers() {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM customer ORDER BY customer_id`);
  return rows;
}

export async function getCustomerById(id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM customer WHERE customer_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function searchCustomersByName(name) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM customer WHERE name ILIKE $1 ORDER BY customer_id`,
    [`%${name}%`],
  );
  return rows;
}

export async function createCustomer({ name, email = null, phone = null }) {
  const { rows } = await pool.query(
    `INSERT INTO customer (name, email, phone) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [name, email, phone],
  );
  return rows[0];
}

export async function updateCustomer(id, { name, email, phone }) {
  const { rows } = await pool.query(
    `UPDATE customer SET
       name = COALESCE($2, name),
       email = COALESCE($3, email),
       phone = COALESCE($4, phone)
     WHERE customer_id = $1 RETURNING ${COLUMNS}`,
    [id, name ?? null, email ?? null, phone ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteCustomer(id) {
  const { rows } = await pool.query(
    `DELETE FROM customer WHERE customer_id = $1 RETURNING ${COLUMNS}`,
    [id],
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
