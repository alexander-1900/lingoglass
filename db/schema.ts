import { sqliteTable, text, integer, uniqueIndex, primaryKey, index } from "drizzle-orm/sqlite-core";

/**
 * Auth.js standard tables (required shape for @auth/drizzle-adapter).
 * The `sessions` and `verificationToken` tables are unused at runtime —
 * we run the JWT session strategy — but the adapter expects them to exist.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
  image: text("image"),
}, (t) => [uniqueIndex("users_email_unique").on(t.email)]);

export const accounts = sqliteTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: integer("expires_at"),
  tokenType: text("token_type"),
  scope: text("scope"),
  idToken: text("id_token"),
  sessionState: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationToken = sqliteTable("verification_token", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

/**
 * App data. Bookmarks reuse the client-generated id so a device-local entry
 * and its server row share identity. `wordKey` is the case-insensitive
 * dedupe key (mirrors lib/bookmarks.ts dedupeKey semantics).
 */
export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lang: text("lang").notNull(),
  level: text("level").notNull(),
  slug: text("slug").notNull(),
  sentIdx: integer("sent_idx").notNull(),
  word: text("word").notNull(),
  wordKey: text("word_key").notNull(),
  note: text("note"),
  englishMeaning: text("english_meaning"),
  reading: text("reading"),
  romaji: text("romaji"),
  context: text("context"),
  contextEn: text("context_en"),
  savedAt: integer("saved_at").notNull(),
  deletedAt: integer("deleted_at"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("bookmarks_user_idx").on(t.userId)]);

/** Reading position per story. Composite key = (user, story). */
export const progress = sqliteTable("progress", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lang: text("lang").notNull(),
  level: text("level").notNull(),
  slug: text("slug").notNull(),
  lastIdx: integer("last_idx").notNull(),
  maxIdx: integer("max_idx").notNull(),
  total: integer("total").notNull(),
  completedAt: integer("completed_at"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.lang, t.level, t.slug] })]);
