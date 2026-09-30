import { pgTable, serial, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const links = pgTable("links", {
  id: serial("id").primaryKey(),
  originalUrl: text("original_url").notNull(),
  shortLink: varchar("short_link", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});