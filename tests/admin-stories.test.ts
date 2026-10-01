// Phase 3 stories API — pure validation + round-trip guarantee.
// The D1-backed routes are exercised by the local/staging E2E round trip;
// everything here must hold without any Workers/D1 runtime.

import { describe, expect, it } from "vitest";
import {
  LIMITS,
  parseStoryIdParam,
  parseStoryInput,
  verifyRoundTrip,
  type StoryInput,
} from "../functions/_lib/stories";
import { renderStoryMarkdown } from "../scripts/lib/story-format.mjs";

type Body = Record<string, unknown>;

function baseStory(overrides: Body = {}): Body {
  return {
    lang: "es",
    level: "a1",
    slug: "06-la-casa-nueva",
    title: "La casa nueva",
    titleEn: "The new house",
    minutes: 4,
    sentences: [
      {
        target: "La casa es grande.",
        en: "The house is big.",
        words: [{ surface: "casa", note: "noun, fem.: house" }],
      },
    ],
    ...overrides,
  };
}

function expectOk(body: Body): StoryInput {
  const res = parseStoryInput(body);
  if (!res.ok) throw new Error(`expected valid, got issues: ${JSON.stringify(res.issues)}`);
  return res.value;
}

function expectIssues(body: Body): string[] {
  const res = parseStoryInput(body);
  if (res.ok) throw new Error("expected invalid, got ok");
  return res.issues.map((i) => i.field);
}

describe("parseStoryInput", () => {
  it("accepts a valid story and defaults minutes to 3", () => {
    const v = expectOk(baseStory({ minutes: undefined }));
    expect(v.minutes).toBe(3);
    expect(v.lang).toBe("es");
    expect(v.level).toBe("a1");
    expect(v.sentences).toHaveLength(1);
  });

  it("trims user-visible strings", () => {
    const v = expectOk(
      baseStory({
        title: "  La casa nueva  ",
        sentences: [
          {
            target: "  La casa es grande.  ",
            en: "  The house is big.  ",
            words: [{ surface: " casa ", note: " noun, fem.: house " }],
          },
        ],
      })
    );
    expect(v.title).toBe("La casa nueva");
    expect(v.sentences[0].target).toBe("La casa es grande.");
    expect(v.sentences[0].words[0]).toEqual({ surface: "casa", note: "noun, fem.: house" });
  });

  it("accepts a Japanese story with no glossary words", () => {
    const v = expectOk(
      baseStory({
        lang: "ja",
        level: "n5",
        slug: "01-neko-to-inu",
        title: "猫と犬",
        titleEn: "A cat and a dog",
        sentences: [{ target: "猫と犬がいます。", en: "There is a cat and a dog.", words: [] }],
      })
    );
    expect(v.sentences[0].words).toEqual([]);
  });

  it("accepts realistic tricky content: phrases, parens in notes, mid-line markers", () => {
    const v = expectOk(
      baseStory({
        sentences: [
          {
            target: "El perro de Sofía corre por el parque.",
            en: "Sofia's dog runs through the park.",
            words: [
              { surface: "perro", note: "perro — noun, masc.: dog" },
              { surface: "por el parque", note: "phrase: through the park" },
              { surface: "corre", note: "correr (verb, inf.): to run" },
              { surface: "D.F.", note: "abbrev.: Mexico City" },
            ],
          },
          {
            target: "«¡Qué rápido!», exclama su dueño: 3 > 2 y 5 * 3 = 15.",
            en: "“How fast!”, her owner exclaims: 3 > 2 and 5 * 3 = 15.",
            words: [{ surface: "dueño", note: "noun, masc.: owner (formal)" }],
          },
        ],
      })
    );
    expect(v.sentences).toHaveLength(2);
    expect(v.sentences[1].target).toContain("3 > 2");
  });

  it("round-trip check is silent for valid stories", () => {
    const v = expectOk(baseStory());
    expect(verifyRoundTrip(v)).toEqual([]);
  });

  it("round-trip check catches violations that bypass individual rules", () => {
    const good = expectOk(baseStory());
    const brokenTarget = {
      ...good,
      sentences: [{ ...good.sentences[0], target: "> devious" }],
    };
    expect(verifyRoundTrip(brokenTarget).map((i) => i.field)).toContain("sentences[0].target");

    const brokenLines = {
      ...good,
      sentences: [{ ...good.sentences[0], target: "line one\nline two" }],
    };
    expect(verifyRoundTrip(brokenLines).map((i) => i.field)).toContain("sentences[0].target");

    const brokenWord = {
      ...good,
      sentences: [
        {
          ...good.sentences[0],
          words: [{ surface: "ho(la", note: "noun: tricky" }],
        },
      ],
    };
    expect(verifyRoundTrip(brokenWord).map((i) => i.field)).toContain("sentences[0].words[0]");
  });
});

