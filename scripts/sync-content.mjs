#!/usr/bin/env node
// Publish export: D1 → content/**.md, R2 covers → public/images/covers/**.
// The inverse of scripts/import-content.mjs; both share the pure logic in
// scripts/lib/content-sync.mjs (the render→parse round-trip guarantee).
//
//   node scripts/sync-content.mjs --remote              # operator: wrangler CLI
//   node scripts/sync-content.mjs --remote --dry-run    # report without writing
//   node scripts/sync-content.mjs --build               # Pages Git build (REST)
//
// What "published" means here (migrations/0002 contract):
//   - status='published' AND deleted_at IS NULL  → written/updated in content/
//   - status='draft' or soft-deleted             → its content file is REMOVED
//     (the story disappears from the static site on the next build)
//   - content/ file with NO row in D1            → left alone by default (repo
//     seed), reported; --build prunes it because the build must mirror D1.
//
// Safety rails:
//  - An EMPTY published set never deletes anything: D1 with zero published
//    stories is far more likely a wrong-scope/token mistake than a real wipe.
//  - The story parser validates every row through the same render→parse round
//    trip as the admin API; a row that fails aborts before any file changes
//    (the admin API should make that impossible — this is the last line).
//  - Extras (frontmatter keys D1 doesn't own, e.g. `image:`) ride along from
//    the existing file, EXCEPT `image:` which the R2 cover overrides so an
//    admin-uploaded cover actually reaches the static site.
//
// --build needs CLOUDFLARE_API_TOKEN (read-only D1 + R2 scopes) and
// CLOUDFLARE_ACCOUNT_ID in the environment; without them it SKIPS cleanly so
// local/CI builds keep using the committed content files.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CANONICAL_FM_KEYS, renderContentFile } from "./lib/content-sync.mjs";
import { isSafeSegment, normalizeText, splitFrontmatter } from "./lib/story-format.mjs";
import {
  d1Query,
  d1QueryRest,
  readBucketName,
  readDatabaseId,
  readDbName,
  r2Get,
  r2GetRest,
  restAvailable,
} from "./lib/d1.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(root, "content");
const COVERS_DIR = path.join(root, "public", "images", "covers");

const EXT_BY_TYPE = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

function fail(msg) {
  console.error("sync-content: " + msg);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "Usage: node scripts/sync-content.mjs (--remote | --local | --build) [options]",
      "",
      "  --remote | --local   pull via wrangler CLI (operator machines)",
      "  --build              pull via REST (Pages Git build); skips when the",
      "                       CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID env",
      "                       vars are absent, prunes repo-only files, syncs covers",
      "  --dry-run            report what would change; write nothing",
      "  --db <name>          override database_name from wrangler.jsonc",
      "  --help               this text",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = { remote: false, local: false, build: false, dryRun: false, db: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const parts = eq > -1 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null];
    const next = () => {
      if (parts[1] !== null) return parts[1];
      if (i + 1 >= argv.length) fail(parts[0] + " needs a value");
      return argv[++i];
    };
    switch (parts[0]) {
      case "--remote": out.remote = true; break;
      case "--local": out.local = true; break;
      case "--build": out.build = true; break;
      case "--dry-run": out.dryRun = true; break;
      case "--db": out.db = next(); break;
      case "--help": case "-h": out.help = true; break;
      default: fail("unknown option " + parts[0]);
    }
  }
  return out;
}

/** Walk every story file → { "lang/level/slug": absolute path }. */
function existingFiles(out = new Map(), dir = CONTENT) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) existingFiles(out, p);
    else if (e.name.endsWith(".md")) {
      const rel = path.relative(CONTENT, p).split(path.sep);
      if (rel.length === 3) out.set(`${rel[0]}/${rel[1]}/${rel[2].replace(/\.md$/, "")}`, p);
    }
  }
  return out;
}

