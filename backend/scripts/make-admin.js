// Gives an already registered user the built-in Admin role. Run locally: npm run make-admin -- user@example.com
import "dotenv/config";
import * as db from "../src/db.js";

const email = process.argv[2]?.trim().toLowerCase();

async function main() {
  if (!email) {
    console.error("Usage: npm run make-admin -- <email>");
    return 1;
  }
  const user = await db.getUserByEmail(email);
  if (!user) {
    console.error(`No user is registered with ${email}. Register first, then run this again.`);
    return 1;
  }
  if (user.role_key === "admin") {
    console.log(`${email} is already an admin.`);
    return 0;
  }
  const owned = await db.countCustomersOwnedBy(user.user_id);
  if (owned > 0) {
    console.error(`${email} still owns ${owned} customer(s). Reassign them before making this user an admin.`);
    return 1;
  }
  const admin = await db.getSystemRole("admin");
  await db.setUserRole(user.user_id, admin.role_id);
  console.log(`${email} is now an admin.`);
  return 0;
}

try {
  process.exitCode = await main();
} finally {
  await db.pool.end();
}
