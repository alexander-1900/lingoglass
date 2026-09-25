# Implementation Plan — Google login + cross-device sync (SUPERSEDED)

> Removed on the `remove-auth` branch: Google sign-in, `/api/sync`, and the
> Turso/Drizzle database were stripped back out. The app is anonymous and
> local-only again (`localStorage`, no accounts). This document is kept as
> history only — see README.md for the current state.

## Overview

Add optional Google sign-in to lingoglass with cross-device sync of **bookmarks, reading progress, and resume-reading position**. The app today is fully static (SSG) with zero backend — all user data lives in `localStorage`. This plan adds a minimal server surface (Auth.js v5 + Drizzle ORM + Turso/libSQL) while keeping every page public: reading, SEO and the anonymous localStorage experience are unchanged. Login is an enhancement, not a gate.

**Hard constraints discovered in investigation (must be honored):**

- Target platforms are **Cloudflare or Netlify**. `app/api/tokenize-ja/route.ts` spawns Python via `child_process`, which **cannot run** on either platform. It is replaced by build-time precomputed token data (stories are static content).
- README/STORY-FORMAT.md currently advertise "no database, no API keys" — those claims must be updated.
- No auth/session/db code exists anywhere today (verified: no middleware, no cookies, no user model).
- Auth.js v5 (`next-auth` beta line) is the App Router-compatible line for Next 15. **Manual user steps required** (cannot be automated): create Google OAuth client in Google Cloud Console, create Turso DB (or use `file:` local SQLite for dev), set env vars.
- Graceful degradation: with no env vars the app builds and runs exactly as today — sign-in UI hidden, sync endpoints return "not configured".

**Sync model:** full-state, last-write-wins with tombstones. Data volume is tiny (bookmarks capped at 500 in `lib/bookmarks.ts`), so a single `POST /api/sync` carries the client's whole state and returns the authoritative merged state. Tombstones (`deletedAt`) make deletions propagate in both directions; offline edits merge on next login.

## Types

**`lib/sync-types.ts`** (new):

```ts
import type { Bookmark } from "./bookmarks";
/** Bookmark + tombstone for sync. Existing Bookmark shape is reused as-is. */
export interface SyncBookmark extends Bookmark {
  deletedAt?: number;
}
/** Per-story reading position. Key: `${lang}/${level}/${slug}` */
export interface ProgressRecord {
  lang: string;
  level: string;
  slug: string;
  lastIdx: number;    // sentence index to resume from
  maxIdx: number;     // furthest sentence reached (progress %)
  total: number;      // snapshot of sentences count
  completedAt?: number;
  updatedAt: number;  // epoch ms, LWW field
}
export interface SyncRequest  { bookmarks: SyncBookmark[]; progress: ProgressRecord[]; }
export interface SyncResponse { bookmarks: SyncBookmark[]; progress: ProgressRecord[]; }
```

**`db/schema.ts`** (new, Drizzle/libSQL). Auth.js standard tables (required by `@auth/drizzle-adapter`; sessions/verificationToken are unused at runtime with the JWT strategy but must exist for the adapter shape): `users` (id text pk, name, email unique, emailVerified timestamp, image), `accounts` (userId fk→users cascade, provider, providerAccountId, type, refresh_token, access_token, expires_at, token_type, scope, id_token, session_state; pk composite provider+providerAccountId), `sessions` (sessionToken pk, userId fk, expires), `verificationToken` (identifier, token, expires; pk composite). App tables:

- `bookmarks`: id text pk (reuses the client-generated id), userId fk→users cascade, lang, level, slug, sentIdx int, word, wordKey (lowercased dedupe key, indexed), note, englishMeaning, reading, romaji, context, contextEn (all text, nullable-safe), savedAt int (epoch ms), deletedAt int nullable, updatedAt int.
- `progress`: composite pk (userId, lang, level, slug); lastIdx, maxIdx, total int; completedAt int nullable; updatedAt int.

**`lib/bookmarks.ts`** (modify): `Bookmark` gains optional `deletedAt?: number`; exported API unchanged (`useBookmarks` filters tombstones, `addBookmark → AddResult`, `removeBookmark` now tombstones instead of hard delete). New exports: `getLocalBookmarks()` (raw, incl. tombstones), `adoptBookmarks(list)`.

**`lib/progress.ts`** (new): mirrors the bookmarks store pattern (`useSyncExternalStore`, localStorage key `lingoglass:progress` holding `Record<string, ProgressRecord>`). Exports `useProgress()`, `getProgress(key)`, `setProgress(rec)`, `getProgressRaw()`, `adoptProgress(map)`, `progressKey(lang, level, slug)`, pure `mergeProgress`.

## Files

**New**

