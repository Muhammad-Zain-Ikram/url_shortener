import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { db, redis, config, HttpError, randomToken } from "./lib.js";
import { createSession, destroyAllSessions } from "./session.js";

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${config.apiUrl}/auth/google/callback`
);

// Step 1: build the Google URL. state (CSRF) + PKCE verifier are bound to this browser.
export async function startGoogle(res) {
  const state = randomToken();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  await redis.set(`oauth:${state}`, codeVerifier, "EX", 600);
  res.cookie("oauth_state", state, {
    httpOnly: true, secure: config.isProd, sameSite: "lax", maxAge: 600_000, path: "/auth/google",
  });
  return client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    prompt: "select_account",
  });
}

// Step 2: validate state, exchange code, verify the ID token, find/link/create the user.
export async function finishGoogle(req, res) {
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string" || state !== req.cookies?.oauth_state)
    throw new HttpError(400, "Invalid OAuth state.");
  res.clearCookie("oauth_state", { path: "/auth/google" });

  const codeVerifier = await redis.getdel(`oauth:${state}`); // single use
  if (!codeVerifier) throw new HttpError(400, "OAuth session expired.");

  const { tokens } = await client.getToken({ code, codeVerifier });
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new HttpError(403, "Google email is not verified.");
  const email = p.email.toLowerCase();

  // 1) Returning Google user (match on the stable "sub", never only on email)
  let { rows: [user] } = await db.query("SELECT * FROM users WHERE google_sub = $1", [p.sub]);

  if (!user) {
    const { rows: [existing] } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing) {
      // 2) Link to existing account. Pre-hijack defence: if the old account never proved
      //    its email, an attacker may have set that password. Wipe it and kill sessions.
      if (!existing.email_verified) {
        await db.query("UPDATE users SET password_hash = NULL WHERE id = $1", [existing.id]);
        await destroyAllSessions(existing.id);
      }
      ({ rows: [user] } = await db.query(
        `UPDATE users SET google_sub = $2, email_verified = true,
           name = COALESCE(name, $3), updated_at = now()
         WHERE id = $1 RETURNING *`, [existing.id, p.sub, p.name ?? null]));
    } else {
      // 3) Brand new user
      ({ rows: [user] } = await db.query(
        `INSERT INTO users (email, email_verified, google_sub, name)
         VALUES ($1, true, $2, $3) RETURNING *`, [email, p.sub, p.name ?? null]));
    }
  }
  return createSession(user.id, req);
}