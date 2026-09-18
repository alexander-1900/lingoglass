import fs from "fs";
import path from "path";
import { Story, StoryMeta, Lang, LEVELS, LANGS, GlossaryWord } from "./types";

const CONTENT_DIR = path.join(process.cwd(), "content");
const STORY_IMG_DIR = path.join(process.cwd(), "public", "images", "stories");
const STORY_IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

/** Resolve cover art: `image:` frontmatter wins, else `/images/stories/<slug>.<ext>` if present. */
function resolveStoryImage(slug: string, metaImage?: string): string | undefined {
  const front = metaImage?.trim();
  if (front) return front;
  for (const ext of STORY_IMG_EXTS) {
    try {
      if (fs.existsSync(path.join(STORY_IMG_DIR, `${slug}${ext}`))) {
        return `/images/stories/${slug}${ext}`;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

interface Parsed {
  meta: Record<string, string>;
  sentences: { target: string; en: string; glossary: GlossaryWord[] }[];
}

/**
 * Story file format:
 * ---
 * title: ... / title-en: ... / lang: ... / level: ... / minutes: ...
 * ---
 * blocks separated by blank lines:
 *   plain line(s)  -> target sentence
 *   * line(s)      -> word glossary: "surface (note)"
 *   > line         -> English translation
 */
function parseStoryFile(raw: string): Parsed {
  // Content is authored on Windows (CRLF) and *nix (LF). Normalize first:
  // without this, the per-line frontmatter regex below silently matches
  // NOTHING on CRLF files (`.` can't match `\r`, `$` can't match before
  // it), dropping every title/subtitle site-wide while the build stays
  // green. Also strip a BOM for the same reason (`startsWith("---")`).
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};
  let body = text;
  const fm = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = text.slice(fm[0].length).trim();
  }

  const sentences: Parsed["sentences"] = [];
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const target = lines.filter((l) => !l.startsWith("*") && !l.startsWith(">")).join(" ");
    if (!target) continue;
    const en = lines.find((l) => l.startsWith(">"))?.replace(/^>\s*/, "") ?? "";
    const glossary: GlossaryWord[] = [];
    for (const line of lines.filter((l) => l.startsWith("*"))) {
      const m = line.replace(/^\*\s*/, "").match(/^([^(]+)\((.+)\)\s*$/);
      if (m) glossary.push({ surface: m[1].trim(), note: m[2].trim() });
      else glossary.push({ surface: line.replace(/^\*\s*/, ""), note: "" });
    }
    sentences.push({ target, en, glossary });
  }
  return { meta, sentences };
}

/** Slugs are filename stems from route params; reject path-traversal shapes. */
const SAFE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u;

function readStory(lang: Lang, level: string, slug: string): Story | null {
  if (!SAFE_SLUG.test(slug) || !SAFE_SLUG.test(level) || slug.includes("..") || level.includes("..")) {
    return null;
  }
  const file = path.join(CONTENT_DIR, lang, level, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const { meta, sentences } = parseStoryFile(raw);
  const parsedMinutes = parseInt(meta.minutes ?? "3", 10);
  const minutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : 3;
  return {
    lang,
    level,
    slug,
    title: meta.title ?? slug,
    titleEn: meta["title-en"] ?? meta.titleEn ?? "",
    minutes,
    image: resolveStoryImage(slug, meta.image),
    sentenceCount: sentences.length,
    sentences,
  };
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export function getStory(lang: Lang, level: string, slug: string): Story | null {
  return readStory(lang, level, slug);
}

export function getStoriesForLevel(lang: Lang, level: string): StoryMeta[] {
  return listDir(path.join(CONTENT_DIR, lang, level)).map((f) => {
    const slug = f.replace(/\.md$/, "");
    const s = readStory(lang, level, slug)!;
    return {
      lang, level, slug,
      title: s.title,
      titleEn: s.titleEn,
      minutes: s.minutes,
      image: s.image,
      sentenceCount: s.sentences.length,
    };
  });
}

export function getLevelsForLang(lang: Lang): { level: string; count: number }[] {
  return (LEVELS[lang] ?? []).map((level) => ({
    level,
    count: getStoriesForLevel(lang, level).length,
  }));
}

export function getAllStories(): StoryMeta[] {
  return LANGS.flatMap((lang) =>
    (LEVELS[lang] ?? []).flatMap((level) => getStoriesForLevel(lang, level))
  );
}

export function getAllStoryPaths() {
  return getAllStories().map((s) => ({ lang: s.lang, level: s.level, slug: s.slug }));
}