| Path | Purpose |
|---|---|
| `implementation_plan.md` | This document |
| `auth.ts` | Auth.js v5 config: Google provider (only when `AUTH_GOOGLE_ID` set), DrizzleAdapter, `session: { strategy: "jwt" }`, `trustHost: true`, jwt/session callbacks attaching DB `user.id` |
| `app/api/auth/[...nextauth]/route.ts` | `export const { GET, POST } = handlers` |
| `app/api/auth-status/route.ts` | GET → `{ google: boolean, db: boolean }` for the client UI |
| `app/api/sync/route.ts` | POST full-state merge; `auth()` guard (401), 503 when DB unconfigured |
| `db/schema.ts` | Drizzle tables (above) |
| `db/index.ts` | Turso/libSQL client (URL from `TURSO_DATABASE_URL`; `file:lingoglass.db` fallback for dev), `db = null` when unconfigured |
| `drizzle.config.ts` | drizzle-kit push config |
| `lib/sync-types.ts` | Types above |
| `lib/sync.ts` | Client engine: `mergeBookmarks`, `mergeProgress` (pure), `syncNow()`, `scheduleSync()` (2s debounce), login merge |
| `lib/progress.ts` | Progress store (above) |
| `lib/use-auth-user.ts` | Client hook fetching `/api/auth/session` |
| `lib/ja-tokens.ts` | Build-time loader: `loadJaTokensForStory(lang, level, slug)` reading `data/ja-tokens.generated.json` via fs (SSG only) |
| `components/auth/AccountBadge.tsx` | Sidebar sign-in/out UI (Google button / avatar + sign out) |
| `scripts/precompute-ja.mjs` | prebuild step: parse `content/ja/**/*.md`, batch-tokenize via Python Sudachi, write `data/ja-tokens.generated.json`, content-hash skip |
| `data/ja-tokens.generated.json` | Generated, **committed** (so CI never needs Python) |
| `tests/sync.test.ts` | vitest tests for the pure merge functions |

**Modified**

- `package.json` — new deps; `prebuild` chain becomes `validate-content && precompute-ja`; `test` script.
- `.env.example` — `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (dev default `file:lingoglass.db` works with no account).
- `lib/bookmarks.ts` — tombstones + `scheduleSync()` after changes + `getLocalBookmarks`/`adoptBookmarks`.
- `components/shell/AppShell.tsx` — render `<AccountBadge />` in the sidebar footer area.
- `components/reader/ReaderView.tsx` — progress writes (playback advance, seek, stop, unmount, visibilitychange), resume affordance ("Resume from sentence N" button, never auto-jump), accept `jaTokens` prop.
- `components/reader/StoryText.tsx` — accept `jaTokens?: Record<number, Token[]>` prop, remove `loadJaTokens`/fetch/`inFlight`, keep `tokenWithRomaji` client-side.
- `app/story/[lang]/[level]/[slug]/page.tsx` — load precomputed tokens server-side, pass down.
- `services/sudachi/sudachi_tokenize.py` — accept batch input `{"texts": [...]}` (one spawn for all sentences) while keeping `{"text"}` compatible.
- `README.md`, `STORY-FORMAT.md` — claims + build-pipeline updates.
- `.gitignore` — add `*.db` (local dev SQLite file); ensure `data/` JSON is **not** ignored (it's committed).

**Deleted**

- `app/api/tokenize-ja/route.ts` (superseded by precompute; required for Cloudflare/Netlify).

## Functions

- `auth.ts`: `export const { handlers, auth, signIn, signOut } = NextAuth({...})` — jwt callback stores `token.userId` (DB lookup by email on first sign-in); session callback exposes `session.user.id`.
- `app/api/sync/route.ts`: `POST(req)` — `auth()` → 401; `db` null → 503; LWW-upsert incoming bookmarks/progress; return full authoritative state (incl. tombstones).
- `lib/sync.ts`:
  - `mergeBookmarks(local: SyncBookmark[], server: SyncBookmark[]): SyncBookmark[]` — union by `wordKey`; conflict → later `savedAt` wins; `deletedAt` removes live rows.
  - `mergeProgress(local: Record<string, ProgressRecord>, server: ProgressRecord[]): Record<string, ProgressRecord>` — LWW by `updatedAt`; `lastIdx` clamped to `[0, total-1]`.
  - `syncNow(): Promise<SyncResponse | null>` — no session → null; POST + adopt merged state.
  - `scheduleSync()` — debounced 2s; called by stores after local changes.
  - `mergeOnLogin()` — one-shot full merge when a session first appears.
- `lib/bookmarks.ts`: `addBookmark(b)` unchanged signature, internally also `scheduleSync()`; `removeBookmark(id)` → tombstone + `scheduleSync()`; new `getLocalBookmarks()`, `adoptBookmarks(list)`.
- `lib/progress.ts`: `setProgress(rec)` (upsert by key, emit, `scheduleSync()`); `useProgress()` hook; pure `mergeProgress`.
- `components/reader/ReaderView.tsx`: new `persistProgress(idx)` (throttled) called from `runFrom` loop / `seek` / `stop` / unmount / `visibilitychange`; `resumeIdx` state + render of the resume button; completedAt when `maxIdx >= total-1`.
- `components/reader/StoryText.tsx`: `Props.jaTokens` replaces fetch path; delete `loadJaTokens`, `inFlight`, the pre-warm effect block.
- `app/story/.../page.tsx`: `const jaTokens = story.lang === "ja" ? loadJaTokensForStory(story.lang, story.level, story.slug) : undefined;`
- `scripts/precompute-ja.mjs`: `main()` — walk/parse (mirrors `lib/stories.ts` rules: BOM strip, CRLF normalize, frontmatter, blank-line blocks, skip `*`/`>` lines), one Python spawn with `{"texts": [...]}`, hash-skip unchanged content, write JSON; loud warning + empty file when Python missing.

## Classes

None. The codebase is function- and component-based; no OO changes. (Drizzle tables are builder objects, not classes.)

## Dependencies

- `next-auth` (v5 beta line — verify the latest beta supports `next@15.1.6` + `react@19`; it is the App Router line).
- `@auth/drizzle-adapter`, `drizzle-orm`, `@libsql/client`; dev: `drizzle-kit`, `vitest`.
- No changes to existing deps. If npm reports peer conflicts against React 19, retry with `--legacy-peer-deps` (flagged honestly, not forced silently).
- External services (manual, one-time): Google Cloud Console OAuth client (redirect URIs `http://localhost:3000/api/auth/callback/google` + production URL), Turso DB (`turso db create` + token) — or nothing for dev (`file:` URL).

