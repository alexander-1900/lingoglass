#!/usr/bin/env node
// Create (or rotate) the /admin account in D1 — Phase 1 bootstrap.
//
//   node scripts/admin-create.mjs --remote                # interactive, hidden prompt
//   node scripts/admin-create.mjs --remote --generate     # random password, printed ONCE
//   printf '…' | node scripts/admin-create.mjs --local --password-stdin
//   node scripts/admin-create.mjs --remote --update       # rotate an existing password
//   node scripts/admin-create.mjs --dry-run               # hash + self-checks, no DB write
//
// The password is NEVER accepted as an argv value or env var: both leak into
// shell history and `ps`. Sources: interactive hidden prompt (double-entry),
// --password-stdin (pipe), or --generate (crypto.randomBytes, shown once).
//
// KDF parameters come from wrangler.jsonc (ADMIN_PASSWORD_KDF /
// ADMIN_PBKDF2_ITERATIONS) so new hashes always match the runtime config;
// verification itself uses the parameters stored in each hash.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { d1File, d1Query, readDbName, readWranglerVar } from "./lib/d1.mjs";
import {
  hashPassword,
  verifyPassword,
  describeHash,
  MIN_PASSWORD_LENGTH,
  DEFAULT_KDF,
  DEFAULT_PBKDF2_ITERATIONS,
} from "./lib/password.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function fail(msg) {
  console.error("admin-create: " + msg);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "Usage: node scripts/admin-create.mjs (--remote | --local | --dry-run) [options]",
      "",
      "  --remote | --local   target database scope (required unless --dry-run)",
      "  --username <name>    default: admin (A-Za-z0-9_.-, max 64)",
      "  --generate           create a random password and print it exactly once",
      "  --password-stdin     read the password from stdin (trailing newline stripped)",
      "  --update             rotate the password of an existing user",
      "  --iterations <n>     override ADMIN_PBKDF2_ITERATIONS from wrangler.jsonc",
      "  --kdf <name>         override ADMIN_PASSWORD_KDF (pbkdf2-sha256 | scrypt)",
      "  --db <name>          override database_name from wrangler.jsonc",
      "  --dry-run            hash + self-checks only; nothing written, password not shown",
      "  --help               this text",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = {
    remote: false,
    local: false,
    dryRun: false,
    update: false,
    generate: false,
    passwordStdin: false,
    username: "admin",
    db: null,
    iterations: null,
    kdf: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const parts = eq > -1 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null];
    const flag = parts[0];
    const next = () => {
      if (parts[1] !== null) return parts[1];
      if (i + 1 >= argv.length) fail(flag + " needs a value");
      return argv[++i];
    };
    switch (flag) {
      case "--remote": out.remote = true; break;
      case "--local": out.local = true; break;
      case "--dry-run": out.dryRun = true; break;
      case "--update": out.update = true; break;
      case "--generate": out.generate = true; break;
      case "--password-stdin": out.passwordStdin = true; break;
      case "--username": out.username = next(); break;
      case "--db": out.db = next(); break;
      case "--iterations": out.iterations = Number(next()); break;
      case "--kdf": out.kdf = next(); break;
      case "--help": case "-h": out.help = true; break;
      default: fail("unknown flag: " + arg + " (see --help)");
    }
  }
  return out;
}

/** Hidden password prompt (standard muted-readline pattern; TTY only). */
function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const write = rl._writeToOutput.bind(rl);
    let muted = true;
    rl._writeToOutput = (str) => { if (!muted) write(str); };
    rl.question(query, (answer) => {
      muted = false;
      write("\n");
      rl.close();
      resolve(answer);
    });
    muted = false;
    write(query);
    muted = true;
  });
}

