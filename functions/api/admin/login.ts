// POST /api/admin/login — the only unauthenticated mutating endpoint.
// Protections: JSON-only + size cap, Origin check (middleware), sliding-window
// rate limit per username AND per IP + explicit lockout, uniform 401s, dummy
// verification for unknown users (no enumeration via timing), fresh session
// token per login, audit trail. The verify CPU time is logged WITHOUT user
// data so ADMIN_PBKDF2_ITERATIONS can be tuned against the 10ms Free budget.

import type { Env, AdminData } from "../../_lib/env";
import { intVar } from "../../_lib/env";
import { ApiError, json, methodNotAllowed, readJson } from "../../_lib/http";
import { hashIp } from "../../_lib/crypto";
import { getAdminUser } from "../../_lib/db";
import { verifyPassword, hashPassword } from "../../../scripts/lib/password.mjs";
import { checkLoginRate, recordLoginFailure, recordLoginSuccess } from "../../_lib/rate-limit";
import { createSession, issueCsrfToken, pruneSessions, serializeSessionCookie as serializeFor } from "../../_lib/session";
import { audit } from "../../_lib/audit";

const MAX_BODY_BYTES = 4096;

/** PBKDF2 cost depends on params, not the password — a fixed input is enough
 *  to burn identical CPU for unknown usernames (module-scoped, built once). */
const DUMMY_PASSWORD = "phase2-dummy-password-timing-equalizer";
let dummyCache: { kdf: string; iterations: number; hash: string } | null = null;

async function dummyVerify(password: string, kdf: string, iterations: number): Promise<boolean> {
  if (!dummyCache || dummyCache.kdf !== kdf || dummyCache.iterations !== iterations) {
    dummyCache = { kdf, iterations, hash: await hashPassword(DUMMY_PASSWORD, { kdf, iterations }) };
  }
  return verifyPassword(password, dummyCache.hash);
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");

  const now = Math.floor(Date.now() / 1000);
  const body = (await readJson(request, MAX_BODY_BYTES)) as { username?: unknown; password?: unknown };
  if (typeof body?.username !== "string" || typeof body?.password !== "string") {
    throw new ApiError(400, "invalid_body", "username and password are required");
  }
  const username = body.username.trim().toLowerCase();
  const password = body.password;
  if (!username || username.length > 64 || password.length < 1 || password.length > 1024) {
    throw new ApiError(400, "invalid_body", "username and password are required");
  }

  const ipHash = await hashIp(request, env);
  const rate = await checkLoginRate(env, username, ipHash, now);
  if (!rate.ok) {
    await audit(env, { action: "login.blocked", detail: { username }, ipHash }, now);
    throw new ApiError(429, "rate_limited", `Too many attempts. Try again in ${rate.retryAfterSec}s.`, {
      "Retry-After": String(rate.retryAfterSec),
    });
  }

  const user = await getAdminUser(env, username);
  const active = user && user.disabled === 0 ? user : null;
  const kdf = env.ADMIN_PASSWORD_KDF === "scrypt" ? "scrypt" : "pbkdf2-sha256";
  const iterations = intVar(env, "ADMIN_PBKDF2_ITERATIONS", 100000, 1000, 10_000_000);

  const ok = active
    ? await verifyPassword(password, active.password_hash)
    : await dummyVerify(password, kdf, iterations);
  // NOTE: no duration here — performance.now() does not reflect WebCrypto
  // worker time in workerd (it measured 0ms against a real 100k-iteration
  // PBKDF2). The authoritative number is the tail event's cpuTime field.
  // No username/password in the log (log-injection + secret hygiene).
  console.log(`[auth] verify hit=${Boolean(active)} kdf=${kdf} iters=${iterations}`);

  if (!ok || !active) {
    await recordLoginFailure(env, {
      username,
      ipHash,
      now,
      userId: user?.id ?? null,
    });
    await audit(
      env,
      { userId: user?.id ?? null, action: "login.fail", detail: { username }, ipHash },
      now
    );
    // Re-check so the attempt that REACHES the cap returns 429 immediately —
    // identically for existing and unknown usernames.
    const after = await checkLoginRate(env, username, ipHash, now);
    if (!after.ok) {
      throw new ApiError(429, "rate_limited", `Too many attempts. Try again in ${after.retryAfterSec}s.`, {
        "Retry-After": String(after.retryAfterSec),
      });
    }
    throw new ApiError(401, "invalid_credentials", "Invalid username or password");
  }

  await recordLoginSuccess(env, { username, userId: active.id, ipHash, now });
  const created = await createSession(env, request, active.id, now);
  try {
    await pruneSessions(env, now);
  } catch (err) {
    console.error("[auth] prune failed:", err instanceof Error ? err.message : String(err));
  }
  await audit(env, { userId: active.id, action: "login.success", ipHash }, now);

  const csrfToken = await issueCsrfToken(
    { tokenHash: created.tokenHash, csrfSecret: created.csrfSecret },
    now
  );
  const response = json(
    { ok: true, username: active.username, csrfToken },
    200,
    { "Set-Cookie": serializeFor(request, created.token, created.maxAgeSec) }
  );
  return response;
};
