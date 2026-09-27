import fs from "fs";
import path from "path";
import type { Token } from "./types";

/**
 * Build-time loader for precomputed Japanese tokens (server/SSG only —
 * `fs` is unavailable on Cloudflare Workers/Netlify Functions at runtime,
 * which is exactly why tokens are generated ahead of time by
 * scripts/precompute-ja.mjs and committed as data/ja-tokens.generated.json).
 */

type StoryTokens = Token[][];

interface JaTokensFile {
  generatedAt: string;
  signature: string;
  stories: Record<string, StoryTokens>;
}

let cache: JaTokensFile | null | undefined;

function loadFile(): JaTokensFile | null {
  if (cache !== undefined) return cache;
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "data", "ja-tokens.generated.json"),
      "utf-8"
    );
    cache = JSON.parse(raw) as JaTokensFile;
  } catch {
    cache = null;
  }
  return cache;
}

/** Sentence-indexed tokens for one story, or undefined when unavailable. */
export function loadJaTokensForStory(
  lang: string,
  level: string,
  slug: string
): Record<number, Token[]> | undefined {
  const data = loadFile();
  const tokens = data?.stories[`${lang}/${level}/${slug}`];
  if (!tokens || tokens.length === 0) return undefined;
  return Object.fromEntries(tokens.map((t, i) => [String(i), t]));
}
