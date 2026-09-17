// Build gate: every story must carry usable frontmatter and well-formed blocks.
// Fails `npm run build` (via `prebuild`) instead of silently shipping slugs.
// Mirrors lib/stories.ts parsing (normalize CRLF/BOM first), then asserts.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

for (const file of walk(CONTENT)) {
  const rel = path.relative(CONTENT, file).split(path.sep);
  const key = rel.join("/");
  if (rel.length !== 3) {
    errors.push(`${key}: story must live at content/<lang>/<level>/<slug>.md`);
    continue;
  }
  const [lang, level, name] = rel;
  const slug = name.replace(/\.md$/, "");
  const raw = fs.readFileSync(file, "utf-8");
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const fm = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!fm) {
    errors.push(`${key}: missing frontmatter block`);
    continue;
  }
  const meta = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  for (const k of ["title", "title-en", "lang", "level"]) {
    if (!meta[k]) errors.push(`${key}: frontmatter missing "${k}"`);
  }
  if (meta.lang && meta.lang !== lang) errors.push(`${key}: lang mismatch (folder ${lang}, meta ${meta.lang})`);
  if (meta.level && meta.level !== level) errors.push(`${key}: level mismatch (folder ${level}, meta ${meta.level})`);

  const body = text.slice(fm[0].length).trim();
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  if (!blocks.length) {
    errors.push(`${key}: no sentence blocks`);
    continue;
  }
  blocks.forEach((block, i) => {
    const n = `${key}#${i + 1}`;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const target = lines.filter((l) => !l.startsWith("*") && !l.startsWith(">")).join(" ");
    const enCount = lines.filter((l) => l.startsWith(">")).length;
    const gloss = lines.filter((l) => l.startsWith("*"));
    if (!target) errors.push(`${n}: block has no target sentence`);
    if (enCount === 0) errors.push(`${n}: block has no "> translation" line`);
    if (enCount > 1) warnings.push(`${n}: ${enCount} "> translation" lines (first wins)`);
    if (gloss.length === 0 && lang !== "ja")
      warnings.push(`${n}: no glossary lines (adds word-tap definitions)`);
    for (const g of gloss) {
      if (!g.replace(/^\*\s*/, "").match(/^([^(]+)\((.+)\)\s*$/))
        warnings.push(`${n}: malformed glossary line (want "* surface (note)"): ${g.slice(0, 40)}`);
    }
  });
}

for (const w of warnings) console.warn("content warn: " + w);
if (errors.length) {
  for (const e of errors) console.error("content error: " + e);
  console.error(`\nvalidate-content: ${errors.length} error(s), build refused.`);
  process.exit(1);
}
console.log(`validate-content: OK (${walk(CONTENT).length} stories, ${warnings.length} warning(s)).`);
