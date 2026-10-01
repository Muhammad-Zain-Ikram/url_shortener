import argon2 from "argon2";
import { db, config, hit, HttpError, normalizeEmail, sendBackground } from "./lib.js";
import { createSession, destroyAllSessions } from "./session.js";
import { createToken, consumeToken } from "./tokens.js";

// OWASP-recommended argon2id minimum settings
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Verified against when the user does not exist, so timing is the same either way.
const DUMMY_HASH = await argon2.hash("dummy-password-for-timing", ARGON);

const link = (path, token) => `${config.appUrl}${path}?token=${token}`;

/* ---------- Register + verify email ---------- */
export async function register(email, password, name) {
  email = normalizeEmail(email);
  const hash = await argon2.hash(password, ARGON);
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, hash, name ?? null]
  );
  if (rows[0]) {
    const t = await createToken(rows[0].id, "verify_email", 60 * 24);
    sendBackground({ to: email, subject: "Verify your email",
      text: `Confirm your account:\n${link("/auth/verify-email", t)}\n\nExpires in 24 hours.` });
  } else {
    // Same HTTP response as success; the real owner is told by email instead.
    sendBackground({ to: email, subject: "Sign-up attempt",
      text: `Someone tried to sign up with this email, but you already have an account.\nSign in or reset your password: ${config.appUrl}/login` });
  }
}

export async function verifyEmail(token, req) {
  const userId = await consumeToken(token, "verify_email");
  if (!userId) throw new HttpError(400, "Link is invalid or expired.");
  await db.query("UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1", [userId]);
  return createSession(userId, req);
}

/* ---------- Password login ---------- */
export async function login(email, password, req) {
  email = normalizeEmail(email);
  // Two limits: per email+IP (stops guessing) and per email (stops distributed guessing).
  // Trade-off: the per-email limit lets an attacker annoy a victim, so keep it generous.
  const ok1 = await hit(`login:${email}:${req.ip}`, 5, 900);
  const ok2 = await hit(`login:${email}`, 20, 3600);
  if (!ok1 || !ok2) throw new HttpError(429, "Too many attempts. Try again later.");

  const { rows: [user] } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  const valid = await argon2.verify(user?.password_hash ?? DUMMY_HASH, password).catch(() => false);
  if (!user || !user.password_hash || !valid) throw new HttpError(401, "Invalid email or password.");
  if (!user.email_verified) throw new HttpError(403, "Please verify your email first.");

  if (argon2.needsRehash(user.password_hash, ARGON)) {
    const newHash = await argon2.hash(password, ARGON);
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, newHash]);
  }
  return createSession(user.id, req);
}

/* ---------- Magic link ---------- */
export async function requestMagicLink(email, req) {
  email = normalizeEmail(email);
  if (!(await hit(`magic:${email}`, 5, 3600))) return; // silently stop; response stays generic
  // Find or create (passwordless signup). Becomes verified only when the link is used.
  const { rows: [user] } = await db.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [email]
  );
  const t = await createToken(user.id, "magic_login", 15);
  sendBackground({ to: email, subject: "Your sign-in link",
    text: `Sign in:\n${link("/auth/magic", t)}\n\nExpires in 15 minutes. If you did not request this, ignore it.` });
}

export async function verifyMagicLink(token, req) {
  const userId = await consumeToken(token, "magic_login");
  if (!userId) throw new HttpError(400, "Link is invalid or expired.");
  // Proving inbox access verifies the email.
  await db.query("UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1", [userId]);
  return createSession(userId, req);
}

/* ---------- Forgot / reset / change password ---------- */
export async function forgotPassword(email) {
  email = normalizeEmail(email);
  if (!(await hit(`forgot:${email}`, 3, 3600))) return;
  const { rows: [user] } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if (!user) return; // no error, no difference in response
  const t = await createToken(user.id, "reset_password", 30);
  sendBackground({ to: email, subject: "Reset your password",
    text: `Reset link (valid 30 minutes):\n${link("/auth/reset-password", t)}\n\nIf you did not request this, ignore it.` });
}

export async function resetPassword(token, newPassword) {
  const userId = await consumeToken(token, "reset_password");
  if (!userId) throw new HttpError(400, "Link is invalid or expired.");
  const hash = await argon2.hash(newPassword, ARGON);
  const { rows: [u] } = await db.query(
    `UPDATE users SET password_hash = $2, email_verified = true, updated_at = now()
     WHERE id = $1 RETURNING email`, [userId, hash]);
  await destroyAllSessions(userId); // anyone logged in with the old password is out
  sendBackground({ to: u.email, subject: "Your password was changed",
    text: "Your password was just reset. If this was not you, contact support immediately." });
}

export async function changePassword(userId, currentPassword, newPassword, keepSessionHash) {
  const { rows: [u] } = await db.query("SELECT email, password_hash FROM users WHERE id = $1", [userId]);
  const ok = u?.password_hash && (await argon2.verify(u.password_hash, currentPassword).catch(() => false));
  if (!ok) throw new HttpError(401, "Current password is incorrect.");
  const hash = await argon2.hash(newPassword, ARGON);
  await db.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [userId, hash]);
  await destroyAllSessions(userId, keepSessionHash); // other devices out, this one stays
  sendBackground({ to: u.email, subject: "Your password was changed",
    text: "Your password was just changed. If this was not you, reset it immediately." });
}