import { Router } from "express";
import { z } from "zod";
import * as auth from "./service.js";
import { startGoogle, finishGoogle } from "./google.js";
import { setSessionCookie, clearSessionCookie, destroySession, destroyAllSessions } from "./session.js";
import { requireAuth, limitIp } from "./middleware.js";
import { config } from "./lib.js";

const emailS = z.string().trim().toLowerCase().email().max(254);
const passwordS = z.string().min(10, "At least 10 characters").max(128);
const tokenS = z.string().min(20).max(100);
const GENERIC = { message: "If that address is valid, check your inbox." };

const r = Router();

r.post("/register", limitIp("register", 5, 3600), async (req, res) => {
  const b = z.object({ email: emailS, password: passwordS, name: z.string().trim().max(80).optional() })
    .parse(req.body ?? {});
  await auth.register(b.email, b.password, b.name);
  res.status(202).json(GENERIC);
});

r.post("/verify-email", limitIp("verify", 20, 900), async (req, res) => {
  const { token } = z.object({ token: tokenS }).parse(req.body ?? {});
  setSessionCookie(res, await auth.verifyEmail(token, req));
  res.json({ ok: true });
});

r.post("/login", limitIp("login", 30, 900), async (req, res) => {
  const b = z.object({ email: emailS, password: z.string().max(128) }).parse(req.body ?? {});
  setSessionCookie(res, await auth.login(b.email, b.password, req));
  res.json({ ok: true });
});

r.post("/magic/request", limitIp("magic", 10, 3600), async (req, res) => {
  const { email } = z.object({ email: emailS }).parse(req.body ?? {});
  await auth.requestMagicLink(email, req);
  res.status(202).json(GENERIC);
});

r.post("/magic/verify", limitIp("magicv", 20, 900), async (req, res) => {
  const { token } = z.object({ token: tokenS }).parse(req.body ?? {});
  setSessionCookie(res, await auth.verifyMagicLink(token, req));
  res.json({ ok: true });
});

r.post("/password/forgot", limitIp("forgot", 10, 3600), async (req, res) => {
  const { email } = z.object({ email: emailS }).parse(req.body ?? {});
  await auth.forgotPassword(email);
  res.status(202).json(GENERIC);
});

r.post("/password/reset", limitIp("reset", 10, 900), async (req, res) => {
  const b = z.object({ token: tokenS, newPassword: passwordS }).parse(req.body ?? {});
  await auth.resetPassword(b.token, b.newPassword);
  res.json({ ok: true }); // user must log in again
});

r.post("/password/change", requireAuth, async (req, res) => {
  const b = z.object({ currentPassword: z.string().max(128), newPassword: passwordS }).parse(req.body ?? {});
  await auth.changePassword(req.user.id, b.currentPassword, b.newPassword, req.session.hash);
  res.json({ ok: true });
});

r.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

r.post("/logout", requireAuth, async (req, res) => {
  await destroySession(req.session.hash, req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

r.post("/logout-all", requireAuth, async (req, res) => {
  await destroyAllSessions(req.user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* Google: top-level browser navigations (GET) */
r.get("/google", limitIp("gstart", 20, 900), async (req, res) => {
  res.redirect(await startGoogle(res));
});
r.get("/google/callback", limitIp("gcb", 20, 900), async (req, res) => {
  setSessionCookie(res, await finishGoogle(req, res));
  res.redirect(`${config.appUrl}/dashboard`);
});

export default r;