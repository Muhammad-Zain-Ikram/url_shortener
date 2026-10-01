import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const links = pgTable("links", {
  id: serial("id").primaryKey(),
  originalUrl: text("original_url").notNull(),
  shortLink: varchar("short_link", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// CREATE EXTENSION IF NOT EXISTS citext;

// CREATE TABLE users (
//   id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   email          citext UNIQUE NOT NULL,          -- case-insensitive uniqueness
//   email_verified boolean NOT NULL DEFAULT false,
//   password_hash  text,                            -- NULL for Google/magic-link-only users
//   google_sub     text UNIQUE,
//   name           text,
//   created_at     timestamptz NOT NULL DEFAULT now(),
//   updated_at     timestamptz NOT NULL DEFAULT now()
// );

// -- One table for verify-email, magic-login and reset-password tokens.
// -- We store only the SHA-256 hash, so a DB leak does not leak usable links.
// CREATE TABLE auth_tokens (
//   id         bigserial PRIMARY KEY,
//   user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//   purpose    text NOT NULL CHECK (purpose IN ('verify_email','magic_login','reset_password')),
//   token_hash text UNIQUE NOT NULL,
//   expires_at timestamptz NOT NULL,
//   used_at    timestamptz,
//   created_at timestamptz NOT NULL DEFAULT now()
// );
// CREATE INDEX auth_tokens_user_purpose ON auth_tokens(user_id, purpose);
// -- Cron idea: DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days';