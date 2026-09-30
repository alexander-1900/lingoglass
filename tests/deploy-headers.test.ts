import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// public/_headers is deploy-only config: nothing in `npm run dev` reads it, and a
// rule that Cloudflare Pages refuses to match fails *silently* — the asset still
// serves 200, just with the wrong caching, which is the worst possible failure for
// content-hashed audio. Both ways this file has been broken in production are
// pinned here rather than left to a deploy-time glance.
//
// Measured against a live deployment (2026-09-30): Pages applies every matching
// block, concatenating a header declared by two of them ("nosniff, nosniff"), and
// honours only ONE wildcard per path — `/audio/*/*.mp3` never matches anything.

const FILE = path.join(process.cwd(), "public", "_headers");
const raw = existsSync(FILE) ? readFileSync(FILE, "utf-8") : "";

type Block = { pattern: string; headers: [string, string][] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      if (!current) continue;
      const [name, ...rest] = line.trim().split(":");
      current.headers.push([name.trim().toLowerCase(), rest.join(":").trim()]);
      continue;
    }
    current = { pattern: line.trim(), headers: [] };
    blocks.push(current);
  }
  return blocks;
}

const blocks = parse(raw);

/** Pages treats `*` as a splat that spans `/`, so one pattern can cover a tree. */
function matches(pattern: string, url: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(url);
}

const MANIFEST = "/audio/manifest.json";

describe("public/_headers", () => {
  it("the file exists and defines rules", () => {
    expect(blocks.length, "public/_headers missing or empty").toBeGreaterThan(0);
  });

  it("no path uses more than one wildcard — Pages ignores the whole rule", () => {
    for (const block of blocks) {
      const wildcards = (block.pattern.match(/\*/g) ?? []).length;
      expect(wildcards, `${block.pattern}: only one * is honoured`).toBeLessThanOrEqual(1);
    }
  });

  it("no block declares the same header twice (they are comma-joined, not replaced)", () => {
    for (const block of blocks) {
      const names = block.headers.map(([name]) => name);
      expect(new Set(names).size, `${block.pattern}: duplicate header`).toBe(names.length);
    }
  });

  it("content-hashed mp3 is immutable", () => {
    const rule = blocks.find((b) => b.pattern === "/audio/*.mp3");
    const value = rule?.headers.find(([name]) => name === "cache-control")?.[1];
    expect(value, "/audio/*.mp3 must set Cache-Control").toMatch(/immutable/);
    expect(matches("/audio/*.mp3", "/audio/es/story.01234567.mp3"), "must match a nested file").toBe(true);
  });

  it("timing JSON is left on the host default rather than pinned", () => {
    // Deliberate: it is small, it is what keeps highlighting honest, and a rule
    // broad enough to cover it (/audio/*.json) would also swallow manifest.json.
    const url = "/audio/es/story.01234567.json";
    const hits = blocks.filter(
      (b) => b.headers.some(([name]) => name === "cache-control") && matches(b.pattern, url),
    );
    expect(hits.map((b) => b.pattern), "timing JSON must not be pinned").toEqual([]);
  });

  it("manifest.json revalidates and no wildcard rule overrules it", () => {
    const own = blocks.find((b) => b.pattern === MANIFEST);
    expect(own?.headers.find(([name]) => name === "cache-control")?.[1]).toMatch(/must-revalidate/);
    // A splat crosses `/`, so a rule like `/audio/*.json` would silently win over
    // the exact manifest rule and cache a fixed filename for a year.
    for (const block of blocks) {
      if (!block.pattern.includes("*")) continue;
      const caching = block.headers.some(([name]) => name === "cache-control");
      if (!caching) continue;
      expect(matches(block.pattern, MANIFEST), `${block.pattern} must not match ${MANIFEST}`).toBe(false);
    }
  });

  it("generated audio URLs are covered by at most one caching rule", () => {
    const manifestPath = path.join(process.cwd(), "public", "audio", "manifest.json");
    if (!existsSync(manifestPath)) return; // audio not generated yet — nothing to check
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
      string,
      { mp3: string; timing: string }
    >;
    const caching = blocks.filter((b) => b.headers.some(([name]) => name === "cache-control"));
    for (const [key, entry] of Object.entries(manifest)) {
      // The mp3 carries the bytes, so it must be pinned by exactly one rule.
      expect(caching.filter((b) => matches(b.pattern, entry.mp3)).length, `${key}: mp3 rules`).toBe(1);
      // The timing JSON is deliberately left on the host default (revalidating), so
      // zero rules is correct — more than one would be two joined Cache-Controls.
      expect(caching.filter((b) => matches(b.pattern, entry.timing)).length, `${key}: timing rules`).toBeLessThanOrEqual(1);
    }
  });

  it("the security headers are declared once, on the catch-all", () => {
    const catchAll = blocks.find((b) => b.pattern === "/*");
    expect(catchAll, "no /* block").toBeTruthy();
    for (const name of ["content-security-policy", "strict-transport-security", "x-content-type-options"]) {
      const total = blocks.reduce(
        (sum, b) => sum + b.headers.filter(([header]) => header === name).length,
        0,
      );
      expect(total, `${name} declared more than once`).toBe(1);
    }
  });
});
