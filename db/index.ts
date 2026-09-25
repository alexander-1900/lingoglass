import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * Turso/libSQL. Local dev works with zero accounts: `TURSO_DATABASE_URL`
 * unset falls back to a local SQLite file. Production (Cloudflare/Netlify)
 * sets a remote `libsql://…` URL + `TURSO_AUTH_TOKEN`.
 *
 * `db` is `null` when no database is configured (production without env
 * vars): auth-status reports it, /api/sync answers 503, and the Google
 * button hides — the app degrades to today's localStorage-only behavior.
 */
const url = process.env.TURSO_DATABASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : "file:lingoglass.db");

let client: Client | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (url) {
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  db = drizzle(client, { schema });
}

export { db };
export type Db = NonNullable<typeof db>;

export function isDbConfigured(): boolean {
  return db !== null;
}
