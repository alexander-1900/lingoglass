// Login rate limiting + account lockout (A07). Backed by login_attempts
// (sliding windows, works for UNKNOWN usernames too → no enumeration oracle)
// plus admin_users.locked_until for explicit locks. Responses after the limit
// is hit are byte-identical whether the username exists or not.

import type { Env } from "./env";
import { intVar } from "./env";

/** Per-IP allowance as a multiple of the per-username cap. */
const IP_MULTIPLIER = 3;

export interface RateDecision {
  ok: boolean;
  retryAfterSec: number;
}

interface WindowRow {
  c: number;
  oldest: number | null;
}

function limits(env: Env) {
  return {
    max: intVar(env, "ADMIN_LOGIN_MAX_ATTEMPTS", 5, 1, 100),
    windowSec: intVar(env, "ADMIN_LOGIN_WINDOW_MINUTES", 15, 1, 1440) * 60,
    lockSec: intVar(env, "ADMIN_LOCKOUT_MINUTES", 15, 1, 1440) * 60,
  };
}

/**
 * Pre-attempt gate (also re-run after a recorded failure so the attempt that
 * REACHES the limit returns 429 + Retry-After immediately, for both existing
 * and non-existing usernames — uniform behavior).
 */
export async function checkLoginRate(
  env: Env,
  username: string,
  ipHash: string,
  now: number
): Promise<RateDecision> {
  const { max, windowSec } = limits(env);

  const user = await env.DB.prepare(
    "SELECT locked_until FROM admin_users WHERE username = ?"
  )
    .bind(username)
    .first<{ locked_until: number | null }>();
  if (user?.locked_until && user.locked_until > now) {
    return { ok: false, retryAfterSec: user.locked_until - now };
  }

  const byName = await env.DB.prepare(
    "SELECT COUNT(*) AS c, MIN(attempted_at) AS oldest FROM login_attempts " +
      "WHERE username = ? AND success = 0 AND attempted_at >= ?"
  )
    .bind(username, now - windowSec)
    .first<WindowRow>();
  if ((byName?.c ?? 0) >= max) {
    const oldest = byName?.oldest ?? now;
    return { ok: false, retryAfterSec: Math.max(1, oldest + windowSec - now) };
  }

  const byIp = await env.DB.prepare(
    "SELECT COUNT(*) AS c, MIN(attempted_at) AS oldest FROM login_attempts " +
      "WHERE ip_hash = ? AND success = 0 AND attempted_at >= ?"
  )
    .bind(ipHash, now - windowSec)
    .first<WindowRow>();
  if ((byIp?.c ?? 0) >= max * IP_MULTIPLIER) {
    const oldest = byIp?.oldest ?? now;
    return { ok: false, retryAfterSec: Math.max(1, oldest + windowSec - now) };
  }

  return { ok: true, retryAfterSec: 0 };
}

/** Persist a failed attempt; set/extend the explicit lock when the cap is hit. */
export async function recordLoginFailure(
  env: Env,
  opts: { username: string; ipHash: string; now: number; userId: number | null }
): Promise<void> {
  const { max, lockSec } = limits(env);
  const statements = [
    env.DB.prepare(
      "INSERT INTO login_attempts (username, ip_hash, attempted_at, success) VALUES (?, ?, ?, 0)"
    ).bind(opts.username, opts.ipHash, opts.now),
  ];
  if (opts.userId !== null) {
    // failed_attempts + 1 is evaluated against the OLD row value inside CASE —
    // the lock flips exactly when the max-th failure lands.
    statements.push(
      env.DB.prepare(
        "UPDATE admin_users SET failed_attempts = failed_attempts + 1, " +
          "locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END, " +
          "updated_at = ? WHERE id = ?"
      ).bind(max, opts.now + lockSec, opts.now, opts.userId)
    );
  }
  await env.DB.batch(statements);
}

/** Successful login: clear the username's failure window, keep IP history honest. */
export async function recordLoginSuccess(
  env: Env,
  opts: { username: string; userId: number; ipHash: string; now: number }
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE username = ? AND success = 0").bind(
      opts.username
    ),
    env.DB.prepare(
      "INSERT INTO login_attempts (username, ip_hash, attempted_at, success) VALUES (?, ?, ?, 1)"
    ).bind(opts.username, opts.ipHash, opts.now),
    env.DB.prepare(
      "UPDATE admin_users SET last_login_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?"
    ).bind(opts.now, opts.userId),
  ]);
}