## Testing

- **New: vitest** for the pure merge logic — `tests/sync.test.ts` covering: dedupe union, LWW on equal keys, tombstone removal + resurrection when the server row is newer, progress LWW + clamp to `total-1`, tombstone pruning.
- Existing gates stay: `npm run typecheck`, `node scripts/validate-content.mjs`, `npm run build` (prebuild now also runs `precompute-ja`).
- Manual checklist (no env vars): build + typecheck + all pages behave as today; sign-in UI hidden.
- Manual checklist (with credentials): sign in → sidebar shows avatar; bookmark on device A appears on device B after login; delete propagates both ways; resume button appears with the correct sentence after progress sync; JA pages render tokens with readings **without** the deleted API route; offline bookmark → later login merge.

## Implementation Order

1. Save this plan; install deps (peer-dep check against React 19). ✅ DONE —
   `next-auth@5.0.0-beta.32`, `@auth/drizzle-adapter@1.11.3`,
   `drizzle-orm@0.45.2`, `@libsql/client@0.18.0`, dev `drizzle-kit@0.31.10`,
   `vitest@5.0.1` (installed clean, no peer conflicts).
2. `db/schema.ts`, `db/index.ts`, `drizzle.config.ts` (+ `file:lingoglass.db` local dev; `*.db` to `.gitignore`). ✅ DONE.
3. `auth.ts` + `app/api/auth/[...nextauth]/route.ts` + `app/api/auth-status/route.ts`. ✅ DONE.
4. `lib/sync-types.ts`, `lib/sync.ts` (pure merges), `tests/sync.test.ts`. ✅ DONE (7 tests passing).
5. `lib/bookmarks.ts` (tombstones + sync hooks) and `lib/progress.ts`. ✅ DONE.
6. `app/api/sync/route.ts`. ✅ DONE.
7. `lib/use-auth-user.ts`, `components/auth/AccountBadge.tsx`, AppShell integration. ✅ DONE.
8. Progress + resume in `ReaderView`. ✅ DONE.
9. JA precompute: `sudachi_tokenize.py` batch mode → `scripts/precompute-ja.mjs` → `lib/ja-tokens.ts` → story page + `StoryText` prop; **delete** `app/api/tokenize-ja/route.ts`. ✅ DONE (25 stories, 6544 Sudachi tokens, route deleted).
10. `.env.example`, README/STORY-FORMAT docs. ✅ DONE.
11. `drizzle-kit push` (local file DB), full validation: typecheck + vitest + validate-content + build. ✅ DONE —
    typecheck clean, vitest 7/7, validate-content OK (85/0), build exit 0 (115 pages).
12. Hand off the manual credential steps (Google Cloud Console, Turso) for production. ⏳ PENDING — see README "Optional: Google sign-in" section.


