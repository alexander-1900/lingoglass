#!/usr/bin/env node
// One-time import: content/**.md → D1 (stories/sentences/words) and repo cover
// photos → R2 + story_images (Phase 6 bootstrap). After this runs, D1 is the
// source of truth and scripts/sync-content.mjs exports back into content/.
//
//   node scripts/import-content.mjs --remote              # import everything new
//   node scripts/import-content.mjs --remote --covers     # + upload cover photos
//   node scripts/import-content.mjs --remote --update     # also replace existing
//   node scripts/import-content.mjs --remote --limit 5    # smoke run
//   node scripts/import-content.mjs --remote --dry-run    # parse + report only
//
// Safety rails:
//  - Every story is parsed through scripts/lib/content-sync.mjs, which enforces
//    the same render→parse round trip the admin API gates payloads on. A file
//    that would not survive it is an ERROR, never a partial import.
//  - Values are embedded via sqlQuote() into a --file payload (wrangler has no
//    bind parameters); slugs/langs/levels must be safe path segments before any
//    SQL is built from them.
//  - Existing (lang, level, slug) rows are SKIPPED unless --update, so the
//    command is re-runnable and can never clobber admin edits by accident.
//  - Stories import as status='published', source='import' — the repo content
//    is the live site, so nothing disappears from the reader on cutover.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseContentFile } from "./lib/content-sync.mjs";
import { isSafeSegment } from "./lib/story-format.mjs";
import {
  d1Query,
  d1RunFile,
  readBucketName,
  readDbName,
  r2Put,
  sqlQuote,
} from "./lib/d1.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(root, "content");

/** Stories per d1 --file batch: one wrangler call per batch, not per story. */
const BATCH_SIZE = 20;

/** frontmatter image: extension → R2 content type + canonical key extension
 *  (mirrors EXT_BY_TYPE in functions/_lib/images.ts). */
const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function fail(msg) {
  console.error("import-content: " + msg);
  process.exit(1);
}

function usage() {
  console.log(
    [
      "Usage: node scripts/import-content.mjs (--remote | --local) [options]",
      "",
      "  --remote | --local   database scope (required)",
      "  --update             replace content of stories that already exist",
      "  --covers             upload frontmatter-referenced cover photos to R2",
      "  --limit <n>          import at most n stories (smoke testing)",
      "  --dry-run            parse + report only; no D1/R2 writes",
      "  --db <name>          override database_name from wrangler.jsonc",
      "  --help               this text",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const out = {
    remote: false,
    local: false,
    update: false,
    covers: false,
    dryRun: false,
    limit: 0,
    db: null,
    help: false,
  };
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
      case "--update": out.update = true; break;
      case "--covers": out.covers = true; break;
      case "--dry-run": out.dryRun = true; break;
      case "--limit": out.limit = Number(next()); break;
      case "--db": out.db = next(); break;
      case "--help": case "-h": out.help = true; break;
      default: fail("unknown option " + parts[0]);
    }
  }
  return out;
}

