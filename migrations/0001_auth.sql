-- lingoglass admin auth (Phase 1)
-- Apply with:  npm run db:migrate:local   /   npm run db:migrate
--
-- Conventions:
--   * timestamps are Unix epoch SECONDS (INTEGER) — never TEXT dates
--   * NO plaintext secrets: passwords are self-describing hash strings
--     (see scripts/lib/password.mjs, e.g. pbkdf2-sha256$100000$salt$key),
--     session cookie tokens are stored only as SHA-256 hashes
--   * raw IP addresses are never written — only salted hashes (ip_hash)
-- D1 enforces foreign keys (equivalent to PRAGMA foreign_keys = on).

CREATE TABLE admin_users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NOCASE: usernames compare case-insensitively (app lowercases input).
  username            TEXT    NOT NULL COLLATE NOCASE UNIQUE
                          CHECK (length(username) BETWEEN 1 AND 64),
  password_hash       TEXT    NOT NULL
                          CHECK (length(password_hash) BETWEEN 20 AND 512),
  password_changed_at INTEGER NOT NULL,
  last_login_at       INTEGER,
  -- A07 brute-force control: consecutive failures + lockout window (Phase 2).
  failed_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until        INTEGER,
  disabled            INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  -- SHA-256 (hex) of the raw cookie token; the token itself exists ONLY in
  -- the browser's HttpOnly cookie. 64 hex chars, checked by constraint.
  token_hash   TEXT    NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  -- Per-session HMAC key that CSRF tokens are signed with (Phases 2–3).
  csrf_secret  TEXT    NOT NULL,
  -- Soft-binding hints (hashed); logged on mismatch, never the only check.
  ua_hash      TEXT,
  ip_hash      TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,  -- absolute expiry; idle timeout checked in code
  revoked_at   INTEGER            -- logout / password change revokes in place
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL,  -- normalized lowercase, as submitted
  ip_hash      TEXT    NOT NULL,
  attempted_at INTEGER NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1))
);
-- Drives the per-username and per-IP sliding windows of the login rate
-- limiter (Phase 3), and gives the audit trail a durable failure record.
CREATE INDEX idx_login_attempts_user ON login_attempts(username, attempted_at);
CREATE INDEX idx_login_attempts_ip   ON login_attempts(ip_hash, attempted_at);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,  -- 'login.success' | 'login.fail' | 'logout' | 'story.update' | 'publish' | …
  entity_type TEXT,              -- 'story' | 'image' | 'session' | NULL
  entity_id   INTEGER,
  detail      TEXT,              -- small JSON blob; no secrets, no raw IPs
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_action  ON audit_log(action, created_at);
