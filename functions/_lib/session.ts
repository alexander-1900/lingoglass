// Server-side sessions: opaque 256-bit cookie token → SHA-256 hash lookup,
// sliding idle timeout, absolute expiry, revocation, and HMAC-signed CSRF
// tokens bound to one session. The raw token exists only in the browser's
// HttpOnly cookie; the DB stores hashes and a per-session CSRF secret.

import type { Env } from "./env";
import { intVar } from "./env";
import { randomToken, sha256Hex, hmacSha256, timingSafeEqual, b64urlEncode, b64urlDecode, hashIp } from "./crypto";

export interface SessionInfo {
  id: number;
  userId: number;
  username: string;
  tokenHash: string;
  csrfSecret: string;
  expiresAt: number;
  lastSeenAt: number;
}

interface SessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  csrf_secret: string;
  expires_at: number;
  last_seen_at: number;
  revoked_at: number | null;
  username: string;
  disabled: number;
}

/** __Host- prefix needs Secure + Path=/ + no Domain — i.e. HTTPS (production).
 *  wrangler pages dev serves plain http://localhost, where browsers reject
 *  Secure cookies, so dev uses a separate unprefixed name. */
function cookieNameFor(request: Request): { name: string; secure: boolean } {
  const secure = new URL(request.url).protocol === "https:";
  return secure ? { name: "__Host-lg_admin", secure: true } : { name: "lg_admin_local", secure: false };
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const { name } = cookieNameFor(request);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      if (value) return value;
    }
  }
  return null;
}

export function serializeSessionCookie(request: Request, token: string, maxAgeSec: number): string {
  const { name, secure } = cookieNameFor(request);
  const attrs = `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
  return secure ? `${attrs}; Secure` : attrs;
}

export function clearSessionCookie(request: Request): string {
  const { name, secure } = cookieNameFor(request);
  const attrs = `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return secure ? `${attrs}; Secure` : attrs;
}

function sessionTtlSec(env: Env): number {
  return intVar(env, "ADMIN_SESSION_TTL_HOURS", 12, 1, 720) * 3600;
}

/** Mint a fresh session (login always creates a NEW token — rotation). */
export async function createSession(
  env: Env,
  request: Request,
  userId: number,
  now: number
): Promise<{ token: string; maxAgeSec: number; tokenHash: string; csrfSecret: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const csrfSecret = randomToken(32);
  const uaHash = await sha256Hex((request.headers.get("User-Agent") ?? "").slice(0, 512));
  const ipHash = await hashIp(request, env);
  const maxAgeSec = sessionTtlSec(env);
  await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, csrf_secret, ua_hash, ip_hash, created_at, last_seen_at, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(userId, tokenHash, csrfSecret, uaHash, ipHash, now, now, now + maxAgeSec)
    .run();
  return { token, maxAgeSec, tokenHash, csrfSecret };
}

/** Resolve the request's cookie to a live session, or null (never throws). */
export async function loadSession(env: Env, request: Request, now: number): Promise<SessionInfo | null> {
  try {
    const token = readSessionToken(request);
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT s.id, s.user_id, s.token_hash, s.csrf_secret, s.expires_at, s.last_seen_at, s.revoked_at, " +
        "u.username, u.disabled FROM sessions s JOIN admin_users u ON u.id = s.user_id " +
        "WHERE s.token_hash = ?"
    )
      .bind(tokenHash)
      .first<SessionRow>();
    if (!row) return null;
    if (row.revoked_at !== null || row.expires_at <= now || row.disabled !== 0) return null;
    const idleSec = intVar(env, "ADMIN_IDLE_TTL_MINUTES", 120, 1, 43200) * 60;
    if (now - row.last_seen_at > idleSec) return null;
    // Throttled sliding-window touch (≥5 min apart) — one small write per 5 min
    // of active browsing, not per request (A04 write-amplification guard).
    if (now - row.last_seen_at >= 300) {
      try {
        await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
          .bind(now, row.id)
          .run();
      } catch (err) {
        console.error("[session] touch failed:", err instanceof Error ? err.message : String(err));
      }
    }
    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      tokenHash: row.token_hash,
      csrfSecret: row.csrf_secret,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
    };
  } catch (err) {
    console.error("[session] load failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function revokeSession(env: Env, sessionId: number, now: number): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, sessionId)
    .run();
}

/** Opportunistic cleanup (called on login): expired + revoked rows older than a day. */
export async function pruneSessions(env: Env, now: number): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)"
  )
    .bind(now - 86400, now - 86400)
    .run();
}

// ---- CSRF tokens (double design: signed + session-bound + expiring) --------
// token = "v1.<issuedAtSec>.<nonce>.<base64url(HMAC)>"
// The HMAC key is the per-session csrf_secret (never leaves the server); the
// message binds to this session's token hash, so a token minted for one
// session is meaningless on another. Verified on every mutating request.

const CSRF_TTL_SEC = 7200;
const CSRF_MAX_SKEW_SEC = 60;

export async function issueCsrfToken(
  session: Pick<SessionInfo, "tokenHash" | "csrfSecret">,
  now: number
): Promise<string> {
  const payload = `${now}.${randomToken(9)}`;
  const sig = await hmacSha256(session.csrfSecret, `${session.tokenHash}|${payload}`);
  return `v1.${payload}.${b64urlEncode(sig)}`;
}

export async function verifyCsrfToken(
  session: Pick<SessionInfo, "tokenHash" | "csrfSecret">,
  token: string | null,
  now: number
): Promise<boolean> {
  try {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return false;
    const issuedAt = Number(parts[1]);
    if (!Number.isInteger(issuedAt) || !parts[2]) return false;
    const age = now - issuedAt;
    if (age < -CSRF_MAX_SKEW_SEC || age > CSRF_TTL_SEC) return false;
    const expected = await hmacSha256(
      session.csrfSecret,
      `${session.tokenHash}|${parts[1]}.${parts[2]}`
    );
    let provided: Uint8Array;
    try {
      provided = b64urlDecode(parts[3]);
    } catch {
      return false;
    }
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}