function walkMarkdown(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** content/<lang>/<level>/<slug>.md → the triple, validated as safe segments
 *  (they become SQL literals AND, for covers, R2 key path components). */
function storyLocation(file) {
  const rel = path.relative(CONTENT, file).split(path.sep);
  if (rel.length !== 3) return null;
  const [lang, level, name] = rel;
  const slug = name.replace(/\.md$/, "");
  if (![lang, level, slug].every(isSafeSegment)) return null;
  return { lang, level, slug };
}

/** SQL for one story. New rows take a plain INSERT; rows that already exist
 *  (only reached with --update) upsert metadata and replace all sentences —
 *  words go away with them via ON DELETE CASCADE. Child rows bind to the story
 *  through the UNIQUE (lang, level, slug) key, so no id round trip is needed
 *  inside the file. */
function storySql(story, mtimeSec, isUpdate) {
  const lang = sqlQuote(story.lang);
  const level = sqlQuote(story.level);
  const slug = sqlQuote(story.slug);
  const storyKey = `lang = ${lang} AND level = ${level} AND slug = ${slug}`;
  const columns =
    "lang, level, slug, title, title_en, minutes, status, source, created_at, updated_at, published_at";
  const values =
    `(${lang}, ${level}, ${slug}, ${sqlQuote(story.title)}, ${sqlQuote(story.titleEn)}, ` +
    `${story.minutes}, 'published', 'import', ${mtimeSec}, ${mtimeSec}, ${mtimeSec})`;

  const stmts = [];
  if (isUpdate) {
    stmts.push(
      `INSERT INTO stories (${columns}) VALUES ${values} ` +
        "ON CONFLICT (lang, level, slug) DO UPDATE SET " +
        "title = excluded.title, title_en = excluded.title_en, minutes = excluded.minutes, " +
        "status = 'published', deleted_at = NULL, updated_at = excluded.updated_at, " +
        "published_at = COALESCE(stories.published_at, excluded.published_at);"
    );
    stmts.push(`DELETE FROM sentences WHERE story_id = (SELECT id FROM stories WHERE ${storyKey});`);
  } else {
    stmts.push(`INSERT INTO stories (${columns}) VALUES ${values};`);
  }

  story.sentences.forEach((s, pos) => {
    stmts.push(
      `INSERT INTO sentences (story_id, position, target, en) ` +
        `SELECT id, ${pos}, ${sqlQuote(s.target)}, ${sqlQuote(s.en)} FROM stories WHERE ${storyKey};`
    );
    s.words.forEach((w, wPos) => {
      stmts.push(
        `INSERT INTO words (sentence_id, position, surface, note) ` +
          `SELECT se.id, ${wPos}, ${sqlQuote(w.surface)}, ${sqlQuote(w.note)} ` +
          `FROM sentences se JOIN stories st ON st.id = se.story_id ` +
          `WHERE st.lang = ${lang} AND st.level = ${level} AND st.slug = ${slug} ` +
          `AND se.position = ${pos};`
      );
    });
  });
  return stmts.join("\n");
}

/** story_images row for a repo cover photo, tied to its story via subquery and
 *  skipped when the story already has a cover (covers are one-per-story). */
function coverSql(story, key, contentType, size, sha, now) {
  const lang = sqlQuote(story.lang);
  const level = sqlQuote(story.level);
  const slug = sqlQuote(story.slug);
  return (
    "INSERT INTO story_images (story_id, r2_key, content_type, byte_size, sha256, width, height, is_cover, uploaded_at) " +
    `SELECT st.id, ${sqlQuote(key)}, ${sqlQuote(contentType)}, ${size}, ${sqlQuote(sha)}, NULL, NULL, 1, ${now} ` +
    `FROM stories st WHERE st.lang = ${lang} AND st.level = ${level} AND st.slug = ${slug} ` +
    "AND NOT EXISTS (" +
    "SELECT 1 FROM story_images si WHERE si.story_id = st.id AND si.is_cover = 1);"
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void usage();
  if (args.remote === args.local) fail("pick exactly one of --remote / --local");
  if (args.limit !== 0 && (!Number.isInteger(args.limit) || args.limit < 1)) {
    fail("--limit must be a positive integer");
  }
  const scope = args.remote ? "--remote" : "--local";
  const db = readDbName(root, args.db);
  if (!db) fail("database_name not found in wrangler.jsonc (or pass --db)");

  // 1) Parse everything up front: one bad file aborts before ANY write.
  const files = walkMarkdown(CONTENT).sort();
  const stories = [];
  for (const file of files) {
    const where = storyLocation(file);
    if (!where) {
      fail(`${path.relative(root, file)}: must live at content/<lang>/<level>/<slug>.md with safe segment names`);
    }
    const mtimeSec = Math.floor(fs.statSync(file).mtimeMs / 1000);
    try {
      stories.push({ ...parseContentFile(fs.readFileSync(file, "utf-8"), where), file, mtimeSec });
    } catch (err) {
      fail(`${path.relative(root, file)}: ${err.message}`);
    }
  }
  if (args.limit) stories.length = Math.min(stories.length, args.limit);
  console.log(`import-content: parsed ${stories.length} stories from content/.`);

  // 2) Which keys already exist in D1? (--update decides skip vs replace.)
  const existing = new Set();
  if (!args.dryRun) {
    const rows = d1Query(db, scope, "SELECT lang, level, slug FROM stories;");
    if (rows === null) fail("could not read existing stories from D1 — nothing imported");
    for (const r of rows) existing.add(`${r.lang}/${r.level}/${r.slug}`);
  }

  // 3) Write stories in batches; each story is INSERT (new) or upsert (--update).
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < stories.length; i += BATCH_SIZE) {
    const batch = stories.slice(i, i + BATCH_SIZE);
    const parts = [];
    for (const story of batch) {
      const key = `${story.lang}/${story.level}/${story.slug}`;
      const existed = existing.has(key);
      if (existed && !args.update) {
        skipped++;
        continue;
      }
      if (existed) updated++;
      else imported++;
      parts.push(storySql(story, story.mtimeSec, existed));
    }
    if (parts.length && !args.dryRun && d1RunFile(db, scope, parts.join("\n")) === null) {
      fail(
        `D1 batch at ${path.relative(root, batch[0].file)} failed — fix the error above and re-run ` +
          "(already-imported stories are skipped, so progress is kept)"
      );
    }
    process.stdout.write(`\rimport-content: ${Math.min(i + BATCH_SIZE, stories.length)}/${stories.length} processed`);
  }
  if (!args.dryRun) process.stdout.write("\n");
  console.log(
    `import-content: ${imported} imported, ${updated} updated, ${skipped} skipped` +
      (args.dryRun ? " (dry run — nothing written)" : "") + "."
  );

  // 4) Covers: frontmatter `image: /images/…` → R2 object + story_images row.
  //    width/height stay NULL (schema allows it; the reader draws by CSS box).
  if (!args.covers) {
    console.log("import-content: covers skipped (pass --covers to upload repo cover photos).");
    return;
  }
  const bucket = readBucketName(root);
  if (!bucket) fail("bucket_name not found in wrangler.jsonc (needed for --covers)");
  const now = Math.floor(Date.now() / 1000);
  let covers = 0;
  let coverSkip = 0;
  for (const story of stories) {
    const image = story.extras?.image;
    if (!image || !image.startsWith("/images/")) {
      coverSkip++;
      continue;
    }
    const abs = path.join(root, "public", image.replace(/^\//, ""));
    const ext = path.extname(abs).toLowerCase();
    const contentType = IMAGE_TYPES[ext];
    if (!contentType || !fs.existsSync(abs)) {
      console.warn(
        `import-content: warn: ${story.lang}/${story.level}/${story.slug}: cover missing or unsupported type: ${image}`
      );
      coverSkip++;
      continue;
    }
    const bytes = fs.readFileSync(abs);
    if (!bytes.length) {
      coverSkip++;
      continue;
    }
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    const key = `covers/${story.lang}/${story.level}/${story.slug}/${sha}${ext === ".jpeg" ? ".jpg" : ext}`;
    if (args.dryRun) {
      covers++;
      continue;
    }
    if (r2Put(bucket, key, abs, scope) === null) {
      fail(`R2 upload failed for ${image} — re-run with --covers (uploads are content-addressed, so retries are safe)`);
    }
    if (d1RunFile(db, scope, coverSql(story, key, contentType, bytes.length, sha, now)) === null) {
      fail(`story_images insert failed for ${key} — re-run with --covers`);
    }
    covers++;
  }
  console.log(`import-content: ${covers} covers uploaded, ${coverSkip} stories without a usable cover.`);
}

main();
