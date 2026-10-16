// Pure content ⇄ D1 logic shared by scripts/import-content.mjs (file → D1) and
// scripts/sync-content.mjs (D1 → file). No fs/wrangler here — everything is
// testable headless in Node (tests/content-sync.test.ts).
//
// The invariant both directions rely on: a file parsed by parseContentFile()
// renders back through renderStoryMarkdown() (the canonical writer in
// story-format.mjs, shared with the admin API's round-trip check) to content
// the same parser reads identically. Anything that would not survive that
// round trip is an error, not a silent rewrite.

import {
  blockLines,
  enOf,
  normalizeText,
  parseGlossaryLine,
  renderStoryMarkdown,
  splitBlocks,
  splitFrontmatter,
  targetOf,
} from "./story-format.mjs";

/** Frontmatter keys owned by D1. Anything else (e.g. image:) rides along from
 *  the existing file — D1 has no column for it and dropping it would change
 *  which cover art the reader shows. */
export const CANONICAL_FM_KEYS = ["title", "title-en", "lang", "level", "minutes"];

/** API/D1 bounds for minutes (migrations CHECK + functions/_lib/stories LIMITS). */
const MINUTES_MIN = 1;
const MINUTES_MAX = 120;

/**
 * Parse one story file into the D1-shaped struct. `lang`/`level`/`slug` come
 * from the file's path and must match its frontmatter.
 * Throws (with a caller-supplied context prefix) on anything malformed or that
 * would not survive a render→parse round trip.
 *
 * @param {string} raw file contents (CRLF/BOM tolerated via normalizeText)
 * @param {{ lang: string, level: string, slug: string, context?: string }} where
 * @returns {{
 *   lang: string, level: string, slug: string, title: string, titleEn: string,
 *   minutes: number,
 *   sentences: { target: string, en: string, words: { surface: string, note: string }[] }[],
 *   extras: Record<string, string>,
 * }}
 */
export function parseContentFile(raw, where) {
  const ctx = where.context ?? `${where.lang}/${where.level}/${where.slug}`;
  const fail = (msg) => new Error(`${ctx}: ${msg}`);

  const { has, meta, body } = splitFrontmatter(normalizeText(raw));
  if (!has) throw fail("missing frontmatter block");
  for (const key of ["title", "title-en", "lang", "level"]) {
    if (!meta[key]) throw fail(`frontmatter missing "${key}"`);
  }
  if (meta.lang !== where.lang) throw fail(`lang mismatch (folder ${where.lang}, meta ${meta.lang})`);
  if (meta.level !== where.level) throw fail(`level mismatch (folder ${where.level}, meta ${meta.level})`);

  let minutes = 3;
  if (meta.minutes !== undefined) {
    const n = Number(meta.minutes);
    if (!Number.isInteger(n) || n < MINUTES_MIN || n > MINUTES_MAX) {
      throw fail(`minutes must be an integer ${MINUTES_MIN}–${MINUTES_MAX} (got "${meta.minutes}")`);
    }
    minutes = n;
  }

  const blocks = splitBlocks(body);
  if (!blocks.length) throw fail("no sentence blocks");
  const sentences = blocks.map((block, i) => {
    const lines = blockLines(block);
    const target = targetOf(lines);
    const en = enOf(lines);
    if (!target) throw fail(`block #${i + 1}: no target sentence`);
    if (!en) throw fail(`block #${i + 1}: no "> translation" line`);
    const words = lines
      .filter((l) => l.startsWith("*"))
      .map((l) => {
        const g = parseGlossaryLine(l);
        if (!g.ok || !g.surface || !g.note) {
          throw fail(`block #${i + 1}: malformed glossary line (want "* surface (note)"): ${l.slice(0, 60)}`);
        }
        return { surface: g.surface, note: g.note };
      });
    return { target, en, words };
  });

  const extras = pickExtras(meta);
  const story = {
    lang: where.lang,
    level: where.level,
    slug: where.slug,
    title: meta.title,
    titleEn: meta["title-en"],
    minutes,
    sentences,
    extras,
  };

  // Round-trip backstop: what we would write must parse back identically
  // (the admin API gates every payload on the same guarantee).
  const again = splitFrontmatter(normalizeText(renderContentFile(story)));
  const rt =
    (again.meta.title ?? "") === story.title &&
    (again.meta["title-en"] ?? "") === story.titleEn &&
    Number(again.meta.minutes) === story.minutes &&
    JSON.stringify(readSentences(again.body)) === JSON.stringify(sentences);
  if (!rt) throw fail("does not survive a render→parse round trip (fix the file)");
  return story;
}

/** Sentences out of an already-split body (round-trip helper). */
function readSentences(body) {
  return splitBlocks(body).map((block) => {
    const lines = blockLines(block);
    return {
      target: targetOf(lines),
      en: enOf(lines),
      words: lines.filter((l) => l.startsWith("*")).map((l) => {
        const g = parseGlossaryLine(l);
        return { surface: g.surface, note: g.note };
      }),
    };
  });
}

function pickExtras(meta) {
  const extras = {};
  for (const key of Object.keys(meta)) {
    if (!CANONICAL_FM_KEYS.includes(key)) extras[key] = meta[key];
  }
  return extras;
}

/** Canonical file bytes for a story. renderStoryMarkdown writes the D1-owned
 *  keys; non-canonical extras (image: …) are spliced in front of `lang:` —
 *  frontmatter order is irrelevant to the parser, layout just mirrors the
 *  existing files. Always LF, single trailing newline. */
export function renderContentFile(story, extras = story.extras ?? {}) {
  const md = renderStoryMarkdown(
    { title: story.title, titleEn: story.titleEn, lang: story.lang, level: story.level, minutes: story.minutes },
    story.sentences
  );
  const extraKeys = Object.keys(extras);
  if (!extraKeys.length) return md;
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith("lang:"));
  if (at === -1) throw new Error("renderStoryMarkdown output lost its lang line");
  lines.splice(at, 0, ...extraKeys.map((k) => `${k}: ${extras[k]}`));
  return lines.join("\n");
}

/** Semantic equality of the D1-owned parts (extras excluded by design: they
 *  come FROM the existing file, so they can never differ). */
export function storyEqual(a, b) {
  return (
    a.lang === b.lang &&
    a.level === b.level &&
    a.slug === b.slug &&
    a.title === b.title &&
    a.titleEn === b.titleEn &&
    a.minutes === b.minutes &&
    JSON.stringify(a.sentences) === JSON.stringify(b.sentences)
  );
}

