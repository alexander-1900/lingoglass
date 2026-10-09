// Admin UI (Phase 4) — the pure client-side layers, run headless in Node:
// route parsing, filter⇄hash mapping, form-state⇄payload and the fetch layer
// (global fetch stubbed). The DOM views are exercised by the local E2E browser
// drive; everything here must also hold without a DOM.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createStory, getSession, listStories, setCsrfToken, updateStory } from "../public/admin/api.js";
import { hashQueryOf, routeOf } from "../public/admin/app.js";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  LANG_LABELS,
  LANGS,
  LEVELS,
  LIMITS,
  filtersFromHashQuery,
  filtersToHashQuery,
  formatEpoch,
  formToPayload,
  imageIssue,
  isSlugPlaceholder,
  issueMap,
  levelOptions,
  listApiQuery,
  quickIssues,
  storyToFormState,
  suggestedSlugPrefix,
} from "../public/admin/story-form.js";
import { isSafeSegment } from "../scripts/lib/story-format.mjs";

type Body = Record<string, unknown>;

/** A form state that quickIssues accepts cleanly. */
function goodState(): Body {
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
    slug: "06-la-casa-nueva",
    title: "La casa nueva",
    titleEn: "The new house",
    minutes: 4,
    sentences: [
      { target: "La casa es grande.", en: "The house is big.", words: [{ surface: "casa", note: "noun, fem.: house" }] },
    ],
  };
}

const issueFields = (state: Body): string[] => quickIssues(state).map((i: { field: string }) => i.field);

const issueFor = (state: Body, field: string): string | undefined =>
  quickIssues(state).find((i: { field: string }) => i.field === field)?.message;

describe("routeOf / hashQueryOf", () => {
  it("parses the list route with and without filters", () => {
    expect(routeOf("#/")).toEqual({ name: "list", id: null });
    expect(routeOf("")).toEqual({ name: "list", id: null });
    expect(routeOf("#/?lang=ja&deleted=1")).toEqual({ name: "list", id: null });
  });

  it("parses the new-story and editor routes", () => {
    expect(routeOf("#/new")).toEqual({ name: "new", id: null });
    expect(routeOf("#/story/12")).toEqual({ name: "story", id: 12 });
    expect(routeOf("#/story/12?foo=1")).toEqual({ name: "story", id: 12 });
  });

  it("rejects malformed story ids and unknown routes", () => {
    expect(routeOf("#/story/abc").name).toBe("notfound");
    expect(routeOf("#/story/0").name).toBe("notfound");
    expect(routeOf("#/story/-1").name).toBe("notfound");
    expect(routeOf("#/story/12x").name).toBe("notfound");
    expect(routeOf("#/admin").name).toBe("notfound");
  });

  it("hashQueryOf returns the query part of any hash", () => {
    expect(hashQueryOf("#/?lang=ja&offset=50")).toBe("?lang=ja&offset=50");
    expect(hashQueryOf("#/story/3")).toBe("");
    expect(hashQueryOf("#/")).toBe("");
    expect(hashQueryOf("")).toBe("");
  });
});

describe("filters ⇄ hash query", () => {
  it("round-trips a full filter set through the hash", () => {
    const filters = filtersFromHashQuery("?lang=ja&level=n5&status=draft&q=ねこ&deleted=1&offset=50");
    expect(filters).toEqual({ lang: "ja", level: "n5", status: "draft", q: "ねこ", deleted: true, offset: 50 });
    expect(filtersToHashQuery(filters)).toBe("?lang=ja&level=n5&status=draft&q=%E3%81%AD%E3%81%93&deleted=1&offset=50");
  });

  it("omits defaults so the plain list stays a bare hash", () => {
    expect(filtersToHashQuery(filtersFromHashQuery(""))).toBe("");
    expect(filtersToHashQuery(filtersFromHashQuery("?status=all&offset=0"))).toBe("");
  });

  it("falls back to defaults for a hand-edited or stale hash", () => {
    expect(filtersFromHashQuery("?lang=de&level=z9&status=weird&offset=-5")).toEqual({
      lang: "",
      level: "",
      status: "all",
      q: "",
      deleted: false,
      offset: 0,
    });
    expect(filtersFromHashQuery("?lang=ja&level=n5").level).toBe("n5");
    expect(filtersFromHashQuery("?lang=es&level=n5").level).toBe("");
  });

  it("truncates an over-long search to the API limit", () => {
    const q = filtersFromHashQuery(`?q=${"x".repeat(150)}`).q;
    expect(q).toHaveLength(LIMITS.query);
  });

  it("listApiQuery always sends status/limit/offset", () => {
    expect(listApiQuery({ lang: "", level: "", status: "all", q: "", deleted: false, offset: 0 })).toBe(
      "status=all&limit=50&offset=0"
    );
    expect(listApiQuery({ lang: "ja", level: "n5", status: "all", q: "neko", deleted: true, offset: 50 })).toBe(
      "lang=ja&level=n5&status=all&q=neko&deleted=1&limit=50&offset=50"
    );
  });

  it("levelOptions scopes levels to the language", () => {
    expect(levelOptions("ja")).toEqual(["n5", "n4", "n3", "n2", "n1"]);
    expect(levelOptions("es")).toContain("c2");
    expect(levelOptions("es")).not.toContain("n5");
    expect(levelOptions("")).toContain("n5");
  });
});


