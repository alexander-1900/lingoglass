import { describe, expect, it } from "vitest";
import { parseStoryFile } from "../lib/stories";

describe("parseStoryFile", () => {
  it("parses CRLF + BOM frontmatter", () => {
    const raw = "﻿---\r\ntitle: T\r\ntitle-en: E\r\nlang: es\r\nlevel: a1\r\n---\r\n\r\nHola mundo.\r\n> Hello world.\r\n";
    const { meta, sentences } = parseStoryFile(raw);
    expect(meta.title).toBe("T");
    expect(sentences).toHaveLength(1);
    expect(sentences[0].target).toBe("Hola mundo.");
    expect(sentences[0].en).toBe("Hello world.");
  });

  it("falls back gracefully without frontmatter", () => {
    const { meta, sentences } = parseStoryFile("Solo una frase.\n> Just one sentence.\n");
    expect(meta.title).toBeUndefined();
    expect(sentences).toHaveLength(1);
    expect(sentences[0].target).toBe("Solo una frase.");
  });

  it("first translation wins and bare gloss lines keep surface", () => {
    const raw = [
      "---",
      "title: T",
      "title-en: E",
      "lang: es",
      "level: a1",
      "---",
      "",
      "Hola.",
      "* hola",
      "> Hello.",
      "> Second.",
      "",
    ].join("\n");
    const { sentences } = parseStoryFile(raw);
    expect(sentences[0].en).toBe("Hello.");
    expect(sentences[0].glossary).toEqual([{ surface: "hola", note: "" }]);
  });

  it("parses gloss notes and joins multi-line targets", () => {
    const raw = [
      "---",
      "title: T",
      "title-en: E",
      "lang: ru",
      "level: a1",
      "---",
      "",
      "Первая строка",
      "вторая строка.",
      "* первая (note one)",
      "> First.",
      "",
    ].join("\n");
    const { sentences } = parseStoryFile(raw);
    expect(sentences[0].target).toBe("Первая строка вторая строка.");
    expect(sentences[0].glossary).toEqual([{ surface: "первая", note: "note one" }]);
  });
});