async function acquirePassword(opts) {
  if (opts.generate && opts.passwordStdin) {
    fail("--generate and --password-stdin are mutually exclusive");
  }
  if (opts.generate) {
    return { password: crypto.randomBytes(24).toString("base64url"), generated: true };
  }
  if (opts.passwordStdin) {
    if (process.stdin.isTTY) fail("--password-stdin requires piped input");
    return { password: fs.readFileSync(0, "utf-8").replace(/\r?\n$/, ""), generated: false };
  }
  if (!process.stdin.isTTY) {
    fail("no TTY for the hidden prompt — use --generate or --password-stdin (passwords are never argv)");
  }
  const a = await promptHidden("New admin password: ");
  const b = await promptHidden("Repeat password:     ");
  if (a !== b) fail("passwords do not match");
  return { password: a, generated: false };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();
  if (opts.dryRun && (opts.remote || opts.local)) fail("--dry-run takes no scope flag");
  if (!opts.dryRun && opts.remote === opts.local) {
    fail("exactly one of --remote or --local is required");
  }
  if (!USERNAME_RE.test(opts.username)) {
    fail(`username must match ${USERNAME_RE} (got "${opts.username}")`);
  }

  const scope = opts.remote ? "--remote" : "--local";
  const db = opts.dryRun ? "dry-run" : readDbName(root, opts.db);
  if (!db) fail("wrangler.jsonc: d1_databases[0].database_name not found — pass --db <name>");
  const kdf = opts.kdf ?? readWranglerVar(root, "ADMIN_PASSWORD_KDF", DEFAULT_KDF);
  const iterations =
    opts.iterations ?? Number(readWranglerVar(root, "ADMIN_PBKDF2_ITERATIONS", DEFAULT_PBKDF2_ITERATIONS));
  if (!Number.isInteger(iterations) || iterations < 1) fail("invalid iterations: " + iterations);

  const { password, generated } = await acquirePassword(opts);
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail("password too short — minimum " + MIN_PASSWORD_LENGTH + " characters");
  }

  // ---- hash + self-checks (always, before any DB write) --------------------
  let hash;
  try {
    hash = await hashPassword(password, { kdf, iterations });
  } catch (err) {
    return fail(String(err.message || err));
  }
  const info = describeHash(hash);
  const roundTrip = await verifyPassword(password, hash);
  const wrongCandidate = password.slice(0, -1) + (password.endsWith("A") ? "B" : "A");
  const rejectsWrong = !(await verifyPassword(wrongCandidate, hash));
  const plaintextAbsent = !hash.includes(password);
  if (!(roundTrip && rejectsWrong && plaintextAbsent)) {
    fail(
      `self-check failed (round-trip: ${roundTrip}, rejects-wrong: ${rejectsWrong}, ` +
      `plaintext-absent: ${plaintextAbsent}) — refusing to write`
    );
  }
  const describe =
    info.kdf === "scrypt"
      ? `scrypt N=${info.N} r=${info.r} p=${info.p}`
      : `${info.kdf} iterations=${info.iterations}`;

  if (opts.dryRun) {
    console.log(
      [
        "admin-create: DRY RUN — no database write, password not shown.",
        `  would store: ${describe} (${hash.length} chars, ${info.saltBytes}-byte salt, ${info.keyBytes}-byte key)`,
        "  self-checks:  round-trip OK · wrong-password rejected OK · plaintext absent OK",
      ].join("\n")
    );
    return;
  }

  // ---- write to D1 --------------------------------------------------------
  // Values are locally generated (hash: base64url + digits + '$') or validated
  // against USERNAME_RE above, so no quoting/escaping hazard; wrangler has no
  // bind parameters, hence a temporary --file instead of a shell-interpolated
  // string. The file holds only the HASH — never the plaintext password.
  const now = Math.floor(Date.now() / 1000);
  const sql = opts.update
    ? "UPDATE admin_users SET password_hash = '" + hash +
      "', password_changed_at = " + now +
      ", failed_attempts = 0, locked_until = NULL, disabled = 0, updated_at = " + now +
      " WHERE username = '" + opts.username + "';"
    : "INSERT INTO admin_users (username, password_hash, password_changed_at, created_at, updated_at) " +
      "VALUES ('" + opts.username + "', '" + hash + "', " + now + ", " + now + ", " + now + ");";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lingoglasse-admin-"));
  const tmpFile = path.join(tmpDir, "stmt.sql");
  let created = false;
  try {
    fs.writeFileSync(tmpFile, sql, { encoding: "utf-8", mode: 0o600 });
    const stdout = d1File(db, scope, tmpFile);
    if (stdout === null) {
      if (opts.update) fail("UPDATE failed — does the user exist? (drop --update to create)");
      fail("INSERT failed — does the user already exist? (use --update to rotate the password)");
    }
    created = !opts.update;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ---- read back and verify what actually landed --------------------------
  const rows = d1Query(
    db,
    scope,
    "SELECT username, password_hash, failed_attempts, locked_until, disabled " +
      "FROM admin_users WHERE username = '" + opts.username + "';"
  );
  if (rows === null || rows.length === 0) fail("read-back found no row — insert did not persist");
  const row = rows[0];
  const storedOk = await verifyPassword(password, row.password_hash);
  const storedAbsent = !row.password_hash.includes(password);
  if (!storedOk || !storedAbsent) {
    fail(`read-back verification failed (verify: ${storedOk}, plaintext-absent: ${storedAbsent})`);
  }

  const label = opts.remote ? "remote" : "local";
  console.log(
    [
      `admin-create: ${created ? "created" : "rotated"} user '${row.username}' → ${db} (${label})`,
      `  hash:       ${hash.length} chars — ${describe}`,
      "  read-back:  verify OK · wrong-password rejected OK · plaintext absent OK",
      `  state:      failed_attempts=${row.failed_attempts} locked_until=${row.locked_until} disabled=${row.disabled}`,
    ].join("\n")
  );
  if (generated) {
    console.log(
      [
        "",
        "  ⚠ ONE-TIME PASSWORD (random, shown only here — store it in your",
        "    password manager now, then keep this transcript out of reach):",
        `    ${password}`,
        "",
        "  Rotate any time: node scripts/admin-create.mjs --remote --update",
      ].join("\n")
    );
  }
}

try {
  await main();
} catch (err) {
  fail(String((err && err.message) || err));
}
