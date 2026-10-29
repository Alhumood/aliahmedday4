import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getUserById } from "./db.js";
import { can } from "./permissions.js";

const TOKEN_LIFETIME = "8h";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

function getSecret() {
  if (!process.env.JWT_SECRET) {
    const err = new Error("JWT_SECRET is not set in backend/.env");
    err.status = 503;
    throw err;
  }
  return process.env.JWT_SECRET;
}

export const hashPassword = (password) => bcrypt.hash(password, 10);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

export function signToken(user) {
  return jwt.sign({ sub: String(user.user_id), email: user.email }, getSecret(), {
    expiresIn: TOKEN_LIFETIME,
  });
}

// Sets req.user from the Bearer token; responds 401 when it is missing, invalid or expired.
// The user, role and permissions are reloaded from the database, so role changes apply immediately.
export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  let payload;
  try {
    payload = jwt.verify(token, getSecret());
  } catch (err) {
    if (err.status) return next(err);
    const error = err.name === "TokenExpiredError" ? "Session expired, please log in again" : "Authentication required";
    return res.status(401).json({ error });
  }
  try {
    const user = await getUserById(Number(payload.sub));
    if (!user) return res.status(401).json({ error: "Authentication required" });
    req.user = {
      user_id: user.user_id,
      email: user.email,
      role_id: user.role_id,
      role: user.role,
      permissions: user.permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}

// Responds 403 unless the user's role grants `key` (see permissions.js).
export function requirePermission(key) {
  return (req, res, next) => {
    if (!can(req.user, key)) return res.status(403).json({ error: `Permission required: ${key}` });
    next();
  };
}
