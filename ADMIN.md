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

> **Where we are today:** the pipeline is built and all 85 stories are already in
> D1 as `published`, but the `lingoglass` Pages project is still a **direct
> upload**, so the deploy hook does not exist yet and "Publish site" has nothing
> to fire. Deploys are still `npm run deploy`. Use **`npm run publish`** to
> export D1 → `content/**` and commit the result; **Setup → Git-connected
> project** below is the cutover that switches the button on.

## Publishing

1. Edit in `/admin`; the editor's **Publish** button (or the row's Publish
   button in the list) flips the story to `published`. It is idempotent —
   double clicks are no-ops, not errors. If the story changed in another tab
   since you loaded it, the button reports the conflict instead of publishing
   stale content (same optimistic lock as Save).
2. Click **Publish site** in the header. Once the project is Git-connected (see
   **Setup** below) the banner reports the hook's outcome and Cloudflare rebuilds
   (`~30–60 s`). Until then the button reports that no hook is configured —
   nothing breaks, it just has nowhere to send the build.
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

`npm run publish` is the workhorse until the cutover: it runs the same
`sync-content --remote` export into `content/**`, journals the attempt (mode
`manual`), and fires the hook if one is configured. With no hook it stops there
and asks you to commit the export — on a direct-upload project that commit is
what you then deploy with `npm run deploy`.

## The one-time import

The repo's `content/**` predates D1. Bootstrap once:

```powershell
npm run db:migrate              # if the schema is not applied yet
npm run content:import -- --remote --dry-run    # review: counts, paths, errors
npm run content:import -- --remote              # real import (existing rows are skipped)
npm run content:import -- --remote --covers     # + upload frontmatter image: photos to R2
```

`--update` re-imports into existing rows (destructive — content is replaced),
`--limit N` does a small slice first. **Already done:** the remote database holds
all 85 stories as `published`, so the site's content is live and a re-export is a
no-op. Re-run this only to seed a fresh database.

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

### Git-connected project (not yet done)

`lingoglass` is still a **direct-upload** project, so publishing is
`npm run deploy` and `npm run publish` ends by asking you to commit the export.
Turning the button into a real one-click rebuild means converting the project to
Git-connected — a deliberate cutover, because the name is taken by the live site:

1. Create a Pages project connected to this repo (the CLI can't: the repo link
   is a dashboard OAuth step). Build command `npm run build`, output directory
   `out` — both already the repo's defaults.
2. Set the four variables above (Production scope).
3. Bindings must match `wrangler.jsonc`: D1 `lingoglass-db` as `DB`, R2
   `lingoglass-media` as `MEDIA`.
4. Take a deploy hook (Settings → Builds & deployments → Deploy hooks) and put it
   in `DEPLOY_HOOK_URL`.
5. Verify with one "Publish site", confirm the rebuild's prebuild exported D1
   correctly, then point the custom domain at the new project and delete the old
   Direct-Upload project.

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
