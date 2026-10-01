// Shared password hashing for the /admin account — ONE implementation for
// both worlds: scripts/admin-create.mjs (Node 24) and the login endpoint in
// Pages Functions (Workers, nodejs_compat). Dependency-free by design:
// WebCrypto for PBKDF2 (available everywhere, no flag needed), lazy
// node:crypto import only on the scrypt path (Workers Paid option).
//
// Stored format is self-describing (PHC-ish, $-separated):
//   pbkdf2-sha256$<iterations>$<salt-b64url>$<key-b64url>
//   scrypt$<N>$<r>$<p>$<salt-b64url>$<key-b64url>
// Verification ALWAYS uses the parameters stored IN THE HASH, so tuning
// ADMIN_PBKDF2_ITERATIONS (or switching KDF later) only affects NEW hashes —
// existing logins keep verifying with no migration. Params are range-checked
// on read so a corrupted row can never turn verification into a CPU bomb.
//
// The plaintext password is never stored, logged, put in argv/env, or
// embedded in SQL (only the hash is).

export const DEFAULT_KDF = "pbkdf2-sha256";
export const DEFAULT_PBKDF2_ITERATIONS = 100000; // wrangler.jsonc: ADMIN_PBKDF2_ITERATIONS
export const DEFAULT_SCRYPT = { N: 32768, r: 8, p: 1 }; // 32 MiB — Paid-plan option
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024; // abuse guard, not a UX limit

const SALT_BYTES = 16;
const KEY_BYTES = 32;
// Hard ceilings: refuse absurd KDF parameters from a corrupted/hostile row.
const MAX_ITERATIONS = 10_000_000;
const MAX_SCRYPT_N = 1 << 20; // memory additionally capped via maxmem in scrypt()

/** Uint8Array → base64url (no padding, URL-safe). No Buffer: runs in Workers. */
export function b64urlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url → Uint8Array. Throws on malformed input (verifyPassword catches). */
export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + (b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4)));
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Normalized copy of the password, or throws. NFC so a decomposed keystroke
 *  on another OS still verifies against the same hash. */
function normalizePassword(password) {
  if (typeof password !== "string") throw new TypeError("password must be a string");
  if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError("password length must be 1.." + MAX_PASSWORD_LENGTH);
  }
  return password.normalize("NFC");
}

/** Constant-time byte compare (length difference short-circuits — fine here). */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derivePbkdf2(password, iterations, salt, keyBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    keyBytes * 8
  );
  return new Uint8Array(bits);
}

/** scrypt via node:crypto (supported in Workers with nodejs_compat; lazy so
 *  the PBKDF2 path never loads node:crypto at all). */
async function deriveScrypt(password, salt, keyBytes, { N, r, p }) {
  const [{ scrypt }, { Buffer }] = await Promise.all([
    import("node:crypto"),
    import("node:buffer"),
  ]);
  // maxmem: node's default 32 MiB sits exactly at 128*N*r for N=32768;
  // 96 MiB gives headroom while still bounding whatever parseHash accepted.
  const dk = await new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(password, "utf-8"),
      Buffer.from(salt),
      keyBytes,
      { N, r, p, maxmem: 96 * 1024 * 1024 },
      (err, out) => (err ? reject(err) : resolve(out))
    );
  });
  return new Uint8Array(dk);
}

function isScryptParams(N, r, p) {
  return (
    Number.isInteger(N) && N >= 1024 && N <= MAX_SCRYPT_N && (N & (N - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 && r <= 32 &&
    Number.isInteger(p) && p >= 1 && p <= 16
  );
}

function formatHash({ kdf, iterations, N, r, p, salt, key }) {
  const s = b64urlEncode(salt);
  const k = b64urlEncode(key);
  if (kdf === "pbkdf2-sha256") return `pbkdf2-sha256$${iterations}$${s}$${k}`;
  return `scrypt$${N}$${r}$${p}$${s}$${k}`;
}

/** Parse a stored hash into parameters. Null for anything malformed — callers
 *  must treat null as "verification failed", never as an error to retry. */
function parseHash(stored) {
  if (typeof stored !== "string" || stored.length > 1024) return null;
  const parts = stored.split("$");
  if (parts[0] === "pbkdf2-sha256" && parts.length === 4) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
      return null;
    }
    const salt = b64urlDecode(parts[2]);
    const key = b64urlDecode(parts[3]);
    if (salt.length < 8 || key.length < 16) return null;
    return { kdf: "pbkdf2-sha256", iterations, salt, key };
  }
  if (parts[0] === "scrypt" && parts.length === 6) {
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!isScryptParams(N, r, p)) return null;
    const salt = b64urlDecode(parts[4]);
    const key = b64urlDecode(parts[5]);
    if (salt.length < 8 || key.length < 16) return null;
    return { kdf: "scrypt", N, r, p, salt, key };
  }
  return null;
}

/**
 * Hash a new password. Throws on weak/invalid input — callers surface the
 * message rather than retry silently.
 * @param {string} password
 * @param {{kdf?: string, iterations?: number, N?: number, r?: number, p?: number,
 *          saltBytes?: number, keyBytes?: number}} [opts]
 * @returns {Promise<string>} self-describing hash string
 */
export async function hashPassword(password, opts = {}) {
  const normalized = normalizePassword(password);
  if (normalized.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const kdf = opts.kdf ?? DEFAULT_KDF;
  const salt = crypto.getRandomValues(new Uint8Array(opts.saltBytes ?? SALT_BYTES));
  const keyBytes = opts.keyBytes ?? KEY_BYTES;
  if (kdf === "pbkdf2-sha256") {
    const iterations = opts.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
      throw new RangeError("iterations out of range");
    }
    const key = await derivePbkdf2(normalized, iterations, salt, keyBytes);
    return formatHash({ kdf, iterations, salt, key });
  }
  if (kdf === "scrypt") {
    const N = opts.N ?? DEFAULT_SCRYPT.N;
    const r = opts.r ?? DEFAULT_SCRYPT.r;
    const p = opts.p ?? DEFAULT_SCRYPT.p;
    if (!isScryptParams(N, r, p)) {
      throw new RangeError("scrypt params invalid (N power of two 1024..2^20, r 1..32, p 1..16)");
    }
    const key = await deriveScrypt(normalized, salt, keyBytes, { N, r, p });
    return formatHash({ kdf, N, r, p, salt, key });
  }
  throw new RangeError(`unknown kdf: ${kdf}`);
}

/**
 * Verify a password against a stored hash. NEVER throws: any malformed or
 * hostile stored value is just a failed verification (login must not 500).
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  try {
    const parsed = parseHash(stored);
    if (!parsed) return false;
    const normalized = normalizePassword(password);
    const key =
      parsed.kdf === "pbkdf2-sha256"
        ? await derivePbkdf2(normalized, parsed.iterations, parsed.salt, parsed.key.length)
        : await deriveScrypt(normalized, parsed.salt, parsed.key.length, parsed);
    return timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

/** Non-secret parameters of a stored hash, for logs/UI ("pbkdf2-sha256, 100k"). */
export function describeHash(stored) {
  const parsed = parseHash(stored);
  if (!parsed) return null;
  const base = { kdf: parsed.kdf, saltBytes: parsed.salt.length, keyBytes: parsed.key.length };
  return parsed.kdf === "scrypt"
    ? { ...base, N: parsed.N, r: parsed.r, p: parsed.p }
    : { ...base, iterations: parsed.iterations };
}
