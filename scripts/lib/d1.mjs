// Shared wrangler/D1 CLI plumbing for the operator scripts (admin:create,
// import-content, sync-content, publish). ONE implementation: wrangler has no
// bind parameters, so statements go through either a validated shell string
// (d1Query — caller-controlled SQL only) or a temp --file (d1File — anything
// derived from story content, which may contain quotes).
//
// Errors: runWrangler prints the captured output and returns null; parseJsonish
// throws so callers can fail with their own message.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Quote an argument for the platform shell (paths/db names never contain `"`). */
export function shellQuote(value) {
  return `"${String(value).replace(/"/g, "")}"`;
}

export function runWrangler(args) {
  const command = ["wrangler", ...args.map(shellQuote)].join(" ");
  try {
    // 64 MiB: content sync pulls ~8k word rows as one --json payload, which
    // overflows execSync's 1 MiB default maxBuffer.
    return execSync(command, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    console.error(detail || String(err.message));
    return null;
  }
}

/** wrangler --json may be preceded by banner lines — locate and parse the array. */
export function parseJsonish(stdout) {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("could not parse wrangler output:\n" + trimmed);
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error("could not parse wrangler output:\n" + trimmed);
  }
}

export function resultsOf(payload) {
  if (Array.isArray(payload)) return payload[0]?.results ?? [];
  return payload?.results ?? [];
}

/** database_name from wrangler.jsonc (JSONC — regex, not JSON.parse); null when absent. */
export function readDbName(root, override) {
  if (override) return override;
  try {
    const raw = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf-8");
    const m = raw.match(/"database_name"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null;
}

/** Read a string var out of wrangler.jsonc (JSONC — regex, not JSON.parse). */
export function readWranglerVar(root, name, fallback) {
  try {
    const raw = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf-8");
    const m = raw.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : fallback;
  } catch {
    return fallback;
  }
}

/** Execute a .sql file (multi-statement) — for content-derived data with quotes. */
export function d1File(db, scope, file) {
  return runWrangler(["d1", "execute", db, "--yes", scope, "--file", file]);
}

/** Single query with caller-controlled SQL (no story content); null on failure. */
export function d1Query(db, scope, sql) {
  const stdout = runWrangler(["d1", "execute", db, "--yes", "--json", scope, "--command", sql]);
  if (stdout === null) return null;
  return resultsOf(parseJsonish(stdout));
}

/** Full --json payload (array of per-statement result objects); null on failure. */
export function d1Execute(db, scope, args) {
  const stdout = runWrangler(["d1", "execute", db, "--yes", "--json", scope, ...args]);
  if (stdout === null) return null;
  try {
    return parseJsonish(stdout);
  } catch (err) {
    console.error(String(err.message));
    return null;
  }
}

/** Execute SQL from a temp file (multi-statement, content-safe quoting).
 *  Returns stdout (null on failure); the temp file is always cleaned up. */
export function d1RunFile(db, scope, sql) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lingoglasse-d1-"));
  const tmpFile = path.join(tmpDir, "stmt.sql");
  try {
    fs.writeFileSync(tmpFile, sql, { encoding: "utf-8", mode: 0o600 });
    return d1File(db, scope, tmpFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** SQL single-quoted string literal for story-derived values (which may
 *  contain quotes) written into a --file payload. NUL bytes can never occur
 *  (the format is line-based) and would truncate SQLite strings anyway. */
export function sqlQuote(value) {
  const s = String(value);
  if (s.includes("\0")) throw new Error("sqlQuote: NUL byte in value");
  return "'" + s.replace(/'/g, "''") + "'";
}

/** bucket_name from wrangler.jsonc (JSONC — regex, not JSON.parse). */
export function readBucketName(root) {
  try {
    const raw = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf-8");
    const m = raw.match(/"bucket_name"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null;
}

/** database_id (UUID) from wrangler.jsonc — the D1 REST API wants it, not the
 *  database_name. */
export function readDatabaseId(root) {
  try {
    const raw = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf-8");
    const m = raw.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null;
}

// ---- REST fallback (build machines without wrangler) -------------------------
// The Pages Git build (cutover) has CLOUDFLARE_API_TOKEN but no wrangler CLI,
// so read-side pulls (sync-content) speak the Cloudflare REST API directly.
// Writes keep using wrangler: operator machines have it, and import/publish.mjs
// need the full CLI anyway.

function restEnv() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  return token && account ? { token, account } : null;
}

/** True when the REST API can be used (token + account id in env). */
export function restAvailable() {
  return restEnv() !== null;
}

/** One SELECT via the D1 REST API (bound params, caller-controlled SQL — same
 *  contract as d1Query). Returns [] on failure so a partial pull is visible in
 *  the caller's counts; null NEVER propagates differently from "no rows". */
export async function d1QueryRest(databaseId, sql, params = []) {
  const envCfg = restEnv();
  if (!envCfg || !databaseId) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${envCfg.account}/d1/databases/${databaseId}/query`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${envCfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) {
      console.error(`d1QueryRest: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    if (!data?.success) {
      console.error("d1QueryRest: API error:", JSON.stringify(data?.errors ?? data).slice(0, 300));
      return null;
    }
    return data.result?.[0]?.results ?? [];
  } catch (err) {
    console.error("d1QueryRest:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Download one R2 object via REST to a local file (covers sync on build
 *  machines). Returns false when the object is missing or the request fails. */
export async function r2GetRest(bucket, key, file) {
  const envCfg = restEnv();
  if (!envCfg) return false;
  const objectPath = key.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.cloudflare.com/client/v4/accounts/${envCfg.account}/r2/buckets/${bucket}/objects/${objectPath}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${envCfg.token}` } });
    if (!res.ok) return false;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    console.error("r2GetRest:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Upload a local file to R2 (import: repo covers → bucket). Null on failure.
 *  NOTE: wrangler wants `{bucket}/{key}` (a SLASH), not the older `{bucket}:{key}`
 *  spelling — with a colon it splits there and reports the whole string as an
 *  invalid bucket name ("lingoglasse-media:covers/…"). Keys are always relative
 *  here (no leading slash), so a plain join is safe. */
export function r2Put(bucket, key, file, scope) {
  return runWrangler(["r2", "object", "put", `${bucket}/${key}`, "--file", file, scope]);
}

/** Download an R2 object to a local file (sync: bucket covers → public/images).
 *  Returns false when the object does not exist (wrangler exits non-zero).
 *  Same `{bucket}/{key}` spelling as r2Put — see the note there. */
export function r2Get(bucket, key, file, scope) {
  return runWrangler(["r2", "object", "get", `${bucket}/${key}`, "--file", file, scope]) !== null;
}
