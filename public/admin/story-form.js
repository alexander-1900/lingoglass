// Pure client-side model for the admin list + editor: constants mirrored from
// functions/_lib/stories.ts, the filter⇄URL-hash contract, form state ⇄ API
// payloads, and a fast mirror of the server validation so obvious mistakes are
// caught before a round trip. The server stays authoritative — this mirror is
// UX only, and tests/admin-stories-ui.test.ts cross-checks the slug charset
// against scripts/lib/story-format.mjs so the two can't drift silently.
//
// No DOM, no fetch: Node imports this directly (tests + tooling).

/** Must stay in sync with functions/_lib/stories.ts (LANGS/LEVELS/LIMITS).
 *  tests/admin-stories-ui.test.ts pins the few values the editor hard-codes. */
export const LANGS = ["es", "ru", "ja"];

export const LANG_LABELS = { es: "Spanish", ru: "Russian", ja: "Japanese" };

export const LEVELS = {
  es: ["a1", "a2", "b1", "b2", "c1", "c2"],
  ru: ["a1", "a2", "b1", "b2", "c1", "c2"],
  ja: ["n5", "n4", "n3", "n2", "n1"],
};

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
};

/** Mirror of scripts/lib/story-format.mjs SAFE_SLUG (kept literal here because
 *  the browser cannot import .mjs from outside public/). */
export const SAFE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u;
/** Mirror of functions/_lib/stories.ts SLUG_PREFIX_RE. */
export const SLUG_PREFIX_RE = /^\d{2}-/;

/** List page size; the API caps limit at 100. */
export const PAGE_SIZE = 50;

const STATUSES = ["all", "draft", "published"];

/** @param {string} lang */
export function levelOptions(lang) {
  if (lang && LEVELS[lang]) return [...LEVELS[lang]];
  return [...new Set([...LEVELS.es, ...LEVELS.ja])];
}

/** @returns {{lang: string, level: string, status: string, q: string, deleted: boolean, offset: number}} */
export function defaultFilters() {
  return { lang: "", level: "", status: "all", q: "", deleted: false, offset: 0 };
}

