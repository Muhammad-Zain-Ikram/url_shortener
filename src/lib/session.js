import { redis, config, randomToken, sha256 } from "./lib.js";

const COOKIE = "sid";
const sessKey = (hash) => `sess:${hash}`;
const userKey = (userId) => `user_sessions:${userId}`;

// The cookie holds a random token; Redis is keyed by its HASH,
// so even a Redis dump cannot be replayed as a cookie.
export async function createSession(userId, req) {
  const token = randomToken(); // always a NEW id on login => no session fixation
  const hash = sha256(token);
  const data = JSON.stringify({
    userId,
    createdAt: Date.now(),
    ua: (req.get("user-agent") || "").slice(0, 200),
    ip: req.ip,
  });
  await redis.multi()
    .set(sessKey(hash), data, "EX", config.sessionTtl)
    .sadd(userKey(userId), hash)
    .exec();
  return token;
}

export async function getSession(token) {
  const hash = sha256(token);
  const raw = await redis.get(sessKey(hash));
  if (!raw) return null;
  await redis.expire(sessKey(hash), config.sessionTtl); // sliding expiry
  return { ...JSON.parse(raw), hash };
}

export async function destroySession(hash, userId) {
  await redis.multi().del(sessKey(hash)).srem(userKey(userId), hash).exec();
}

// Use after password change/reset. Pass keepHash to keep the current device logged in.
export async function destroyAllSessions(userId, keepHash = null) {
  const hashes = (await redis.smembers(userKey(userId))).filter((h) => h !== keepHash);
  if (!hashes.length) return;
  await redis.multi()
    .del(...hashes.map(sessKey))
    .srem(userKey(userId), ...hashes)
    .exec();
}

const cookieOpts = {
  httpOnly: true,                 // JS (and XSS) cannot read it
  secure: config.isProd,          // HTTPS only in production
  sameSite: "lax",                // blocks cross-site POST/CSRF, allows normal link clicks
  path: "/",
};
export const setSessionCookie = (res, token) =>
  res.cookie(COOKIE, token, { ...cookieOpts, maxAge: config.sessionTtl * 1000 });
export const clearSessionCookie = (res) => res.clearCookie(COOKIE, cookieOpts);
export const SESSION_COOKIE = COOKIE;