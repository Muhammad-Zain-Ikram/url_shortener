import { ZodError } from "zod";
import { db, config, hit, HttpError } from "./lib.js";
import { getSession, SESSION_COOKIE } from "./session.js";

// CSRF layer 2 (layer 1 is SameSite=Lax): state-changing requests must come from our frontend.
export function originCheck(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("origin") !== config.appUrl) return res.status(403).json({ error: "Bad origin" });
  next();
}

export function limitIp(name, limit, windowSec) {
  return async (req, res, next) => {
    if (!(await hit(`${name}:ip:${req.ip}`, limit, windowSec)))
      return res.status(429).json({ error: "Too many requests" });
    next();
  };
}

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? await getSession(token) : null;
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  const { rows: [user] } = await db.query(
    "SELECT id, email, name, email_verified FROM users WHERE id = $1", [session.userId]);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.session = session; // { userId, hash, ... }
  req.user = user;
  next();
}

export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError)
    return res.status(400).json({ error: "Invalid input",
      details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err); // never send internals to the client
  res.status(500).json({ error: "Internal server error" });
}