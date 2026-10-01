// Auth-scoped D1 access. EVERY statement is a prepared .bind() call — no
// string-built SQL anywhere in this repo's Functions (A03).

import type { Env } from "./env";

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  disabled: number;
  locked_until: number | null;
  failed_attempts: number;
}

/** Username lookup — the column is COLLATE NOCASE UNIQUE, so `=` is case-insensitive. */
export async function getAdminUser(env: Env, username: string): Promise<AdminUserRow | null> {
  const row = await env.DB.prepare(
    "SELECT id, username, password_hash, disabled, locked_until, failed_attempts " +
      "FROM admin_users WHERE username = ?"
  )
    .bind(username)
    .first<AdminUserRow>();
  return row ?? null;
}

