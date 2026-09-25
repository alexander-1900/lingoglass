# lingoglass — Story Content Format & Workflow

**Purpose of this file:** everything needed to add story content safely — for contributors —
without touching code. **Do not modify any code to add stories. Code is already
finished and working. Stories are DATA, not code.**

---

## 1. Where stories live

```
content/
├─ ru/   →  a1/  a2/  b1/  b2/  c1/  c2/     (6 levels)
├─ es/   →  a1/  a2/  b1/  b2/  c1/  c2/     (6 levels)
└─ ja/   →  n5/  n4/  n3/  n2/  n1/          (5 levels)
```

- One story = one file: `content/<lang>/<level>/<NN>-<slug>.md`
- Naming convention used so far: `01-`, `02-`, … prefix (keeps list order), then latin transliteration of the title, e.g. `01-moy-rabochiy-den.md`
- Files must be **UTF-8, extension `.md`** (loader only reads `*.md`).
- Never create files inside `content/` with any other extension, and never put loose files directly in `content/ru/` etc. — always inside a level folder.

## 2. Current status (update this section when adding stories!)

| Language | A1 | A2 | B1 | B2 | C1 | C2 | N5 | N4 | N3 | N2 | N1 |
|----------|----|----|----|----|----|----|----|----|----|----|----|
| ru | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | — | — | — | — | — |
| es | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | — | — | — | — | — |
| ja | — | — | — | — | — | — | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 | ✅ 5 |

Remaining to add: **nothing — all 85 stories complete (ru 30 · es 30 · ja 25).**

## 3. Exact file format (the loader in `lib/stories.ts` parses this)

A story file has two parts: frontmatter, then sentence blocks.

### 3.1 Frontmatter (required, between two `---` lines)

```
---
title: Утро в Москве
title-en: Morning in Moscow
lang: ru
level: a1
---
```

- `title` — story title in the target language
- `title-en` — English title
- `lang` — one of: `ru`, `es`, `ja` (must match folder!)
- `level` — `a1`…`c2` for ru/es, `n5`…`n1` for ja (must match folder!)
- (`minutes:` optional — defaults to 3)
- (`image:` optional — cover photo shown on library cards. If omitted, the app
  auto-uses `public/images/stories/<slug>.jpg` (`.jpeg`/`.png`/`.webp` also
  work) when present, else a designed placeholder.
  See `public/images/stories/README.md`.)

⚠️ The folder and the frontmatter must agree. If they don't, the app will show the story
under the folder's language/level — keep them consistent anyway.

### 3.2 Sentence blocks (separated by BLANK LINES)

Each block = one sentence, in this exact order:

```
<target-language sentence>
* word1 (grammar/lemma note: translation)
* word2 (...)
> English translation of the sentence
```

Rules the parser follows:
- A line **not** starting with `*` or `>` is part of the target sentence (two lines without a blank between them get joined with a space — avoid that: one sentence per line).
- Lines starting with `* ` are **word glossary entries** — format strictly: `* surface (note)` — the text inside the parentheses is shown in the word popover. Multi-word phrases allowed: `* в конечном счёте (phrase: ultimately)`.
- The line starting with `> ` is the **English translation** (shown under the sentence when the parallel toggle is on).
- **Blank line between blocks is what separates sentences.** Never put two sentences in one block.
- No Markdown headings, no other Markdown syntax inside the body. The `*`/`>` lines must be at the start of the line.
- Japanese: same format; do not add furigana manually — romaji/reading comes from
  the precomputed build artifact (`scripts/precompute-ja.mjs` regenerates
  `data/ja-tokens.generated.json` from `services/sudachi/`; no runtime service).

### 3.3 Full minimal example

```markdown
---
title: Утро в Москве
title-en: Morning in Moscow
lang: ru
level: a1
---

Это утро. Анна открывает окно.
* это (это — particle: this is)
* утро (утро — noun, neut. nom.: morning)
* Анна (Анна — proper noun, fem. nom.: Anna)
* открывает (открывать — verb, 3rd sg. pres.: opens)
* окно (окно — noun, neut. acc.: window)
> It is morning. Anna opens the window.

На улице холодно, но солнце светит ярко.
* на улице (на улице — phrase: outside)
* холодно (холодно — adverb: cold)
* но (но — conjunction: but)
* солнце (солнце — noun, neut. nom.: sun)
* светит (светить — verb, 3rd sg. pres.: shines)
* ярко (ярко — adverb: brightly)
> It is cold outside, but the sun is shining brightly.
```

## 4. Adding a story — step by step

1. Create `content/<lang>/<level>/NN-slug.md` with UTF-8 encoding.
2. Fill frontmatter (§3.1) and blocks (§3.2).
3. Count check: every sentence block must have exactly one `>` line and (ideally) several `* ` lines.
4. Run `npm run build` — it must exit with code 0. The build log lists every generated
   story page (e.g. `/story/ru/a1/01-moy-rabochiy-den`). A story that doesn't appear there
   wasn't parsed — check format.
5. Update the status table in §2 of this file.

## 5. What NOT to do

- ❌ Do not edit `lib/stories.ts`, `lib/types.ts`, pages, or components to add stories — the parser is generic and already handles all levels/languages.
- ❌ Do not rename existing story files (URL slugs = filenames; renaming breaks built URLs).
- ❌ Do not use `> ` lines for anything except the English translation.
- ❌ Do not put more than one `> ` line per block (parser takes the first).
- ❌ Do not add files with a different structure "to be helpful" — if the sent text doesn't fit the format, convert it TO the format, never the reverse.
- ❌ Do not touch `.gitkeep` files, `services/sudachi/`, or app code during content sessions.

## 6. Quick commands

```bash
npm run dev     # develop at http://localhost:3000
npm run build   # verify: must end with the SSG route list, exit code 0
npm run start   # serve the production build on :3000
```

## 7. App snapshot (for context, do not rebuild)

- Next.js 15 App Router, Cream & Clay editorial theme in `app/globals.css` (system fonts only, no Tailwind, no webfonts).
- Routes: `/` (library, all stories) → `/library/[lang]` → `/library/[lang]/[level]` → `/story/[lang]/[level]/[slug]` (reader) + `/settings`. All SSG via `generateStaticParams()`. Every page renders inside `AppShell` (sidebar with vocabulary queue + Stories/Reels tabs).
- Reader: 3 layout modes (side-by-side / line-by-line / interactive tap-to-reveal, persisted per device), click a word → warm definition card above it (gloss, or sentence translation as fallback) with Speak + localStorage Bookmark, `▶` footer reads the whole story with Web Speech API (OS voice), timeline seeks by sentence.
- `app/api/sync` → full-state bookmark + progress merge (`POST /api/sync`,
  Auth.js session required; 401/503 guarded; anonymous reading unaffected).
- `scripts/validate-content.mjs` + `scripts/precompute-ja.mjs` run on `prebuild`:
  the first refuses the build on malformed stories, the second regenerates the
  committed `data/ja-tokens.generated.json` (skipped when content unchanged).