/** Filters → the query part of the list hash ("?lang=ja&…" or ""). */
export function filtersToHashQuery(filters) {
  const sp = new URLSearchParams();
  if (filters.lang) sp.set("lang", filters.lang);
  if (filters.level) sp.set("level", filters.level);
  if (filters.status && filters.status !== "all") sp.set("status", filters.status);
  if (filters.q) sp.set("q", filters.q);
  if (filters.deleted) sp.set("deleted", "1");
  if (filters.offset) sp.set("offset", String(filters.offset));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

/** The list hash query part ("?…" or "") → validated filters. Unknown or
 *  malformed values fall back to defaults so a hand-edited hash can never
 *  wedge the view (or send a 400-inducing query). */
export function filtersFromHashQuery(search) {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const lang = LANGS.includes(sp.get("lang")) ? String(sp.get("lang")) : "";
  const wantedLevel = sp.get("level") ?? "";
  const level = wantedLevel && levelOptions(lang).includes(wantedLevel) ? wantedLevel : "";
  const wantedStatus = sp.get("status") ?? "all";
  const status = STATUSES.includes(wantedStatus) ? wantedStatus : "all";
  const q = (sp.get("q") ?? "").slice(0, LIMITS.query);
  const deleted = sp.get("deleted") === "1";
  const rawOffset = sp.get("offset") ?? "0";
  const offset = /^\d{1,9}$/.test(rawOffset) ? Number(rawOffset) : 0;
  return { lang, level, status, q, deleted, offset };
}

/** Filters → the API query string (always sends the defaults the API needs). */
export function listApiQuery(filters) {
  const sp = new URLSearchParams();
  if (filters.lang) sp.set("lang", filters.lang);
  if (filters.level) sp.set("level", filters.level);
  sp.set("status", filters.status || "all");
  if (filters.q) sp.set("q", filters.q);
  if (filters.deleted) sp.set("deleted", "1");
  sp.set("limit", String(PAGE_SIZE));
  sp.set("offset", String(filters.offset || 0));
  return sp.toString();
}


// ---- form state (editor) ----------------------------------------------------

export function emptyWord() {
  return { surface: "", note: "" };
}

export function emptySentence() {
  return { target: "", en: "", words: [] };
}

export function emptyFormState() {
  return {
    id: null,
    updatedAt: null,
    status: "draft",
    source: "admin",
    createdAt: null,
    deletedAt: null,
    coverImageId: null,
    lang: "es",
    level: "a1",
    slug: "",
    title: "",
    titleEn: "",
    minutes: 3,
    sentences: [emptySentence()],
  };
}

/** GET /api/admin/stories/:id body.story → editor state (deep copy — the
 *  editor mutates freely; the API payload is never touched). */
export function storyToFormState(story) {
  const sentences = Array.isArray(story.sentences)
    ? story.sentences.map((s) => ({
        target: String(s.target ?? ""),
        en: String(s.en ?? ""),
        words: (Array.isArray(s.words) ? s.words : []).map((w) => ({
          surface: String(w.surface ?? ""),
          note: String(w.note ?? ""),
        })),
      }))
    : [];
  if (sentences.length === 0) sentences.push(emptySentence());
  return {
    id: story.id,
    updatedAt: story.updatedAt,
    status: String(story.status ?? "draft"),
    source: String(story.source ?? "admin"),
    createdAt: story.createdAt ?? null,
    deletedAt: story.deletedAt ?? null,
    coverImageId: story.coverImageId ?? null,
    lang: story.lang,
    level: story.level,
    slug: String(story.slug ?? ""),
    title: String(story.title ?? ""),
    titleEn: String(story.titleEn ?? ""),
    minutes: Number(story.minutes),
    sentences,
  };
}

const trim = (v) => String(v ?? "").trim();

/** Editor state → POST/PUT payload: trims every string and drops untouched
 *  word rows (both fields blank) — the API would reject them otherwise. */
export function formToPayload(state) {
  return {
    lang: state.lang,
    level: state.level,
    slug: trim(state.slug),
    title: trim(state.title),
    titleEn: trim(state.titleEn),
    minutes: Number(state.minutes),
    sentences: state.sentences.map((s) => ({
      target: trim(s.target),
      en: trim(s.en),
      words: s.words
        .map((w) => ({ surface: trim(w.surface), note: trim(w.note) }))
        .filter((w) => w.surface !== "" || w.note !== ""),
    })),
  };
}

const hasNewline = (v) => v.includes("\n") || v.includes("\r");

function checkLine(field, value, max, push) {
  if (!value) push(field, "must not be empty");
  else if (value.length > max) push(field, `must be at most ${max} characters`);
  else if (hasNewline(value)) push(field, "must be a single line (no line breaks)");
}

/** Client-side pre-save check. Messages quote functions/_lib/stories.ts so the
 *  same problem reads the same before and after a round trip; the server's
 *  round-trip guarantee remains the backstop for anything subtler. */
export function quickIssues(state) {
  const issues = [];
  const push = (field, message) => issues.push({ field, message });

  const slug = trim(state.slug);
  if (!slug) push("slug", "must not be empty");
  else if (slug.length > LIMITS.slugMax) push("slug", `must be at most ${LIMITS.slugMax} characters`);
  else if (hasNewline(slug)) push("slug", "must be a single line (no line breaks)");
  else if (!SAFE_SLUG.test(slug) || slug.includes(".."))
    push("slug", "use letters, numbers, _, . and - only (no spaces, no path segments)");
  else if (slug !== slug.toLowerCase())
    push("slug", "must be lowercase — it becomes a filename and URLs are case-sensitive");
  else if (!SLUG_PREFIX_RE.test(slug))
    push("slug", 'must start with a 2-digit order prefix, e.g. "06-my-story" (keeps library order)');
  else if (slug.endsWith("-") || slug.endsWith(".")) push("slug", "must not end with a hyphen or a dot");

  checkLine("title", trim(state.title), LIMITS.title, push);
  checkLine("titleEn", trim(state.titleEn), LIMITS.title, push);

  const minutes = Number(state.minutes);
  if (!Number.isInteger(minutes)) push("minutes", "must be an integer");
  else if (minutes < LIMITS.minutesMin || minutes > LIMITS.minutesMax)
    push("minutes", `must be between ${LIMITS.minutesMin} and ${LIMITS.minutesMax}`);

  if (!Array.isArray(state.sentences) || state.sentences.length === 0) {
    push("sentences", "at least one sentence is required");
    return issues;
  }
  if (state.sentences.length > LIMITS.sentences) push("sentences", `at most ${LIMITS.sentences} sentences`);

  let wordsTotal = 0;
  state.sentences.forEach((s, i) => {
    const field = `sentences[${i}]`;
    const target = trim(s.target);
    checkLine(`${field}.target`, target, LIMITS.sentence, push);
    if (target && (target.startsWith("*") || target.startsWith(">")))
      push(`${field}.target`, 'must not start with "*" or ">" — reserved format markers');
    checkLine(`${field}.en`, trim(s.en), LIMITS.sentence, push);
    if (s.words.length > LIMITS.wordsPerSentence)
      push(`${field}.words`, `at most ${LIMITS.wordsPerSentence} words per sentence`);
    s.words.forEach((w, j) => {
      const wField = `${field}.words[${j}]`;
      const surface = trim(w.surface);
      const note = trim(w.note);
      if (!surface && !note) return; // untouched row — dropped on save
      checkLine(`${wField}.surface`, surface, LIMITS.surface, push);
      if (surface.includes("(")) push(`${wField}.surface`, 'must not contain "(" — the format is "* surface (note)"');
      checkLine(`${wField}.note`, note, LIMITS.note, push);
      wordsTotal += 1;
    });
  });
  if (wordsTotal > LIMITS.wordsTotal)
    push("sentences", `at most ${LIMITS.wordsTotal} glossary words per story (got ${wordsTotal})`);
  return issues;
}

/** [{field,message}] → {field: "first · second"}. Malformed entries are
 *  ignored; several issues on one field are joined, never lost. */
export function issueMap(issues) {
  const map = {};
  for (const issue of issues ?? []) {
    if (!issue || typeof issue.field !== "string" || typeof issue.message !== "string") continue;
    map[issue.field] = map[issue.field] ? `${map[issue.field]} · ${issue.message}` : issue.message;
  }
  return map;
}

// ---- small shared helpers ---------------------------------------------------

/** Unix seconds → "YYYY-MM-DD HH:MM" (local); "—" for null/NaN values. */
export function formatEpoch(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "07" → "07-"; anything but a 2-digit string → "" (no suggestion). */
export function suggestedSlugPrefix(nextSlugIndex) {
  return typeof nextSlugIndex === "string" && /^\d{2}$/.test(nextSlugIndex) ? `${nextSlugIndex}-` : "";
}

/** True while the slug field still holds only the suggested "NN-" prefix —
 *  safe to silently replace when lang/level changes. */
export function isSlugPlaceholder(slug) {
  return /^\d{2}-$/.test(trim(slug));
}


// ---- cover images (editor side) --------------------------------------------

/** Mirrors the types functions/_lib/images.ts sniffs for (schema CHECK). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Mirrors ADMIN_MAX_UPLOAD_BYTES (wrangler.jsonc: 5 MB). */
export const IMAGE_MAX_BYTES = 5242880;

/** First problem with a picked file, or null when it may be uploaded.
 *  The server re-checks by sniffing the actual bytes — this is UX only. */
export function imageIssue(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (!IMAGE_TYPES.includes(type)) return "must be a JPEG, PNG or WebP image";
  const size = Number((file && file.size) ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "file is empty";
  if (size > IMAGE_MAX_BYTES) return `must be at most ${Math.floor(IMAGE_MAX_BYTES / 1024 / 1024)} MB`;
  return null;
}

