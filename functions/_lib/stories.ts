// Story-input rules for the /admin stories API (Phase 3): normalization,
// validation with field-level issues, and the round-trip guarantee.
//
// The round-trip guarantee is the core of this module: before anything reaches
// D1 the value is rendered with renderStoryMarkdown() and parsed again with the
// SAME primitives lib/stories.ts uses at build time. Any mismatch is a
// validation error. That check — not the individual rules — is what guarantees
// Phase 6 can export content/** files the reader parses identically. The
// individual rules below exist mainly to give friendlier messages (a target
// line starting with "*" would silently come back as a glossary entry; the
// round-trip check is the backstop for anything not explicitly ruled out).
//
// Deliberately dependency-light: no Workers/D1/DOM imports, so both the root
// tsconfig (tests typecheck this file) and functions/tsconfig compile it.

import {
  isSafeSegment,
  normalizeText,
  splitFrontmatter,
  splitBlocks,
  blockLines,
  targetOf,
  enOf,
  parseGlossaryLine,
  renderStoryMarkdown,
} from "../../scripts/lib/story-format.mjs";

export const LANGS = ["es", "ru", "ja"] as const;
export type Lang = (typeof LANGS)[number];

export const LEVELS: Record<Lang, readonly string[]> = {
  es: ["a1", "a2", "b1", "b2", "c1", "c2"],
  ru: ["a1", "a2", "b1", "b2", "c1", "c2"],
  ja: ["n5", "n4", "n3", "n2", "n1"],
};

/** API-layer limits. Tighter than the D1 CHECK backstops in migrations/0002. */
export const LIMITS = {
  title: 200,
  sentence: 1000,
  surface: 80,
  note: 200,
  minutesMin: 1,
  minutesMax: 120,
  slugMin: 1,
  slugMax: 100,
  sentences: 200,
  wordsPerSentence: 50,
  wordsTotal: 2000,
  query: 100,
} as const;

/** 2-digit ordering prefix. lib/stories.ts lists files with `readdirSync().sort()`,
 *  so "NN-slug" is the only filename shape that keeps library order stable. */
export const SLUG_PREFIX_RE = /^\d{2}-/;

export interface StoryWordInput {
  surface: string;
  note: string;
}
export interface StorySentenceInput {
  target: string;
  en: string;
  words: StoryWordInput[];
}
export interface StoryInput {
  lang: Lang;
  level: string;
  slug: string;
  title: string;
  titleEn: string;
  minutes: number;
  sentences: StorySentenceInput[];
}
export interface ValidationIssue {
  field: string;
  message: string;
}
export type StoryValidation =
  | { ok: true; value: StoryInput }
  | { ok: false; issues: ValidationIssue[] };

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

export function isLevelFor(lang: Lang, v: unknown): v is string {
  return typeof v === "string" && LEVELS[lang].includes(v);
}

/** Any level of any language (used when filtering without a lang). */
export function isAnyLevel(v: unknown): boolean {
  return typeof v === "string" && LANGS.some((l) => LEVELS[l].includes(v));
}