describe("api.js fetch layer", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  function stubFetch(handler: (url: string, init: RequestInit) => Response) {
    vi.stubGlobal("fetch", (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(handler(url, init ?? {}));
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
    setCsrfToken("");
  });

  it("attaches the CSRF header and a JSON body on mutations", async () => {
    stubFetch(() => new Response(JSON.stringify({ story: { id: 42 } }), { status: 201 }));
    setCsrfToken("tok-123");
    const payload = { slug: "06-x" };
    const result = await createStory(payload);
    expect(result.story.id).toBe(42);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-CSRF-Token"]).toBe("tok-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify(payload));
  });

  it("sends CSRF on PUT and no CSRF on GET", async () => {
    stubFetch(() => new Response(JSON.stringify({ story: { id: 7, updatedAt: 1234 } }), { status: 200 }));
    setCsrfToken("tok-put");
    await updateStory(7, { slug: "06-x", updatedAt: 1234 });
    expect(calls[0]?.init?.method).toBe("PUT");
    expect((calls[0]?.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-put");
    await listStories("lang=ja&status=all&limit=50&offset=0");
    expect(calls[1]?.url).toBe("/api/admin/stories?lang=ja&status=all&limit=50&offset=0");
    expect((calls[1]?.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  });

  it("maps the JSON error shape to ApiError with details", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            error: "Story validation failed",
            details: [{ field: "title", message: "must not be empty" }],
          }),
          { status: 400 }
        )
    );
    const rejection = createStory({});
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({
      status: 400,
      message: "Story validation failed",
      details: [{ field: "title", message: "must not be empty" }],
    });
  });

  it("passes the 409 conflict payload through untouched", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "conflict", details: { updatedAt: 999 } }), { status: 409 }));
    await expect(updateStory(7, {})).rejects.toMatchObject({ status: 409, details: { updatedAt: 999 } });
  });

  it("treats any 401 as a dead session", async () => {
    stubFetch(() => new Response("unauthorized", { status: 401 }));
    await expect(getSession()).rejects.toMatchObject({ status: 401 });
  });

  it("reports an unreachable API as status 0", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(getSession()).rejects.toMatchObject({ status: 0 });
  });

  it("falls back to a readable message on a non-JSON error body", async () => {
    stubFetch(() => new Response("<html>502</html>", { status: 502 }));
    await expect(listStories("")).rejects.toMatchObject({
      status: 502,
      message: "Request failed (HTTP 502).",
    });
  });
});

type Sentence = { target: string; en: string; words: Array<{ surface: string; note: string }> };

const sentencesOf = (state: Body): Sentence[] => state.sentences as Sentence[];

