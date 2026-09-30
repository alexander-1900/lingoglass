// Build gate: every story must carry usable frontmatter and well-formed blocks.
// Fails `npm run build` (via `prebuild`) instead of silently shipping slugs.
// Parsing delegates to lib/story-format.mjs (shared with lib/stories.ts and
// precompute-ja.mjs); this file only ASSERTS the results.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  blockLines,
  isSafeSegment,
  normalizeText,
  parseGlossaryLine,
  splitBlocks,
  splitFrontmatter,
  targetOf,
} from "./lib/story-format.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(root, "content");

const errors = [];
const warnings = [];

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = walk(CONTENT);

for (const file of files) {
  const rel = path.relative(CONTENT, file).split(path.sep);
  const key = rel.join("/");
  if (rel.length !== 3) {
    errors.push(`${key}: story must live at content/<lang>/<level>/<slug>.md`);
    continue;
  }
  const [lang, level, name] = rel;
  const slug = name.replace(/\.md$/, "");
  for (const [label, value] of [["lang", lang], ["level", level], ["slug", slug]]) {
    if (!isSafeSegment(value)) {
      errors.push(`${key}: illegal ${label} name "${value}" — use letters, numbers, _, ., - (e.g. rename to 01-my-story.md)`);
    }
  }
  const raw = fs.readFileSync(file, "utf-8");
  const { has: hasFm, meta, body } = splitFrontmatter(normalizeText(raw));

  if (!hasFm) {
    errors.push(`${key}: missing frontmatter block`);
    continue;
  }
  for (const k of ["title", "title-en", "lang", "level"]) {
    if (!meta[k]) errors.push(`${key}: frontmatter missing "${k}"`);
  }
  if (meta.lang && meta.lang !== lang) errors.push(`${key}: lang mismatch (folder ${lang}, meta ${meta.lang})`);
  if (meta.level && meta.level !== level) errors.push(`${key}: level mismatch (folder ${level}, meta ${meta.level})`);
  // Frontmatter image: local paths must exist (external http(s) URLs are
  // used verbatim by the loader and can't be checked here).
  const img = meta.image;
  if (img && img.startsWith("/") && !fs.existsSync(path.join(root, "public", img))) {
    warnings.push(`${key}: frontmatter image not found under public/: ${img}`);
  }

  const blocks = splitBlocks(body);
  if (!blocks.length) {
    errors.push(`${key}: no sentence blocks`);
    continue;
  }
  blocks.forEach((block, i) => {
    const n = `${key}#${i + 1}`;
    const lines = blockLines(block);
    const target = targetOf(lines);
    const enLines = lines.filter((l) => l.startsWith(">"));
    const gloss = lines.filter((l) => l.startsWith("*"));
    if (!target) errors.push(`${n}: block has no target sentence`);
    if (enLines.length === 0) errors.push(`${n}: block has no "> translation" line`);
    if (enLines.length > 1) warnings.push(`${n}: ${enLines.length} "> translation" lines (first wins)`);
    if (gloss.length === 0 && lang !== "ja")
      warnings.push(`${n}: no glossary lines (adds word-tap definitions)`);
    for (const g of gloss) {
      if (!parseGlossaryLine(g).ok)
        warnings.push(`${n}: malformed glossary line (want "* surface (note)"): ${g.slice(0, 40)}`);
    }
  });
}

// public/audio/ is committed like content/, and a leftover `--fixture` run holds
// locally synthesized BEEPS in it. Those entries are marked, so shout about them
// at prebuild rather than shipping test audio as narration.
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "public", "audio", "manifest.json"), "utf-8")
  );
  const beeps = Object.values(manifest).filter((e) => e?.fixture === true).length;
  if (beeps)
    console.warn(
      `audio warn: public/audio holds ${beeps} FIXTURE entr${beeps === 1 ? "y" : "ies"} — beep audio, not ` +
        `narration (the reader labels it "Studio Audio · test"). npm run audio:clear, then ` +
        "regenerate with npm run audio:generate before deploying."
    );
} catch {
  /* no audio generated yet — the reader falls back to Web Speech, which is fine */
}

for (const w of warnings) console.warn("content warn: " + w);
if (errors.length) {
  for (const e of errors) console.error("content error: " + e);
  console.error(`\nvalidate-content: ${errors.length} error(s), build refused.`);
  process.exit(1);
}
console.log(`validate-content: OK (${files.length} stories, ${warnings.length} warning(s)).`);