/** Route param → story id, or null when malformed. Ids are small positive ints. */
export function parseStoryIdParam(raw: string | string[] | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

const hasNewline = (v: string) => v.includes("\n") || v.includes("\r");

/**
 * Trimmed string field with length bounds and the no-line-breaks rule (every
 * story value is written on exactly one line — see renderStoryMarkdown).
 */
function takeString(
  raw: unknown,
  field: string,
  min: number,
  max: number,
  issues: ValidationIssue[]
): string | null {
  if (typeof raw !== "string") {
    issues.push({ field, message: "must be a string" });
    return null;
  }
  const v = raw.trim();
  if (v.length < min) {
    issues.push({ field, message: "must not be empty" });
    return null;
  }
  if (v.length > max) {
    issues.push({ field, message: `must be at most ${max} characters` });
    return null;
  }
  if (hasNewline(v)) {
    issues.push({ field, message: "must be a single line (no line breaks)" });
    return null;
  }
  return v;
}

/** Slug rule set — mirrors the content/ filename contract + the CMS rules. */
function takeSlug(raw: unknown, issues: ValidationIssue[]): string | null {
  const v = takeString(raw, "slug", LIMITS.slugMin, LIMITS.slugMax, issues);
  if (v === null) return null;
  if (!isSafeSegment(v)) {
    issues.push({
      field: "slug",
      message: "use letters, numbers, _, . and - only (no spaces, no path segments)",
    });
    return null;
  }
  if (v !== v.toLowerCase()) {
    issues.push({
      field: "slug",
      message: "must be lowercase — it becomes a filename and URLs are case-sensitive",
    });
    return null;
  }
  if (!SLUG_PREFIX_RE.test(v)) {
    issues.push({
      field: "slug",
      message: 'must start with a 2-digit order prefix, e.g. "06-my-story" (keeps library order)',
    });
    return null;
  }
  if (v.endsWith("-") || v.endsWith(".")) {
    issues.push({ field: "slug", message: "must not end with a hyphen or a dot" });
    return null;
  }
  return v;
}

/**
 * Parse + validate an untrusted request body into a StoryInput, or a list of
 * field-level issues. Never throws; never touches D1.
 */
export function parseStoryInput(raw: unknown): StoryValidation {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ field: "body", message: "must be a JSON object" }] };
  }
  const b = raw as Record<string, unknown>;

  const lang = isLang(b.lang) ? b.lang : null;
  if (!lang) issues.push({ field: "lang", message: "must be one of: es, ru, ja" });

  let level: string | null = null;
  if (lang) {
    if (isLevelFor(lang, b.level)) level = b.level as string;
    else issues.push({ field: "level", message: `must be a level of "${lang}": ${LEVELS[lang].join(", ")}` });
  }

  const slug = takeSlug(b.slug, issues);
  const title = takeString(b.title, "title", 1, LIMITS.title, issues);
  const titleEn = takeString(b.titleEn, "titleEn", 1, LIMITS.title, issues);

  let minutes = 3; // optional; the reader defaults to 3 when absent
  if (b.minutes !== undefined && b.minutes !== null) {
    if (typeof b.minutes !== "number" || !Number.isInteger(b.minutes)) {
      issues.push({ field: "minutes", message: "must be an integer" });
    } else if (b.minutes < LIMITS.minutesMin || b.minutes > LIMITS.minutesMax) {
      issues.push({ field: "minutes", message: `must be between ${LIMITS.minutesMin} and ${LIMITS.minutesMax}` });
    } else {
      minutes = b.minutes;
    }
  }

  const sentences: StorySentenceInput[] = [];
  let wordsTotal = 0;
  if (!Array.isArray(b.sentences) || b.sentences.length === 0) {
    issues.push({ field: "sentences", message: "at least one sentence is required" });
  } else if (b.sentences.length > LIMITS.sentences) {
    issues.push({ field: "sentences", message: `at most ${LIMITS.sentences} sentences` });
  } else {
    b.sentences.forEach((rawSentence, i) => {
      const field = `sentences[${i}]`;
      if (typeof rawSentence !== "object" || rawSentence === null || Array.isArray(rawSentence)) {
        issues.push({ field, message: "must be an object" });
        return;
      }
      const s = rawSentence as Record<string, unknown>;
      const target = takeString(s.target, `${field}.target`, 1, LIMITS.sentence, issues);
      const en = takeString(s.en, `${field}.en`, 1, LIMITS.sentence, issues);
      if (target && (target.startsWith("*") || target.startsWith(">"))) {
        issues.push({ field: `${field}.target`, message: 'must not start with "*" or ">" — reserved format markers' });
      }

      const words: StoryWordInput[] = [];
      const rawWords = s.words ?? [];
      if (!Array.isArray(rawWords)) {
        issues.push({ field: `${field}.words`, message: "must be an array" });
      } else if (rawWords.length > LIMITS.wordsPerSentence) {
        issues.push({ field: `${field}.words`, message: `at most ${LIMITS.wordsPerSentence} words per sentence` });
      } else {
        rawWords.forEach((rawWord, j) => {
          const wField = `${field}.words[${j}]`;
          if (typeof rawWord !== "object" || rawWord === null || Array.isArray(rawWord)) {
            issues.push({ field: wField, message: "must be an object" });
            return;
          }
          const w = rawWord as Record<string, unknown>;
          const surface = takeString(w.surface, `${wField}.surface`, 1, LIMITS.surface, issues);
          const note = takeString(w.note, `${wField}.note`, 1, LIMITS.note, issues);
          if (surface && surface.includes("(")) {
            issues.push({ field: `${wField}.surface`, message: 'must not contain "(" — the format is "* surface (note)"' });
          } else if (surface && note) {
            words.push({ surface, note });
          }
        });
        wordsTotal += words.length;
      }
      sentences.push({ target: target ?? "", en: en ?? "", words });
    });
    if (wordsTotal > LIMITS.wordsTotal) {
      issues.push({ field: "sentences", message: `at most ${LIMITS.wordsTotal} glossary words per story (got ${wordsTotal})` });
    }
  }

  if (issues.length > 0 || !lang || !level || !slug || !title || !titleEn) {
    if (issues.length === 0) issues.push({ field: "body", message: "incomplete story" });
    return { ok: false, issues: issues.slice(0, 40) };
  }

  const value: StoryInput = { lang, level, slug, title, titleEn, minutes, sentences };
  const roundTrip = verifyRoundTrip(value);
  if (roundTrip.length > 0) return { ok: false, issues: roundTrip.slice(0, 40) };
  return { ok: true, value };
}

/**
 * Render the value and parse it back with the reader's primitives; any
 * difference means the story could not survive the Phase 6 export unchanged.
 */
