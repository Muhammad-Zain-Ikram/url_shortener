import crypto from "node:crypto";
import pg from "pg";
import Redis from "ioredis";
import nodemailer from "nodemailer";

export const config = {
  isProd: process.env.NODE_ENV === "production",
  appUrl: process.env.APP_URL,   // frontend origin, e.g. https://app.example.com
  apiUrl: process.env.API_URL,   // api origin (used for Google redirect URI)
  sessionTtl: 60 * 60 * 24 * 30, // 30 days, sliding
};

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const redis = new Redis(process.env.REDIS_URL);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const normalizeEmail = (e) => e.trim().toLowerCase();

// Fixed-window counter in Redis. Returns false when the limit is exceeded.
export async function hit(key, limit, windowSec) {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1 || (await redis.ttl(k)) === -1) await redis.expire(k, windowSec);
  return n <= limit;
}

const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

// Fire-and-forget so response time does not reveal whether an email was sent.
export function sendBackground({ to, subject, text }) {
  const job = transport
    ? transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text })
    : Promise.resolve(console.log(`\n[DEV MAIL] to=${to}\n${subject}\n${text}\n`));
  job.catch((e) => console.error("mail failed:", e.message));
}