describe("form state ⇄ API payload", () => {
  it("deep-copies a story detail into a fresh editor state", () => {
    const detail = {
      id: 7,
      lang: "es",
      level: "a1",
      slug: "06-la-casa-nueva",
      title: "La casa",
      titleEn: "The house",
      minutes: 4,
      status: "draft",
      source: "admin",
      createdAt: 1000,
      updatedAt: 2000,
      publishedAt: null,
      deletedAt: null,
      sentenceCount: 1,
      coverImageId: null,
      sentences: [{ target: "Hola.", en: "Hi.", words: [{ surface: "hola", note: "hi" }] }],
    };
    const state = storyToFormState(detail);
    expect(state.id).toBe(7);
    expect(state.updatedAt).toBe(2000);
    sentencesOf(state)[0].target = "changed";
    expect(detail.sentences[0].target).toBe("Hola."); // must be a detached copy
    expect(formToPayload(state)).toEqual({
      lang: "es",
      level: "a1",
      slug: "06-la-casa-nueva",
      title: "La casa",
      titleEn: "The house",
      minutes: 4,
      sentences: [{ target: "changed", en: "Hi.", words: [{ surface: "hola", note: "hi" }] }],
    });
  });

  it("trims everything and drops untouched word rows", () => {
    const payload = formToPayload({
      ...goodState(),
      slug: "  06-la-casa-nueva  ",
      title: "  La casa  ",
      sentences: [
        { target: " Hola. ", en: " Hi. ", words: [{ surface: " ", note: "" }, { surface: "hola", note: " hi " }] },
      ],
    });
    expect(payload.slug).toBe("06-la-casa-nueva");
    expect(payload.title).toBe("La casa");
    expect(payload.sentences[0]).toEqual({ target: "Hola.", en: "Hi.", words: [{ surface: "hola", note: "hi" }] });
  });

  it("never sends updatedAt (the save handler adds it per request)", () => {
    expect(formToPayload(goodState())).not.toHaveProperty("updatedAt");
  });
});

describe("quickIssues — the server-message mirror", () => {
  it("accepts the sample story", () => {
    expect(quickIssues(goodState())).toEqual([]);
  });

  it("flags slug problems with the server's wording", () => {
    expect(issueFor({ ...goodState(), slug: "" }, "slug")).toBe("must not be empty");
    expect(issueFor({ ...goodState(), slug: "la-casa" }, "slug")).toBe(
      'must start with a 2-digit order prefix, e.g. "06-my-story" (keeps library order)'
    );
    expect(issueFor({ ...goodState(), slug: "06-La-Casa" }, "slug")).toContain("must be lowercase");
    expect(issueFor({ ...goodState(), slug: "06-a b" }, "slug")).toContain("letters, numbers");
    expect(issueFor({ ...goodState(), slug: "06-casa-" }, "slug")).toContain("hyphen or a dot");
    expect(issueFor({ ...goodState(), slug: "06-casa." }, "slug")).toContain("hyphen or a dot");
  });

  it("flags sentence and word problems at their exact field paths", () => {
    const state = goodState();
    sentencesOf(state)[0].target = "*reserved";
    expect(issueFields(state)).toContain("sentences[0].target");
    expect(issueFor(state, "sentences[0].target")).toContain('must not start with "*" or ">"');
  });

  it("flags empty translations and out-of-range minutes", () => {
    const state = goodState();
    sentencesOf(state)[0].en = "   ";
    state.minutes = 0;
    expect(issueFor(state, "sentences[0].en")).toBe("must not be empty");
    expect(issueFor(state, "minutes")).toBe("must be between 1 and 120");
    expect(issueFor({ ...goodState(), minutes: 1.5 }, "minutes")).toBe("must be an integer");
  });

  it("ignores empty word rows but validates started ones", () => {
    const clean = goodState();
    sentencesOf(clean)[0].words = [{ surface: "", note: "" }];
    expect(quickIssues(clean)).toEqual([]);

    const started = goodState();
    sentencesOf(started)[0].words = [
      { surface: " ", note: "" },
      { surface: "casa(", note: "x" },
    ];
    const issues = quickIssues(started);
    expect(issues.map((i: { field: string }) => i.field)).toEqual(["sentences[0].words[1].surface"]);
    expect(issues[0].message).toContain('must not contain "("');
  });

  it("requires at least one sentence", () => {
    expect(issueFor({ ...goodState(), sentences: [] }, "sentences")).toBe("at least one sentence is required");
  });
});

describe("issueMap", () => {
  it("joins several issues on one field and ignores malformed entries", () => {
    const map = issueMap([
      { field: "title", message: "a" },
      { field: "title", message: "b" },
      { field: "x", message: "y" },
      null,
      { field: "x" },
    ]);
    expect(map).toEqual({ title: "a · b", x: "y" });
  });
});