export function verifyRoundTrip(value: StoryInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const md = renderStoryMarkdown(
    { title: value.title, titleEn: value.titleEn, lang: value.lang, level: value.level, minutes: value.minutes },
    value.sentences
  );
  const { has, meta, body } = splitFrontmatter(normalizeText(md));
  if (!has) return [{ field: "story", message: "round-trip failed: rendered markdown lost its frontmatter" }];

  if (meta.title !== value.title) issues.push({ field: "title", message: "round-trip mismatch" });
  if (meta["title-en"] !== value.titleEn) issues.push({ field: "titleEn", message: "round-trip mismatch" });
  if (meta.lang !== value.lang) issues.push({ field: "lang", message: "round-trip mismatch" });
  if (meta.level !== value.level) issues.push({ field: "level", message: "round-trip mismatch" });
  if (meta.minutes !== String(value.minutes)) issues.push({ field: "minutes", message: "round-trip mismatch" });

  const blocks = splitBlocks(body);
  if (blocks.length !== value.sentences.length) {
    issues.push({ field: "sentences", message: "round-trip mismatch (block count changed)" });
    return issues;
  }
  for (let i = 0; i < blocks.length; i++) {
    const lines = blockLines(blocks[i]);
    const want = value.sentences[i];
    if (targetOf(lines) !== want.target) {
      issues.push({
        field: `sentences[${i}].target`,
        message: 'round-trip mismatch — the sentence would not parse back identically (do not start with "*" or ">")',
      });
    }
    if (enOf(lines) !== want.en) {
      issues.push({ field: `sentences[${i}].en`, message: "round-trip mismatch" });
    }
    const glossLines = lines.filter((l) => l.startsWith("*"));
    if (glossLines.length !== want.words.length) {
      issues.push({ field: `sentences[${i}].words`, message: "round-trip mismatch (word count changed)" });
    } else {
      for (let j = 0; j < glossLines.length; j++) {
        const parsed = parseGlossaryLine(glossLines[j]);
        const w = want.words[j];
        if (!parsed.ok || parsed.surface !== w.surface || parsed.note !== w.note) {
          issues.push({
            field: `sentences[${i}].words[${j}]`,
            message: 'round-trip mismatch — keep the "* surface (note)" shape intact',
          });
        }
      }
    }
    if (issues.length > 20) break; // cap the noise
  }
  return issues;
}

// ---- D1 row shapes → API JSON ----------------------------------------------
// Plain structural types (no D1Database reference) so this module stays
// compilable by both tsconfigs; functions/_lib/story-db.ts casts query
// results into these.

export interface StoryRow {
  id: number;
  lang: string;
  level: string;
  slug: string;
  title: string;
  title_en: string;
  minutes: number;
  status: string;
  source: string;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  deleted_at: number | null;
}

export interface StoryListRow extends StoryRow {
  sentence_count: number;
  cover_image_id: number | null;
}

export function storySummaryJson(row: StoryRow) {
  return {
    id: row.id,
    lang: row.lang,
    level: row.level,
    slug: row.slug,
    title: row.title,
    titleEn: row.title_en,
    minutes: row.minutes,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    deletedAt: row.deleted_at,
  };
}

export function storyListJson(row: StoryListRow) {
  return {
    ...storySummaryJson(row),
    sentenceCount: row.sentence_count,
    coverImageId: row.cover_image_id,
  };
}

// ---- Publish transition (Phase 6) -------------------------------------------
// Pure decision for POST /stories/:id/publish, mirroring how restore.ts treats
// an already-live story: publishing is idempotent, but a trashed story is a
// 409 (restore first — one path in, one out).

export type PublishPlan =
  | { action: "publish" }
  | { action: "noop" }
  | { action: "reject"; code: "story_deleted"; message: string };

export function planPublish(row: StoryRow): PublishPlan {
  if (row.deleted_at !== null) {
    return {
      action: "reject",
      code: "story_deleted",
      message: "This story is in the trash — restore it before publishing",
    };
  }
  if (row.status === "published") return { action: "noop" };
  return { action: "publish" };
}

/** Optimistic-lock verdict shared by PUT /stories/:id and the publish route:
 *  the client echoes the updatedAt it loaded; null/undefined means "no
 *  expectation" (curl-style calls opt out). */
export type LockCheck =
  | { ok: true }
  | {
      ok: false;
      code: "invalid_updated_at" | "conflict";
      message: string;
      updatedAt?: number;
    };

export function checkUpdatedAtLock(row: StoryRow, expect: unknown): LockCheck {
  if (expect === undefined || expect === null) return { ok: true };
  if (typeof expect !== "number" || !Number.isInteger(expect)) {
    return {
      ok: false,
      code: "invalid_updated_at",
      message: "updatedAt must be an integer (unix seconds)",
    };
  }
  // Equal-second writes are theoretically indistinguishable (epoch-seconds
  // convention), but a single operator's editor always sends its own
  // last-seen value, so the practical clobber window is sub-second.
  if (expect !== row.updated_at) {
    return {
      ok: false,
      code: "conflict",
      message: "The story changed since it was loaded — reload and re-apply your edits",
      updatedAt: row.updated_at,
    };
  }
  return { ok: true };
}