/** Non-canonical frontmatter keys of an existing file (D1 doesn't own them). */
function extrasOf(file) {
  try {
    const { has, meta } = splitFrontmatter(normalizeText(fs.readFileSync(file, "utf-8")));
    if (!has) return {};
    const extras = {};
    for (const key of Object.keys(meta)) {
      if (!CANONICAL_FM_KEYS.includes(key)) extras[key] = meta[key];
    }
    return extras;
  } catch {
    return {};
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** public/images/covers/<lang>/<level>/<slug>.<ext> + its site-root URL. */
function coverTarget(story, contentType) {
  const ext = EXT_BY_TYPE[contentType] ?? ".jpg";
  const rel = `covers/${story.lang}/${story.level}/${story.slug}${ext}`;
  return { file: path.join(root, "public", "images", rel), url: `/images/${rel}` };
}

// ---- D1 pulls ----------------------------------------------------------------
// Rows are assembled into the exact struct parseContentFile produces, so
// renderContentFile writes files the build loader parses identically.

const STORY_SQL =
  "SELECT lang, level, slug, title, title_en, minutes FROM stories " +
  "WHERE status = 'published' AND deleted_at IS NULL ORDER BY lang, level, slug;";

const SENTENCE_SQL =
  "SELECT s.lang AS lang, s.level AS level, s.slug AS slug, se.position AS position, " +
  "se.target AS target, se.en AS en FROM sentences se " +
  "JOIN stories s ON s.id = se.story_id " +
  "WHERE s.status = 'published' AND s.deleted_at IS NULL ORDER BY s.id, se.position;";

const WORD_SQL =
  "SELECT s.lang AS lang, s.level AS level, s.slug AS slug, se.position AS sentence_pos, " +
  "w.position AS position, w.surface AS surface, w.note AS note FROM words w " +
  "JOIN sentences se ON se.id = w.sentence_id JOIN stories s ON s.id = se.story_id " +
  "WHERE s.status = 'published' AND s.deleted_at IS NULL ORDER BY s.id, se.position, w.position;";

const COVER_SQL =
  "SELECT s.lang AS lang, s.level AS level, s.slug AS slug, i.r2_key AS r2_key, " +
  "i.content_type AS content_type, i.sha256 AS sha256 FROM story_images i " +
  "JOIN stories s ON s.id = i.story_id " +
  "WHERE i.is_cover = 1 AND s.status = 'published' AND s.deleted_at IS NULL;";

/** Pulls → Map<"lang/level/slug", story struct>. Story rows seed the map (with
 *  an empty sentences array); sentence/word rows attach in position order. */
function assemble(stories, sentences, words) {
  const byKey = new Map();
  for (const row of stories) {
    if (![row.lang, row.level, row.slug].every(isSafeSegment)) continue;
    byKey.set(`${row.lang}/${row.level}/${row.slug}`, {
      lang: row.lang,
      level: row.level,
      slug: row.slug,
      title: row.title,
      titleEn: row.title_en,
      minutes: row.minutes,
      sentences: [],
    });
  }
  for (const row of sentences) {
    const story = byKey.get(`${row.lang}/${row.level}/${row.slug}`);
    if (!story) continue; // sentence rows only reference pulled stories
    story.sentences.push({ target: row.target, en: row.en, words: [] });
  }
  for (const row of words) {
    const story = byKey.get(`${row.lang}/${row.level}/${row.slug}`);
    const sentence = story?.sentences[row.sentence_pos];
    if (!sentence) continue;
    sentence.words.push({ surface: row.surface, note: row.note });
  }
  return byKey;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void usage();
  if (args.build && (args.remote || args.local)) fail("--build is its own scope; drop --remote/--local");
  if (!args.build && args.remote === args.local) fail("pick exactly one of --remote / --local / --build");
  const db = readDbName(root, args.db);
  if (!db) fail("database_name not found in wrangler.jsonc (or pass --db)");

  // --build without credentials is a CLEAN skip: local `npm run build` and CI
  // keep using the committed content files (see .env.example).
  if (args.build && !restAvailable()) {
    console.log("sync-content: CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID unset — using committed content/ (build-mode skip).");
    return;
  }

  const scope = args.remote ? "--remote" : "--local";
  const pull = async (sql) =>
    args.build ? d1QueryRest(await readDatabaseId(root), sql) : d1Query(db, scope, sql);

  // 1) Pull everything up front; a failed pull must never be mistaken for
  //    "D1 says delete it all".
  const [storyRows, sentenceRows, wordRows, coverRows] = await Promise.all([
    pull("SELECT lang, level, slug, title, title_en, minutes, status, deleted_at FROM stories ORDER BY lang, level, slug;"),
    pull(SENTENCE_SQL),
    pull(WORD_SQL),
    pull(COVER_SQL),
  ]);
  if ([storyRows, sentenceRows, wordRows, coverRows].some((r) => r === null)) {
    fail("could not pull from D1 — nothing written");
  }
  const published = assemble(
    storyRows.filter((s) => s.status === "published" && s.deleted_at === null),
    sentenceRows,
    wordRows
  );
  // Hard rail: an empty published set is a scope/token mistake, not a wipe.
  if (published.size === 0 && storyRows.length > 0) {
    fail(`D1 has ${storyRows.length} stories but 0 published — refusing to touch content/`);
  }
  console.log(`sync-content: ${published.size} published stories in D1 (${storyRows.length} rows total).`);

  // 2) Write/refresh published stories; unsafe path segments abort the run.
  const files = existingFiles();
  let written = 0;
  let unchanged = 0;
  for (const [key, story] of published) {
    const file = path.join(CONTENT, ...key.split("/")) + ".md";
    // Extras ride along from the existing file; an R2 cover overrides `image:`
    // so admin-uploaded covers reach the static site.
    const extras = files.has(key) ? extrasOf(files.get(key)) : {};
    const cover = coverRows.find((c) => `${c.lang}/${c.level}/${c.slug}` === key);
    if (cover) extras.image = coverTarget(story, cover.content_type).url;
    const bytes = renderContentFile(story, extras);
    const existingBytes = files.has(key) ? fs.readFileSync(files.get(key), "utf-8") : null;
    if (existingBytes === bytes) {
      unchanged++;
      continue;
    }
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, "utf-8");
    }
    written++;
  }

  // 3) Prune: content files whose D1 row is draft/soft-deleted go away (the
  //    story leaves the site on the next build); repo-only files (no row at
  //    all) are kept in operator mode, pruned in --build (D1 is authoritative).
  const hidden = new Set(
    storyRows.filter((s) => s.status !== "published" || s.deleted_at !== null).map((s) => `${s.lang}/${s.level}/${s.slug}`)
  );
  let pruned = 0;
  for (const [key, file] of files) {
    if (published.has(key)) continue;
    if (!hidden.has(key) && !args.build) {
      if (!storyRows.some((s) => `${s.lang}/${s.level}/${s.slug}` === key)) {
        console.warn(`sync-content: warn: ${key}: file has no D1 row — left alone (repo seed?); --build prunes it`);
      }
      continue;
    }
    if (!args.dryRun) fs.rmSync(file, { force: true });
    pruned++;
  }

  // 4) Covers: R2 → public/images/covers/<lang>/<level>/<slug>.<ext>. Skipped
  //    when the local file already matches the object's sha256 (idempotent).
  let covers = 0;
  let coverSkip = 0;
  if (coverRows.length) {
    const bucket = readBucketName(root);
    if (!bucket) fail("bucket_name not found in wrangler.jsonc (covers present in D1)");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-cover-"));
    try {
      for (const row of coverRows) {
        if (![row.lang, row.level, row.slug].every(isSafeSegment)) {
          console.warn(`sync-content: warn: unsafe cover row skipped: ${row.lang}/${row.level}/${row.slug}`);
          coverSkip++;
          continue;
        }
        const story = published.get(`${row.lang}/${row.level}/${row.slug}`);
        if (!story) {
          coverSkip++;
          continue;
        }
        const target = coverTarget(story, row.content_type);
        if (fs.existsSync(target.file) && sha256File(target.file) === row.sha256) {
          coverSkip++; // already in place
          continue;
        }
        if (args.dryRun) {
          covers++;
          continue;
        }
        const tmp = path.join(tmpDir, "object");
        const got = args.build ? await r2GetRest(bucket, row.r2_key, tmp) : r2Get(bucket, row.r2_key, tmp, scope);
        if (!got) {
          console.warn(`sync-content: warn: could not fetch ${row.r2_key} from R2 — keeping previous cover file`);
          coverSkip++;
          continue;
        }
        if (crypto.createHash("sha256").update(fs.readFileSync(tmp)).digest("hex") !== row.sha256) {
          console.warn(`sync-content: warn: ${row.r2_key}: sha256 mismatch after download — discarded`);
          coverSkip++;
          continue;
        }
        fs.mkdirSync(path.dirname(target.file), { recursive: true });
        fs.copyFileSync(tmp, target.file);
        covers++;
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log(
    `sync-content: ${written} written, ${unchanged} unchanged, ${pruned} pruned, ` +
      `${covers} covers synced, ${coverSkip} covers in place/skipped` +
      (args.dryRun ? " (dry run — nothing written)" : "") + "."
  );
}

main().catch((err) => {
  console.error("sync-content:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
