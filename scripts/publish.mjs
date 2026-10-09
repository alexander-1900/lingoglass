#!/usr/bin/env node
// Manual publish (mode='manual' in publish_requests): export D1 → content/**,
// journal the attempt, and trigger a rebuild when a deploy hook is configured.
// The /admin "Publish site" button is the same pipeline from the UI; this
// script exists for machines without panel access and for hookless setups.
//
//   npm run publish                # sync + journal + hook (if URL in env)
//   npm run publish -- --no-sync   # journal + hook only
//   npm run publish -- --local     # sync the local D1 database (dev)
//
// DEPLOY_HOOK_URL is a SECRET: read it from the environment (shell or .env
// loader), never from a committed file. Without it, publishing degrades to
// "commit and push" — on the Git-connected Pages project a push to main
// rebuilds the site, and the build's own sync-content --build step pulls D1.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { d1Query, d1RunFile, readDbName, sqlQuote } from "./lib/d1.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noSync = args.includes("--no-sync");
const local = args.includes("--local");
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Usage: node scripts/publish.mjs [--no-sync] [--local]",
      "",
      "  --no-sync  skip the D1 → content/ export (journal + hook only)",
      "  --local    target the local D1 database (default: --remote)",
    ].join("\n")
  );
  process.exit(0);
}

function fail(msg) {
  console.error("publish: " + msg);
  process.exit(1);
}

// 1) Export D1 → content/ (and R2 covers → public/images/covers) so the repo
//    seed stays usable without the build-time REST pull.
if (!noSync) {
  const syncArgs = ["scripts/sync-content.mjs", local ? "--local" : "--remote"];
  console.log(`publish: syncing content (${syncArgs.join(" ")})…`);
  const res = spawnSync(process.execPath, syncArgs, { cwd: root, stdio: "inherit" });
  if (res.status !== 0) fail("sync-content failed — nothing was journaled or dispatched");
}

// 2) Journal the attempt (mode='manual').
const db = readDbName(root, null);
if (!db) fail("database_name not found in wrangler.jsonc");
const scope = local ? "--local" : "--remote";
const now = Math.floor(Date.now() / 1000);
const detail = `node scripts/publish.mjs${local ? " --local" : ""}`;
// Two statements on purpose: d1Query returns the FIRST result set, so an
// INSERT…;SELECT id combo would hand back the INSERT's (empty) results.
if (
  d1Query(
    db,
    scope,
    "INSERT INTO publish_requests (user_id, requested_at, mode, status, detail) " +
      `VALUES (NULL, ${now}, 'manual', 'requested', ${sqlQuote(detail)});`
  ) === null
) {
  fail("could not journal the publish request in D1");
}
const inserted = d1Query(db, scope, "SELECT id FROM publish_requests ORDER BY id DESC LIMIT 1;");
if (inserted === null || !inserted[0]?.id) fail("could not read back the publish request id");
const requestId = Number(inserted[0].id);

// 3) Trigger the rebuild when the hook secret is exported in this shell.
const hook = process.env.DEPLOY_HOOK_URL;
if (!hook) {
  console.log(
    "publish: DEPLOY_HOOK_URL not set — commit and push these changes to deploy " +
      "(the Git-connected Pages project rebuilds on push; its build syncs D1 itself)."
  );
  process.exit(0);
}

let status = "failed";
let hookDetail = "";
try {
  const res = await fetch(hook, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000) });
  hookDetail = `HTTP ${res.status}`;
  if (res.ok) status = "dispatched";
} catch (err) {
  hookDetail = err instanceof Error ? err.message : String(err);
}
d1RunFile(
  db,
  scope,
  `UPDATE publish_requests SET status = ${sqlQuote(status)}, detail = ${sqlQuote(hookDetail)} WHERE id = ${requestId};`
);
if (status !== "dispatched") fail(`deploy hook failed (${hookDetail})`);
console.log(`publish: deploy hook dispatched (${hookDetail}); the build takes a minute or two.`);
