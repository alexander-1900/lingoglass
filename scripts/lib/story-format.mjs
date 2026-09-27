// ONE implementation of the story markdown format — shared by the loader
// (lib/stories.ts), the build validator (scripts/validate-content.mjs) and
// the JA precompute (scripts/precompute-ja.mjs). Three hand-kept copies of
// these rules drifted silently; when you change the format, change it here.
//
// Format (see STORY-FORMAT.md):
//   ---
//   title: ... / title-en: ... / lang: ... / level: ... / minutes: ...
//   ---
//   blocks separated by blank lines:
//     plain line(s)  -> target sentence
//     * line(s)      -> word glossary: "surface (note)"
//     > line         -> English translation

export const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
export const FM_LINE_RE = /^([\w-]+):\s*(.+)$/;
export const GLOSS_RE = /^([^(]+)\((.+)\)\s*$/;
/** Canonical filename charset — slugs are filename stems from route params;
 *  reject path-traversal shapes. */
export const SAFE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u;

/**
 * Content is authored on Windows (CRLF) and *nix (LF). Normalize first:
 * without this, the frontmatter regex silently matches NOTHING on CRLF
 * files (`.` can't match `\r`, `$` can't match before it), dropping every
 * title site-wide while the build stays green. Also strips the BOM for the
 * same reason (`startsWith("---")`).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeText(raw) {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/**
 * @param {string} text normalized (use normalizeText first)
 * @returns {{ has: boolean, meta: Record<string, string>, body: string }}
 */
export function splitFrontmatter(text) {
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return { has: false, meta: {}, body: text };
  const meta = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(FM_LINE_RE);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { has: true, meta, body: text.slice(fm[0].length).trim() };
}

/** @param {string} body @returns {string[]} blank-line separated blocks */
export function splitBlocks(body) {
  return body.split(/\n\s*\n/).filter((b) => b.trim());
}

/** Trimmed, non-empty lines of one block. @param {string} block */
export function blockLines(block) {
  return block.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Target sentence: plain lines joined with a space. @param {string[]} lines */
export function targetOf(lines) {
  return lines.filter((l) => !l.startsWith("*") && !l.startsWith(">")).join(" ");
}

/** First `> translation` line (first wins). @param {string[]} lines */
export function enOf(lines) {
  const line = lines.find((l) => l.startsWith(">"));
  return line ? line.replace(/^>\s*/, "") : "";
}

/**
 * One `* ...` glossary line → { surface, note }. `ok: false` means the line
 * isn't in the expected "* surface (note)" shape (note falls back to "").
 * @param {string} line
 */
export function parseGlossaryLine(line) {
  const content = line.replace(/^\*\s*/, "");
  const m = content.match(GLOSS_RE);
  if (m) return { surface: m[1].trim(), note: m[2].trim(), ok: true };
  return { surface: content, note: "", ok: false };
}

/** Target sentences of a raw story file (fast path for the JA precompute).
 * @param {string} raw
 * @returns {string[]} */
export function parseSentences(raw) {
  const { body } = splitFrontmatter(normalizeText(raw));
  const out = [];
  for (const block of splitBlocks(body)) {
    const target = targetOf(blockLines(block));
    if (target) out.push(target);
  }
  return out;
}

/** Safe route-segment shape (no path traversal, canonical charset).
 * @param {string} v */
export function isSafeSegment(v) {
  return SAFE_SLUG.test(v) && !v.includes("..");
}
