-- lingoglass story content (Phase 1)
-- The /admin Pages Functions write here (D1). scripts/sync-content.mjs
-- (Phase 6) exports published rows back into content/<lang>/<level>/<slug>.md
-- so the static build's generateStaticParams/content pipeline stays untouched.
--
-- Ownership: source='import' rows came from the one-time content import,
-- source='admin' were created/edited through /admin. Either way D1 is
-- authoritative; their content/ files are regenerated from these tables.
-- Deletion is SOFT (deleted_at): the slug stays reserved by the UNIQUE
-- constraint (including deleted rows — a URL never gets recycled) and D1
-- Time Travel (7-day window on Free) can restore a row.
-- Note: sentences/words rely on ON DELETE CASCADE for hard cleanup.
-- Length CHECKs below are generous BACKSTOPS; the API validates tighter
-- (title 200, sentence 1000, surface 80, note 200) and rejects payloads
-- that would not round-trip the "* surface (note)" markdown format.

CREATE TABLE stories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lang         TEXT    NOT NULL CHECK (lang IN ('es', 'ru', 'ja')),
  level        TEXT    NOT NULL CHECK (
                 (lang IN ('es', 'ru') AND level IN ('a1', 'a2', 'b1', 'b2', 'c1', 'c2')) OR
                 (lang = 'ja'           AND level IN ('n5', 'n4', 'n3', 'n2', 'n1'))
               ),
  -- Filename stem including the NN- ordering prefix, e.g. "06-la-casa-nueva".
  -- The API enforces SAFE_SLUG (scripts/lib/story-format.mjs); this CHECK is
  -- only a length backstop.
  slug         TEXT    NOT NULL CHECK (length(slug) BETWEEN 1 AND 100),
  title        TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  title_en     TEXT    NOT NULL CHECK (length(title_en) BETWEEN 1 AND 300),
  minutes      INTEGER NOT NULL DEFAULT 3 CHECK (minutes BETWEEN 1 AND 120),
  -- draft = invisible to the sync; published = exported into content/ (Phase 6)
  status       TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  source       TEXT    NOT NULL DEFAULT 'admin' CHECK (source IN ('import', 'admin')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  published_at INTEGER,
  deleted_at   INTEGER,
  UNIQUE (lang, level, slug)  -- covers soft-deleted rows too: a slug stays taken
);
CREATE INDEX idx_stories_listing ON stories(lang, level, status, deleted_at);

CREATE TABLE sentences (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  target   TEXT    NOT NULL CHECK (length(target) BETWEEN 1 AND 2000),
  en       TEXT    NOT NULL CHECK (length(en) BETWEEN 1 AND 2000),
  UNIQUE (story_id, position)  -- its index also serves the story_id lookups
);

CREATE TABLE words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 0),
  surface     TEXT    NOT NULL CHECK (length(surface) BETWEEN 1 AND 200),
  note        TEXT    NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  UNIQUE (sentence_id, position)  -- its index also serves sentence_id lookups
);

CREATE TABLE story_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id     INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  -- Content-addressed R2 key: covers/<lang>/<level>/<slug>/<sha256>.<ext>
  r2_key       TEXT    NOT NULL UNIQUE,
  content_type TEXT    NOT NULL
                   CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  sha256       TEXT    NOT NULL CHECK (length(sha256) = 64),
  width        INTEGER,
  height       INTEGER,
  -- Exactly one cover per story, enforced by the partial unique index below
  -- (deliberately NOT a stories.cover_image_id FK — that would be circular
  -- with story_images.story_id).
  is_cover     INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  uploaded_at  INTEGER NOT NULL
);
CREATE INDEX idx_story_images_story ON story_images(story_id);
CREATE UNIQUE INDEX idx_story_images_one_cover
  ON story_images(story_id) WHERE is_cover = 1;

CREATE TABLE publish_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  requested_at INTEGER NOT NULL,
  -- 'ci'      = deploy hook / Cloudflare build (Phase 6)
  -- 'manual'  = operator ran `npm run publish` locally
  mode         TEXT    NOT NULL CHECK (mode IN ('ci', 'manual')),
  status       TEXT    NOT NULL CHECK (status IN ('requested', 'dispatched', 'failed')),
  detail       TEXT    CHECK (detail IS NULL OR length(detail) <= 4000)
);
CREATE INDEX idx_publish_requests_at ON publish_requests(requested_at);
