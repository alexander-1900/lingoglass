# Admin CMS — operator runbook

Day-to-day operations for `/admin`. Architecture reference: **README.md → Admin CMS**;
story file format: **STORY-FORMAT.md**. Nothing here needs a secret beyond the
dashboard variables listed in **Setup** below.

## The mental model

Three layers, one direction of travel:

```text
  /admin editor  ──Publish story──▶  D1 (status='published')
       │                                   │
       └──Publish site──▶ deploy hook      │  (prebuild, on the Cloudflare build machine)
                         → rebuild        ▼
                         → content/**  ← sync-content.mjs --build
                         → live site
```

- **Publish (a story)** = "this content is ready" — a one-column flag in D1. It
  changes nothing a reader can see.
- **Publish site** = the rebuild that turns D1 into `content/**` and ships it.
  Until it runs, a published story stays invisible.

That split is deliberate: you can stage ten stories, then ship them in one
reviewed build instead of ten rebuilds.

## Publishing

1. Edit in `/admin`; the editor's **Publish** button (or the row's Publish
   button in the list) flips the story to `published`. It is idempotent —
   double clicks are no-ops, not errors. If the story changed in another tab
   since you loaded it, the button reports the conflict instead of publishing
   stale content (same optimistic lock as Save).
2. Click **Publish site** in the header. The banner reports the hook's outcome;
   Cloudflare then rebuilds (`~30–60 s`).
3. A second click within 60 s is refused with the time remaining — that is the
   throttle, not a fault. The list view's history strip shows the last attempts
   (and, when the hook is not configured, says so).

Where it is implemented: `POST /api/admin/stories/:id/publish` and
`GET|POST /api/admin/publish`, journaled in `publish_requests` and `audit_log`
(`story.publish` / `site.publish`).

### When the button can't fire

| Symptom | Cause | What to do |
|---|---|---|
| Banner: "deploy hook not configured" | `DEPLOY_HOOK_URL` unset in Production scope | Add it, **or** run `npm run publish` locally (same pipeline) |
| `502 deploy_hook_failed` | hook returned non-2xx/redirect | Check the hook URL; the journal row carries the HTTP detail |
| `429 publish_throttled` | another publish < 60 s ago | Wait out the reported seconds |

`npm run publish` is the manual escape hatch: it runs the same
`sync-content --remote` export, journals the attempt (mode `manual`) and fires
the hook. Use it when the dashboard button can't reach the hook.

## The one-time import

The repo's `content/**` predates D1. Bootstrap once:

```powershell
npm run db:migrate              # if the schema is not applied yet
npm run content:import -- --remote --dry-run    # review: counts, paths, errors
npm run content:import -- --remote              # real import (existing rows are skipped)
npm run content:import -- --remote --covers     # + upload frontmatter image: photos to R2
```

`--update` re-imports into existing rows (destructive — content is replaced),
`--limit N` does a small slice first. After a successful import, **publish** the
stories you want visible, then **Publish site**.

## Setup (once per environment)

**Cloudflare dashboard → Pages project → Settings → Environment variables,
Production scope only** (previews and PR builds must never receive these):

| Variable | Used by | Purpose |
|---|---|---|
| `IP_HASH_SALT` | Functions | salt for privacy-preserving login IP hashes |
| `DEPLOY_HOOK_URL` | Functions | the "Publish site" button's build trigger |
| `CLOUDFLARE_API_TOKEN` | build machine | D1/R2 **read-only** scopes — `sync-content --build` pulls published stories |
| `CLOUDFLARE_ACCOUNT_ID` | build machine | account lookup when no `~/.wrangler` config exists |
| `SITE_URL` | build | canonical URL (sitemap/robots); the build fails without it in production |

The token only needs to **read** D1 and R2 — the build never writes to either.
Local development puts Functions secrets in a gitignored `.dev.vars`
(see `.dev.vars.example`).

### Git-connected project

`lingoglass` is a Git-connected Pages project, so publishing is the deploy hook,
not `npm run deploy`. If you ever need to recreate it:

1. Create a Pages project connected to this repo. Build command `npm run build`,
   output directory `out` — both already the repo's defaults.
2. Set the four variables above (Production scope).
3. Bindings must match `wrangler.jsonc`: D1 `lingoglass-db` as `DB`, R2
   `lingoglass-media` as `MEDIA`.
4. Verify with one "Publish site", then delete the old Direct-Upload project.

## Safety rails (what the export refuses to do)

`scripts/sync-content.mjs` never writes a file before it is sure:

- a failed D1 pull aborts the build instead of exporting a partial site;
- an empty published set alongside non-empty D1 rows refuses to touch
  `content/**` — otherwise "nothing published" would look like "delete
  everything";
- `lang`/`level`/`slug` segments that could escape the tree are rejected;
- drafts and soft-deleted rows are pruned, never exported;
- without `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (CI, local) it
  **skips cleanly** and the build uses the committed `content/**`.

## Audio after a publish

The export rewrites `content/**`, which invalidates
`public/audio/manifest.json` (`tests/story-audio-artifacts.test.ts` asserts the
manifest matches the story text, so a CI red build is the expected signal):

```powershell
npm run audio:reconcile            # orphaned / drifted / missing
npm run audio:reconcile -- --prune # drop orphaned entries
npm run audio:generate             # regenerate (needs Python + edge-tts + ffmpeg)
```

Readers are never broken by stale audio: entries whose text drifted simply stop
playing and the device voice takes over.

## Day-to-day checklist

```powershell
npm run dev:admin    # local admin against wrangler (needs a prior npm run build)
npm run db:migrate:local
npm run content:sync # pull D1 → content/** locally, read-only
npm test             # includes the Phase 6 round-trip tests
npm run lint; npm run typecheck; npm run typecheck:workers
```

`npm run admin:create -- --remote --update` rotates the account (and clears any
lockout). `functions/_middleware.ts` is the session gate — don't widen
`public/_routes.json`, or reader pages stop being zero-invocation static.
