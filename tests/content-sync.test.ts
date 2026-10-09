// Phase 6 content sync — the pure file⇄D1 logic that both the one-time import
// (scripts/import-content.mjs) and the publish export (scripts/sync-content.mjs)
// depend on. Everything here runs headless: no D1, no wrangler, no network.
//
// The anchor case is a REAL story file (content/es/a1/01-mi-rutina-diaria.md):
// the round trip the whole pipeline relies on is "a file parses to a struct
// that renders back to a file the same parser reads identically" — proven here
// against production content, not a fixture.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_FM_KEYS,
  parseContentFile,
  renderContentFile,
  storyEqual,
} from "../scripts/lib/content-sync.mjs";

const ANCHOR = path.join(process.cwd(), "content", "es", "a1", "01-mi-rutina-diaria.md");
const anchorWhere = { lang: "es", level: "a1", slug: "01-mi-rutina-diaria" } as const;

const GOOD = `---
title: La casa nueva
title-en: The new house
lang: es
level: a1
minutes: 4
---

La casa es grande.
* casa (noun, fem.: house)
> The house is big.

Hay un jardín.
* hay (verb: there is / there are)
> There is a garden.
`;

describe("parseContentFile (round-trip gate)", () => {
  it("accepts a minimal story and defaults minutes to 3", () => {
    const story = parseContentFile(GOOD.replace("minutes: 4\n", ""), { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    expect(story.minutes).toBe(3);
    expect(story.sentences).toHaveLength(2);
    expect(story.sentences[0].words).toEqual([{ surface: "casa", note: "noun, fem.: house" }]);
    expect(story.extras).toEqual({});
  });

  it("collects non-canonical frontmatter keys as extras (image rides along)", () => {
    const raw = GOOD.replace("lang: es", "image: /images/stories/06-la-casa-nueva.jpg\nlang: es");
    const story = parseContentFile(raw, { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    expect(story.extras).toEqual({ image: "/images/stories/06-la-casa-nueva.jpg" });
    for (const key of Object.keys(story.extras)) expect(CANONICAL_FM_KEYS).not.toContain(key);
  });

  it("rejects path/meta mismatches and malformed blocks with context", () => {
    const at = (raw: string, where = { lang: "es", level: "a1", slug: "06-x" }) => {
      try {
        parseContentFile(raw, where);
        return "accepted";
      } catch (err) {
        return (err as Error).message;
      }
    };
    expect(at(GOOD.replace("lang: es", "lang: ru"))).toContain("lang mismatch");
    expect(at(GOOD.replace("level: a1", "level: b2"))).toContain("level mismatch");
    expect(at("---\ntitle: x\n---\n\nHola.\n")).toContain('frontmatter missing "title-en"');
    expect(at(GOOD.replace("* casa (noun, fem.: house)\n", "* casa\n"))).toContain("malformed glossary line");
    expect(at(GOOD.replace("minutes: 4", "minutes: 999"))).toContain("minutes must be an integer");
  });

  it("survives CRLF input (normalizeText) identically to LF input", () => {
    const lf = parseContentFile(GOOD, anchorWhere);
    const crlf = parseContentFile(GOOD.replace(/\n/g, "\r\n"), anchorWhere);
    expect(storyEqual(lf, crlf)).toBe(true);
  });
});

describe("renderContentFile", () => {
  it("renders what parseContentFile reads back identically (semantic round trip)", () => {
    const story = parseContentFile(GOOD, { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    const again = parseContentFile(renderContentFile(story), { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    expect(storyEqual(story, again)).toBe(true);
    expect(again.extras).toEqual({});
  });

  it("splices extras in front of lang: and round-trips them", () => {
    const story = parseContentFile(GOOD, { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    const md = renderContentFile(story, { image: "/images/stories/x.jpg" });
    expect(md).toContain("image: /images/stories/x.jpg\nlang: es");
    const again = parseContentFile(md, { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    expect(again.extras).toEqual({ image: "/images/stories/x.jpg" });
    expect(storyEqual(story, again)).toBe(true);
  });

  it("always emits LF and a single trailing newline", () => {
    const story = parseContentFile(GOOD, { lang: "es", level: "a1", slug: "06-la-casa-nueva" });
    const md = renderContentFile(story);
    expect(md.includes("\r")).toBe(false);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("anchor: content/es/a1/01-mi-rutina-diaria.md", () => {
  const raw = readFileSync(ANCHOR, "utf-8");
  const story = parseContentFile(raw, anchorWhere);

  it("parses production content and keeps its cover extra", () => {
    expect(story.lang).toBe("es");
    expect(story.level).toBe("a1");
    expect(story.slug).toBe("01-mi-rutina-diaria");
    expect(story.sentences.length).toBeGreaterThanOrEqual(5);
    // The cover URL is NOT pinned to one folder: this story has an R2 cover, so
    // sync-content rewrites `image:` to /images/covers/<lang>/<level>/<slug>.ext,
    // while a repo-only cover stays at /images/stories/<slug>.ext. Either way it
    // must be an /images/ path ending in the story's own filename.
    expect(story.extras.image).toMatch(/^\/images\/(stories\/01-mi-rutina-diaria|covers\/es\/a1\/01-mi-rutina-diaria)\.jpg$/);
  });

  it("renders back to bytes the same parser reads identically", () => {
    const rendered = renderContentFile(story, story.extras);
    const again = parseContentFile(rendered, anchorWhere);
    expect(storyEqual(story, again)).toBe(true);
    expect(again.extras).toEqual(story.extras);
    // Byte-level: identical modulo the normalizations the writer is allowed to
    // make — LF endings and the explicit `minutes:` line.
    const lf = raw.replace(/\r\n/g, "\n");
    expect(rendered).toBe(lf.replace("level: a1\n---", "level: a1\nminutes: 3\n---"));
  });
});
