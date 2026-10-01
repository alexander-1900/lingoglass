// A09: durable audit trail for everything security-relevant. A failed audit
// write must never break the request it is describing (login still succeeds,
// logout still clears) — errors go to the function log instead.

import type { Env } from "./env";

export interface AuditEntry {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  detail?: unknown;
  ipHash?: string | null;
}

export async function audit(env: Env, entry: AuditEntry, now: number): Promise<void> {
  try {
    let detail: string | null = null;
    if (entry.detail !== undefined) {
      detail = JSON.stringify(entry.detail);
      if (detail.length > 2000) detail = detail.slice(0, 2000);
    }
    await env.DB.prepare(
      "INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail, ip_hash, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        entry.userId ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        detail,
        entry.ipHash ?? null,
        now
      )
      .run();
  } catch (err) {
    console.error("[audit] write failed:", err instanceof Error ? err.message : String(err));
  }
}
