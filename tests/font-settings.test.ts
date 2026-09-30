import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT,
  FONTS,
  ReadingFont,
  applyFont,
  getFont,
  setFont,
} from "../lib/settings";

// Same pattern as storage-quota.test.ts: settings only touch
// window.localStorage when it exists (memory pass-through otherwise).
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  },
};

const FONT_KEY = "lingoglass:font";

function ruleBlock(css: string, header: RegExp): string {
  const m = header.exec(css);
  expect(m, `missing rule matching ${header}`).not.toBeNull();
  const end = css.indexOf("}", m!.index);
  return css.slice(m!.index, end);
}

describe("reading font catalog", () => {
  it("lists exactly 7 unique fonts, the default among them", () => {
    expect(FONTS).toHaveLength(7);
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(7);
    expect(FONTS.some((f) => f.id === DEFAULT_FONT)).toBe(true);
    for (const f of FONTS) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.cssVar.startsWith("--font-")).toBe(true);
    }
  });

  it("falls back to the default when the stored value is missing or corrupt", () => {
    store.clear();
    expect(getFont()).toBe(DEFAULT_FONT);
    store.set(FONT_KEY, "papyrus");
    expect(getFont()).toBe(DEFAULT_FONT);
  });

  it("round-trips a valid choice and rejects unknown ids", () => {
    store.clear();
    setFont("caveat");
    expect(store.get(FONT_KEY)).toBe("caveat");
    expect(getFont()).toBe("caveat");

    setFont("comic-sans" as ReadingFont); // invalid — must be ignored
    expect(store.get(FONT_KEY)).toBe("caveat");
    expect(getFont()).toBe("caveat");
  });

  it("applyFont is a safe no-op without a document (SSR)", () => {
    expect(() => applyFont("lora")).not.toThrow();
  });
});

describe("font declarations stay in sync (layout.tsx · globals.css)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf-8");
  const layout = read("app/layout.tsx");
  const css = read("app/globals.css");

  it("layout.tsx declares a next/font variable for every font", () => {
    for (const f of FONTS) expect(layout).toContain(`"${f.cssVar}"`);
  });

  it("only the non-default faces opt out of preload (6 of 7)", () => {
    expect(layout.match(/preload: false/g)).toHaveLength(FONTS.length - 1);
  });

  it("pre-paint script validates the same key and id list, in FONTS order", () => {
    expect(layout).toContain("lingoglass:font");
    expect(layout).toContain(FONTS.map((f) => f.id).join("|"));
  });

  it("globals.css maps every data-font id onto --font-reading", () => {
    for (const f of FONTS) expect(css).toContain(`[data-font="${f.id}"]`);
  });

  it("both reading-line rules consume --font-reading", () => {
    expect(ruleBlock(css, /^\.target-line \{/m)).toContain("var(--font-reading)");
    expect(ruleBlock(css, /^\.translation-line \{/m)).toContain("var(--font-reading)");
  });

  it("headings keep the fixed Lobster Two stack — never the picked font", () => {
    const headings = ruleBlock(css, /^h1, h2, h3, h4 \{/m);
    expect(headings).toContain("--font-lobster-two");
    expect(headings).not.toContain("--font-reading");
  });

  it("RU/JA target-line overrides still win over the picked font", () => {
    expect(ruleBlock(css, /^\[data-lang="ja"\] \.target-line \{/m)).toContain("font-family");
    expect(ruleBlock(css, /^\[data-lang="ru"\] \.target-line \{/m)).toContain("font-family");
  });
});