describe("slug mirror canary", () => {
  it("client-accepted slugs always pass the canonical charset", () => {
    const candidates = [
      "06-la-casa-nueva",
      "06-La-Casa",
      "06-a b",
      "06-x.",
      "06-x-",
      "06-café-índigo",
      "01-neko-to-inu",
      "06-a(b)",
      "06-a/b",
      "06-a..b",
      "06-a\\b",
      "06-привет",
    ];
    for (const slug of candidates) {
      if (issueFor({ ...goodState(), slug }, "slug")) continue;
      expect(isSafeSegment(slug), `client accepted a slug the server charset rejects: ${slug}`).toBe(true);
    }
  });

  it("client-accepted slugs always keep the NN- prefix the server demands", () => {
    for (const slug of ["06-x", "7-x", "006-x", "06-X", "0a-x"]) {
      const accepted = !issueFor({ ...goodState(), slug }, "slug");
      if (accepted) expect(slug).toMatch(/^\d{2}-/);
    }
  });
});

describe("mirrored constants", () => {
  it("LANGS / LEVELS / LANG_LABELS cover the API's value space", () => {
    expect(LANGS).toEqual(["es", "ru", "ja"]);
    expect(LEVELS.ja).toEqual(["n5", "n4", "n3", "n2", "n1"]);
    expect(LEVELS.es).toEqual(["a1", "a2", "b1", "b2", "c1", "c2"]);
    for (const lang of LANGS) expect(LANG_LABELS[lang as "es" | "ru" | "ja"]).toBeTruthy();
  });

  it("LIMITS match the values functions/_lib/stories.ts enforces", () => {
    expect(LIMITS).toMatchObject({ title: 200, sentence: 1000, surface: 80, note: 200, slugMax: 100, query: 100 });
  });
});

describe("small helpers", () => {
  it("formatEpoch renders local YYYY-MM-DD HH:MM and dashes for junk", () => {
    expect(formatEpoch(1735689600)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatEpoch(null)).toBe("—");
    expect(formatEpoch(undefined)).toBe("—");
    expect(formatEpoch(Number.NaN)).toBe("—");
  });

  it("suggestedSlugPrefix accepts only 2-digit strings", () => {
    expect(suggestedSlugPrefix("07")).toBe("07-");
    expect(suggestedSlugPrefix("7")).toBe("");
    expect(suggestedSlugPrefix("007")).toBe("");
    expect(suggestedSlugPrefix(undefined)).toBe("");
    expect(suggestedSlugPrefix("aa")).toBe("");
  });

  it("isSlugPlaceholder is exactly NN-", () => {
    expect(isSlugPlaceholder("07-")).toBe(true);
    expect(isSlugPlaceholder(" 07- ")).toBe(true);
    expect(isSlugPlaceholder("07-casa")).toBe(false);
    expect(isSlugPlaceholder("-")).toBe(false);
    expect(isSlugPlaceholder("")).toBe(false);
  });
});

describe("imageIssue (Phase 5 cover uploads)", () => {
  const file = (type: string, size: number) => ({ type, size });

  it("accepts the three mirrored types up to the 5 MB cap", () => {
    for (const type of IMAGE_TYPES) {
      expect(imageIssue(file(type, 1024))).toBeNull();
      expect(imageIssue(file(type, IMAGE_MAX_BYTES))).toBeNull();
    }
    expect(IMAGE_MAX_BYTES).toBe(5242880);
  });

  it("rejects other types with a readable reason", () => {
    expect(imageIssue(file("image/gif", 100))).toMatch(/JPEG, PNG or WebP/);
    expect(imageIssue(file("application/pdf", 100))).toMatch(/JPEG, PNG or WebP/);
    expect(imageIssue(file("", 100))).toMatch(/JPEG, PNG or WebP/);
  });

  it("rejects empty and oversized files", () => {
    expect(imageIssue(file("image/png", 0))).toBe("file is empty");
    expect(imageIssue(file("image/png", IMAGE_MAX_BYTES + 1))).toMatch(/at most 5 MB/);
    expect(imageIssue({ type: "image/png" })).toBe("file is empty"); // no size at all
  });
});