describe("renderStoryMarkdown", () => {
  it("emits the canonical on-disk format (pins writer to reader)", () => {
    const md = renderStoryMarkdown(
      { title: "Título", titleEn: "Title", lang: "es", level: "a1", minutes: 3 },
      [
        { target: "Hola.", en: "Hello.", words: [{ surface: "hola", note: "interjection: hi" }] },
        { target: "Adiós.", en: "Bye.", words: [] },
      ]
    );
    expect(md).toBe(
      [
        "---",
        "title: Título",
        "title-en: Title",
        "lang: es",
        "level: a1",
        "minutes: 3",
        "---",
        "",
        "Hola.",
        "* hola (interjection: hi)",
        "> Hello.",
        "",
        "Adiós.",
        "> Bye.",
        "",
      ].join("\n")
    );
  });
});

describe("parseStoryIdParam", () => {
  it("accepts positive integers, rejects everything else", () => {
    expect(parseStoryIdParam("5")).toBe(5);
    expect(parseStoryIdParam(["7"])).toBe(7);
    expect(parseStoryIdParam("0")).toBeNull();
    expect(parseStoryIdParam("-1")).toBeNull();
    expect(parseStoryIdParam("1e3")).toBeNull();
    expect(parseStoryIdParam("1.5")).toBeNull();
    expect(parseStoryIdParam("abc")).toBeNull();
    expect(parseStoryIdParam(undefined)).toBeNull();
  });
});

describe("parseStoryInput rejections", () => {
  const cases: [string, Body, string][] = [
    ["an unknown lang", baseStory({ lang: "de" }), "lang"],
    ["a level that belongs to another language", baseStory({ level: "n5" }), "level"],
    ["an uppercase slug", baseStory({ slug: "06-La-Casa" }), "slug"],
    ["a slug without the NN- prefix", baseStory({ slug: "la-casa-nueva" }), "slug"],
    ["a slug with path traversal", baseStory({ slug: "06-a..b" }), "slug"],
    ["a slug with a space", baseStory({ slug: "06 la casa" }), "slug"],
    ["a slug ending in a hyphen", baseStory({ slug: "06-la-casa-" }), "slug"],
    ["an empty title", baseStory({ title: "   " }), "title"],
    ["an over-long title", baseStory({ title: "x".repeat(LIMITS.title + 1) }), "title"],
    ["a title with a newline", baseStory({ title: "two\nlines" }), "title"],
    ["a non-integer minutes value", baseStory({ minutes: 2.5 }), "minutes"],
    ["minutes below the range", baseStory({ minutes: 0 }), "minutes"],
    ["minutes above the range", baseStory({ minutes: LIMITS.minutesMax + 1 }), "minutes"],
    ["no sentences", baseStory({ sentences: [] }), "sentences"],
    [
      "more sentences than allowed",
      baseStory({
        sentences: Array.from({ length: LIMITS.sentences + 1 }, () => ({ target: "x.", en: "x." })),
      }),
      "sentences",
    ],
    ["an empty sentence", baseStory({ sentences: [{ target: "", en: "x." }] }), "sentences[0].target"],
    [
      "a sentence starting with the * marker",
      baseStory({ sentences: [{ target: "* hola", en: "x." }] }),
      "sentences[0].target",
    ],
    [
      "a sentence starting with the > marker",
      baseStory({ sentences: [{ target: "> hola", en: "x." }] }),
      "sentences[0].target",
    ],
    ["a sentence without an en translation", baseStory({ sentences: [{ target: "Hola." }] }), "sentences[0].en"],
    [
      'a word surface containing "("',
      baseStory({ sentences: [{ target: "Hola.", en: "Hi.", words: [{ surface: "ho(la", note: "x" }] }] }),
      "sentences[0].words[0].surface",
    ],
    [
      "an empty word note",
      baseStory({ sentences: [{ target: "Hola.", en: "Hi.", words: [{ surface: "hola", note: "  " }] }] }),
      "sentences[0].words[0].note",
    ],
    [
      "an over-long word note",
      baseStory({
        sentences: [{ target: "Hola.", en: "Hi.", words: [{ surface: "hola", note: "x".repeat(LIMITS.note + 1) }] }],
      }),
      "sentences[0].words[0].note",
    ],
    [
      "more words than allowed in one sentence",
      baseStory({
        sentences: [
          {
            target: "Hola.",
            en: "Hi.",
            words: Array.from({ length: LIMITS.wordsPerSentence + 1 }, (_, i) => ({ surface: `w${i}`, note: "n" })),
          },
        ],
      }),
      "sentences[0].words",
    ],
    [
      "more total words than allowed",
      baseStory({
        sentences: Array.from({ length: 41 }, (_, i) => ({
          target: `Sentence ${i}.`,
          en: `Sentence ${i}.`,
          words: Array.from({ length: 50 }, (_, j) => ({ surface: `w${i}-${j}`, note: "n" })),
        })),
      }),
      "sentences",
    ],
    ["a non-object body", "not an object" as unknown as Body, "body"],
  ];

  it.each(cases)("rejects %s", (_name, body, field) => {
    expect(expectIssues(body)).toContain(field);
  });
});
