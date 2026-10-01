// Cryptographic primitives for auth (Workers WebCrypto — no node:crypto needed).
// b64url helpers are REUSED from scripts/lib/password.mjs so the hash format
// and every encoder in the repo stay single-source.

import { b64urlEncode, b64urlDecode } from "../../scripts/lib/password.mjs";
import type { Env } from "./env";

const textEncoder = new TextEncoder();

/** Cryptographically random URL-safe token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export { b64urlEncode, b64urlDecode };

/** SHA-256 → lowercase hex. Used for session token hashes (indexed lookup). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** HMAC-SHA256 → raw bytes (CSRF token signing). */
export async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(message));
  return new Uint8Array(sig);
}

/** Constant-time byte compare (XOR fold — length mismatch short-circuits). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

let warnedMissingSalt = false;

/**
 * Privacy-preserving client identifier: SHA-256(salt | IP). Raw IPs are never
 * stored (A09/GDPR-friendly). Uses CF-Connecting-IP, which only Cloudflare
 * sets at the edge. Missing IP_HASH_SALT (local dev) falls back to a dev salt
 * and warns once — in production the secret must exist.
 */
export async function hashIp(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const salt = env.IP_HASH_SALT;
  if (!salt && !warnedMissingSalt) {
    warnedMissingSalt = true;
    console.warn("[auth] IP_HASH_SALT unset — using the development-only fallback salt");
  }
  return sha256Hex(`${salt ?? "lingoglass-dev-ip-salt"}\u0000${ip}`);
}
