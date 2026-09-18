# lingoglass — a reading room of world stories

A calm, editorial reading app for graded language stories: Spanish, Russian (CEFR A1–C2)
and Japanese (JLPT N5–N1). Tap any word for its meaning, listen with native-device
voices, and keep a personal vocabulary queue — all in the browser.

![Library](public/images/stories/sample-cover.svg)

## Features

- **85 graded stories** — 30 Spanish · 30 Russian · 25 Japanese folk tales & essays
- **Tap-to-define words** — every word is clickable, with grammar notes and the sentence translation
- **Japanese tokenization** — native [Sudachi](https://github.com/WorksApplications/Sudachi) morphology
  (`services/sudachi/`), with romaji readings and an offline English gloss dictionary
- **Read aloud** — sentence-by-sentence playback via the Web Speech API (Woman / Man / Auto voices, 0.5×–1.5×)
- **Vocabulary queue** — bookmark words; they persist in `localStorage` on the device
- **3 reading layouts** — side-by-side, line-by-line, interactive tap-to-reveal (persisted per device)
- **Fully static** — all pages prerendered at build time, no database, no tracking
- **Warm editorial design** — Cream & Clay palette, system fonts only, no CSS frameworks

## Quick start

Requirements: Node.js 18+ · Python 3.10+ (only for Japanese tokenization)

```bash
npm install
pip install -r services/sudachi/requirements.txt  # Japanese tokenizer dict (~1 min, one-time)

npm run dev     # develop at http://localhost:3000
npm run build   # validate content + production build (exit 0 = healthy)
npm start       # serve the production build on :3000
```

If your Python interpreter isn't on `PATH` as `python`/`python3`, point to it (see `.env.example`):

```bash
PYTHON=C:\Python314\python.exe
```

Without Python/Sudachi the app still works — Japanese falls back to a built-in
regex splitter (no readings/lemmas).

## Project structure

```
app/                 Next.js 15 App Router (library, reader, settings, sitemap)
  api/tokenize-ja/   POST: Japanese tokenization (spawns services/sudachi/)
components/          reader (StoryText, WordPopover, AudioPlayer…), library, shell
lib/                 stories parser · bookmarks · tts · jmdict gloss · settings
content/             85 story Markdown files (es/ru/ja) — see STORY-FORMAT.md
services/sudachi/    standalone Sudachi tokenizer (no Docker)
scripts/             content validator (runs automatically on prebuild)
public/images/stories/  cover photos (optional; placeholders otherwise)
```

## Adding stories

Stories are data, not code — see **[STORY-FORMAT.md](STORY-FORMAT.md)** for the exact
Markdown format, then run `npm run build` to verify.

## Configuration

| Variable   | Default                 | Purpose                                    |
|------------|-------------------------|--------------------------------------------|
| `PYTHON`   | `python` → `python3`    | Python interpreter for the Sudachi script  |
| `SITE_URL` | `http://localhost:3000` | Canonical URL for `sitemap.xml`            |

No API keys, no external services, no database. Bookmarks and preferences live in
the browser's `localStorage` only.

## Scripts

| Command           | What it does                                      |
|-------------------|---------------------------------------------------|
| `npm run dev`     | Development server                                |
| `npm run build`   | Content validation + static production build     |
| `npm start`       | Serve the production build                        |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`)               |
