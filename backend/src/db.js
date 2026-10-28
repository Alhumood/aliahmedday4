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
