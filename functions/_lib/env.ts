/**
 * Runtime contract for the admin Pages Functions: bindings (from wrangler.jsonc,
 * which is the Pages project's source of truth) + non-secret config vars.
 * Secrets (IP_HASH_SALT, DEPLOY_HOOK_URL) are optional so local dev without
 * .dev.vars still runs — helpers below document the fallbacks.
 */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ADMIN_SITE_ORIGIN: string;
  ADMIN_SESSION_TTL_HOURS: string;
  ADMIN_IDLE_TTL_MINUTES: string;
  ADMIN_PASSWORD_KDF: string;
  ADMIN_PBKDF2_ITERATIONS: string;
  ADMIN_LOGIN_MAX_ATTEMPTS: string;
  ADMIN_LOGIN_WINDOW_MINUTES: string;
  ADMIN_LOCKOUT_MINUTES: string;
  ADMIN_MAX_UPLOAD_BYTES: string;
  /** Secret — dashboard (Production scope only) or .dev.vars locally. */
  IP_HASH_SALT?: string;
  /** Secret — Phase 6 deploy-hook URL. */
  DEPLOY_HOOK_URL?: string;
}

/** Data attached to EventContext by the /api/admin middleware.
 *  Index signature: PagesFunction's Data generic is constrained to
 *  Record<string, unknown>. */
export interface AdminData {
  session?: import("./session").SessionInfo;
  [key: string]: unknown;
}

/**
 * Read an integer var with clamping. Wrangler vars arrive as strings;
 * anything unparseable falls back instead of throwing (a bad var must never
 * take the admin panel down).
 */
export function intVar(
  env: Env,
  name: keyof Env,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name];
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
