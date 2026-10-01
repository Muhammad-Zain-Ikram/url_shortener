import { db, randomToken, sha256 } from "./lib.js";

// Create a single-use token. Older unused tokens of the same purpose are voided,
// so only the newest email link works.
export async function createToken(userId, purpose, ttlMinutes) {
  const raw = randomToken();
  await db.query(
    `UPDATE auth_tokens SET used_at = now()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose]
  );
  await db.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, sha256(raw), ttlMinutes]
  );
  return raw; // only ever sent by email, never stored
}

// Atomic "check + mark used" in ONE statement => two simultaneous clicks cannot both win.
export async function consumeToken(raw, purpose) {
  const { rows } = await db.query(
    `UPDATE auth_tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [sha256(raw), purpose]
  );
  return rows[0]?.user_id ?? null;
}