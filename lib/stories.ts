import fs from "fs";
import path from "path";
import { Story, StoryMeta, Lang, LEVELS, LANGS, GlossaryWord } from "./types";
import {
  blockLines,
  enOf,
  isSafeSegment,
  normalizeText,
  parseGlossaryLine,
  splitBlocks,
  splitFrontmatter,
  targetOf,
} from "../scripts/lib/story-format.mjs";

const CONTENT_DIR = path.join(process.cwd(), "content");
const STORY_IMG_DIR = path.join(process.cwd(), "public", "images", "stories");
const STORY_IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * Prod-only caches (build/prerender). Dev re-reads so content edits show
 * without a restart. Content is static at build, so caching the aggregate
 * collapses ~85 reads × ~113 pages to ~85 reads total.
 */
let coverSet: Set<string> | null = null;
let allCache: StoryMeta[] | null = null;

function getCoverSet(): Set<string> | null {
  if (process.env.NODE_ENV === "production") {
    if (!coverSet) {
      try {
        coverSet = new Set(fs.readdirSync(STORY_IMG_DIR));
      } catch {
        coverSet = new Set();
      }
    }
    return coverSet;
  }
  return null;
}

/** Resolve cover art: `image:` frontmatter wins, else `/images/stories/<slug>.<ext>` if present. */
function resolveStoryImage(slug: string, metaImage?: string): string | undefined {
  const front = metaImage?.trim();
  if (front) return front;
  const cached = getCoverSet();
  if (cached) {
    for (const ext of STORY_IMG_EXTS) {
      if (cached.has(`${slug}${ext}`)) return `/images/stories/${slug}${ext}`;
    }
    return undefined;
  }
  for (const ext of STORY_IMG_EXTS) {
    // fs.existsSync never throws — no try/catch needed here.
    if (fs.existsSync(path.join(STORY_IMG_DIR, `${slug}${ext}`))) {
      return `/images/stories/${slug}${ext}`;
    }
  }
  return undefined;
}

interface Parsed {
  meta: Record<string, string>;
  sentences: { target: string; en: string; glossary: GlossaryWord[] }[];
}

/**
 * Story file format — parsing primitives live in scripts/lib/story-format.mjs
 * (shared with the validator and the JA precompute); this is just the typed
 * assembly into a Story.
 */
export function parseStoryFile(raw: string): Parsed {
  const { meta, body } = splitFrontmatter(normalizeText(raw));
  const sentences: Parsed["sentences"] = [];
  for (const block of splitBlocks(body)) {
    const lines = blockLines(block);
    const target = targetOf(lines);
    if (!target) continue;
    const glossary: GlossaryWord[] = lines
      .filter((l) => l.startsWith("*"))
      .map((l) => {
        const g = parseGlossaryLine(l);
        return { surface: g.surface, note: g.note };
      });
    sentences.push({ target, en: enOf(lines), glossary });
  }
  return { meta, sentences };
}

function readStory(lang: string, level: string, slug: string): Story | null {
  if (!isSafeSegment(slug) || !isSafeSegment(level) || !isSafeSegment(lang)) {
    return null;
  }
  if (!(LANGS as string[]).includes(lang)) return null;
  const file = path.join(CONTENT_DIR, lang, level, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const { meta, sentences } = parseStoryFile(raw);
  const parsedMinutes = parseInt(meta.minutes ?? "3", 10);
  const minutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : 3;
  const langTyped = lang as Lang;
  return {
    lang: langTyped,
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
  const metas: StoryMeta[] = [];
  for (const f of listDir(path.join(CONTENT_DIR, lang, level))) {
    const slug = f.replace(/\.md$/, "");
    const s = readStory(lang, level, slug);
    if (!s) {
      console.warn(`stories: skipping unreadable file ${lang}/${level}/${f}`);
      continue;
    }
    metas.push({
      lang, level, slug,
      title: s.title,
      titleEn: s.titleEn,
      minutes: s.minutes,
      image: s.image,
      sentenceCount: s.sentences.length,
    });
  }
  return metas;
}

export function getAllStories(): StoryMeta[] {
  if (process.env.NODE_ENV === "production" && allCache) return allCache;
  const all = LANGS.flatMap((lang) =>
    (LEVELS[lang] ?? []).flatMap((level) => getStoriesForLevel(lang, level))
  );
  if (process.env.NODE_ENV === "production") allCache = all;
  return all;
}

export function getAllStoryPaths() {
  return getAllStories().map((s) => ({ lang: s.lang, level: s.level, slug: s.slug }));
}

