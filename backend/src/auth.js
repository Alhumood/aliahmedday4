import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const TOKEN_LIFETIME = "8h";

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
  return jwt.sign({ sub: String(user.user_id), email: user.email, role: user.role }, getSecret(), {
    expiresIn: TOKEN_LIFETIME,
  });
}

// Sets req.user from the Bearer token; responds 401 when it is missing, invalid or expired.
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  let secret;
  try {
    secret = getSecret();
  } catch (err) {
    return next(err);
  }
  try {
    const payload = jwt.verify(token, secret);
    req.user = { user_id: Number(payload.sub), email: payload.email, role: payload.role };
    next();
  } catch (err) {
    const error = err.name === "TokenExpiredError" ? "Session expired, please log in again" : "Authentication required";
    res.status(401).json({ error });
  }
}
