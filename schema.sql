-- =============================================================================
-- d11.me — D1 Schema
-- Snapshot of latest schema. Incremental updates should be applied via
-- Wrangler D1 migrations from the migrations/ directory.
-- =============================================================================

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- SHA-256 hex token used as the Bearer credential (store hashed, never plain)
  token_hash   TEXT    NOT NULL UNIQUE,
  slug_prefix  TEXT    NOT NULL UNIQUE,   -- e.g. "stephen" → d11.me/l/stephen/git
  full_name    TEXT,
  email        TEXT    UNIQUE,
  phone        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- AI enrichment privacy gate: 0 = public bookmarks only, 1 = all bookmarks
  ai_allow_private INTEGER NOT NULL DEFAULT 0 CHECK (ai_allow_private IN (0, 1)),

  -- Admin flag: 1 = admin, 0 = regular user
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_users_token_hash   ON users (token_hash);
CREATE INDEX IF NOT EXISTS idx_users_slug_prefix  ON users (slug_prefix);

-- ─── Bookmarks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Core link data
  url             TEXT    NOT NULL,
  slug            TEXT    NOT NULL,         -- user-chosen short-link name
  title           TEXT,                     -- fetched <title> or user-provided
  short_description TEXT,                   -- user note 
  full_text       TEXT,                     -- reserved: cleaned full page text
  favicon_url     TEXT,                     -- https://…/favicon.ico

  -- Visibility & state
  is_public       INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),

  -- Tags stored as a JSON array string, e.g. '["dev","tools","cloudflare"]'
  tag_list        TEXT    NOT NULL DEFAULT '[]',

  -- Analytics
  hit_count       INTEGER NOT NULL DEFAULT 0,
  last_accessed   TEXT,

  -- Expiration (optional TTL feature)
  expires_at      TEXT,

  -- Timestamps
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- AI enrichment (populated by external daemon via /api/ai/*)
  ai_tags         TEXT    DEFAULT NULL,   -- JSON array, additive — never overwrites tag_list
  ai_summary      TEXT    DEFAULT NULL,   -- AI-generated summary, separate from short_description
  ai_processed_at TEXT    DEFAULT NULL,   -- NULL = not yet processed by AI

  -- Full-text fetch (populated by external daemon via /api/ft/*)
  full_text_processed_at TEXT DEFAULT NULL,   -- NULL = not yet fetched
  full_text_status       TEXT DEFAULT NULL,   -- NULL | 'completed' | 'fetch_failed'

  -- Synthesis digest (populated by external daemon via /api/synthesis/*)
  ai_synthesis            TEXT DEFAULT NULL,  -- AI-generated deep synthesis from full_text
  ai_synthesis_processed_at TEXT DEFAULT NULL, -- NULL = not yet processed

  -- A slug must be unique per user (namespace approach)
  UNIQUE (user_id, slug)
);

-- Fast lookup for the redirect route GET /l/:prefix/:slug
CREATE INDEX IF NOT EXISTS idx_bookmarks_slug                  ON bookmarks (slug);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id               ON bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at            ON bookmarks (created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_is_public             ON bookmarks (is_public);
CREATE INDEX IF NOT EXISTS idx_bookmarks_ai_processed_at       ON bookmarks (ai_processed_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_full_text_status      ON bookmarks (full_text_status);
CREATE INDEX IF NOT EXISTS idx_bookmarks_ai_synthesis_at       ON bookmarks (ai_synthesis_processed_at);

-- ─── Click analytics (optional, for per-click referrer / heatmap data) ────────
CREATE TABLE IF NOT EXISTS click_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id  INTEGER NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
  clicked_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  referrer     TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_bookmark_id ON click_events (bookmark_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at  ON click_events (clicked_at);

-- ─── API Tokens (programmatic access / v1 API / MCP / RSS) ───────────────────
--
-- Each user can issue multiple named tokens — one per consumer ("python script",
-- "claude agent", "n8n workflow").  Only the SHA-256 hash is stored; the raw
-- token is shown exactly once at creation time and never again.
--
-- scopes: JSON array of capability strings, e.g. '["posts:read","tags:read"]'
--   Current defined scopes: posts:read, posts:write, tags:read, tags:write
--   Use '["*"]' to grant all permissions.
--
-- expires_at: optional hard expiry.  NULL means the token never expires.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,               -- human label, e.g. "my python script"
  token_hash   TEXT    NOT NULL UNIQUE,        -- SHA-256(raw_token) hex — never store raw
  scopes       TEXT    NOT NULL DEFAULT '["posts:read","tags:read"]',
  last_used_at TEXT,                           -- updated on each successful auth
  expires_at   TEXT,                           -- ISO 8601 UTC, NULL = never
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id    ON api_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens (token_hash);

-- ─── Chat Channels (V1) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  slug       TEXT    NOT NULL UNIQUE,
  type       TEXT    NOT NULL DEFAULT 'chat',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- run once
-- ALTER TABLE channels ADD COLUMN type TEXT NOT NULL DEFAULT 'chat';

CREATE INDEX IF NOT EXISTS idx_channels_slug ON channels (slug);

-- Seed default channels
INSERT OR IGNORE INTO channels (name, slug) VALUES ('General', 'general');
INSERT OR IGNORE INTO channels (name, slug) VALUES ('Links', 'links');
INSERT OR IGNORE INTO channels (name, slug) VALUES ('AI', 'ai');
INSERT OR IGNORE INTO channels (name, slug) VALUES ('Meta', 'meta');

-- ─── Private Note Channels (V1) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_channels (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_modified_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_note_channels_user_id ON note_channels (user_id, last_modified_at DESC);

-- ─── Private Notes (V1) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  note_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel_id        INTEGER NOT NULL REFERENCES note_channels (id) ON DELETE CASCADE,
  pinned            INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  type              TEXT    NOT NULL DEFAULT 'note' CHECK (type IN ('note', 'tidbit')),
  content           TEXT    NOT NULL,
  upvotes           INTEGER NOT NULL DEFAULT 0,
  downvotes         INTEGER NOT NULL DEFAULT 0,
  tag_list          TEXT    NOT NULL DEFAULT '[]',
  ai_tags           TEXT    NOT NULL DEFAULT '[]',
  ai_summary        TEXT    NOT NULL DEFAULT '',
  ai_processed_at   TEXT    DEFAULT NULL,
  is_hidden         INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_modified_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  is_public         INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  is_archived       INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  share_url         TEXT    NOT NULL DEFAULT '',
  share_expires_at  TEXT,
  attachment_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notes_user_channel_sort ON notes (user_id, channel_id, pinned DESC, last_modified_at DESC, note_id DESC);
CREATE INDEX IF NOT EXISTS idx_notes_user_archived     ON notes (user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_notes_user_modified     ON notes (user_id, last_modified_at DESC);

-- ─── Health Entries (V1) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weight         REAL,
  glucose_level  REAL,
  blood_pressure TEXT,
  heart_rate     INTEGER,
  note           TEXT,
  timestamp      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at     TEXT,

  CHECK (weight IS NULL OR (weight >= 0 AND weight <= 2000)),
  CHECK (glucose_level IS NULL OR (glucose_level >= 0 AND glucose_level <= 2000)),
  CHECK (heart_rate IS NULL OR (heart_rate >= 0 AND heart_rate <= 300))
);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_timestamp
  ON health_entries (user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_deleted
  ON health_entries (user_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_created
  ON health_entries (user_id, created_at DESC);

-- ─── Note Attachments (V1 schema only; feature later) ──────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  attachment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_slug  TEXT    NOT NULL UNIQUE,
  owner_user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  filename         TEXT    NOT NULL,
  content_type     TEXT    NOT NULL,
  size             INTEGER NOT NULL,
  url              TEXT    NOT NULL,
  file_last_modified TEXT  DEFAULT NULL,
  file_category    TEXT    DEFAULT NULL,
  file_etag        TEXT    DEFAULT NULL,
  deleted_at       TEXT    DEFAULT NULL,
  cache_version    INTEGER NOT NULL DEFAULT 1,
  tag_list         TEXT    NOT NULL DEFAULT '[]',
  summary          TEXT    NOT NULL DEFAULT '',
  ai_tags          TEXT    NOT NULL DEFAULT '[]',
  ai_summary       TEXT    NOT NULL DEFAULT '',
  ai_processed_at  TEXT    DEFAULT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_attachment_slug ON attachments (attachment_slug);
CREATE INDEX IF NOT EXISTS idx_attachments_owner_user_id ON attachments (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments (deleted_at);
CREATE INDEX IF NOT EXISTS idx_attachments_ai_processed_at ON attachments (ai_processed_at);
CREATE INDEX IF NOT EXISTS idx_attachments_queue_pending ON attachments (deleted_at, ai_processed_at, created_at ASC);

CREATE TABLE IF NOT EXISTS attachment_list (
  note_id        INTEGER NOT NULL REFERENCES notes (note_id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  attachment_id  INTEGER NOT NULL REFERENCES attachments (attachment_id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_list_note_id ON attachment_list (note_id, sort_order ASC);

-- ─── Drive Objects (V1) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drive_items (
  drive_item_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES drive_items (drive_item_id) ON DELETE CASCADE,
  kind            TEXT    NOT NULL CHECK (kind IN ('folder', 'file')),
  display_name    TEXT    NOT NULL,
  is_public       INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  deleted_at      TEXT    DEFAULT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drive_items_user_parent ON drive_items (user_id, parent_id, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_items_user_kind ON drive_items (user_id, kind, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_items_user_name ON drive_items (user_id, display_name);

CREATE TABLE IF NOT EXISTS drive_list (
  drive_item_id   INTEGER NOT NULL REFERENCES drive_items (drive_item_id) ON DELETE CASCADE,
  attachment_id   INTEGER NOT NULL REFERENCES attachments (attachment_id) ON DELETE CASCADE,
  PRIMARY KEY (drive_item_id, attachment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_list_drive_item_id ON drive_list (drive_item_id);
CREATE INDEX IF NOT EXISTS idx_drive_list_attachment_id ON drive_list (attachment_id);

-- ─── Chats (V1) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES chats (id) ON DELETE CASCADE,
  content     TEXT    NOT NULL,
  upvotes     INTEGER NOT NULL DEFAULT 0,
  downvotes   INTEGER NOT NULL DEFAULT 0,
  reported    INTEGER NOT NULL DEFAULT 0 CHECK (reported IN (0, 1)),
  is_hidden   INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- Replies are one level deep in V1
  CHECK (parent_id IS NULL OR parent_id != id)
);

CREATE INDEX IF NOT EXISTS idx_chats_channel_created ON chats (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_parent_id       ON chats (parent_id);
CREATE INDEX IF NOT EXISTS idx_chats_reported_hidden ON chats (reported, is_hidden);

-- Per-user vote state to keep vote operations idempotent.
CREATE TABLE IF NOT EXISTS chat_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vote       INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_votes_chat_id ON chat_votes (chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_votes_user_id ON chat_votes (user_id);

-- ─── AI Requests (track Ollama call usage and performance) ────────────────────
CREATE TABLE IF NOT EXISTS ai_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id          INTEGER NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  message_id          INTEGER NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ai_message_id       INTEGER REFERENCES chats (id) ON DELETE CASCADE,
  status              TEXT    NOT NULL CHECK (status IN ('pending', 'success', 'timeout', 'error')),
  response_time_ms    INTEGER,
  error_message       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_user_id     ON ai_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_message_id  ON ai_requests (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_requests_channel_id  ON ai_requests (channel_id);

-- ─── RSS Feeds (seed rows managed via SQL, admin UI in V2) ───────────────────
CREATE TABLE IF NOT EXISTS rss_feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_fetched_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─── RSS Items (auto-expire after 30 days, separate from user bookmarks) ─────
CREATE TABLE IF NOT EXISTS rss_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      INTEGER NOT NULL REFERENCES rss_feeds (id) ON DELETE CASCADE,

  -- Deduplication key — use RSS <guid> or fall back to URL
  guid         TEXT    NOT NULL UNIQUE,

  url          TEXT    NOT NULL,
  title        TEXT,
  summary      TEXT,                           -- <description> snippet, plain text

  -- Tags derived from RSS <category> fields + title keyword extraction
  tag_list     TEXT    NOT NULL DEFAULT '[]',

  published_at    TEXT,                         -- RSS <pubDate> normalised to ISO 8601 UTC
  expires_at      TEXT    NOT NULL,             -- created_at + 30 days, enforced at ingest
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- AI enrichment (populated by external daemon via /api/ai/*)
  ai_tags         TEXT    DEFAULT NULL,         -- JSON array, additive alongside tag_list
  ai_summary      TEXT    DEFAULT NULL,         -- clean AI-generated summary
  ai_processed_at TEXT    DEFAULT NULL          -- NULL = not yet processed by AI
);

CREATE INDEX IF NOT EXISTS idx_rss_items_guid            ON rss_items (guid);
CREATE INDEX IF NOT EXISTS idx_rss_items_expires_at      ON rss_items (expires_at);
CREATE INDEX IF NOT EXISTS idx_rss_items_feed_id         ON rss_items (feed_id);
CREATE INDEX IF NOT EXISTS idx_rss_items_tag_list        ON rss_items (tag_list);
CREATE INDEX IF NOT EXISTS idx_rss_items_ai_processed_at ON rss_items (ai_processed_at);

-- ─── RSS Items Full-Text Search (FTS5) ───────────────────────────────────────
-- Content table mirrors rss_items; rowid = rss_items.id.
-- Searches across title, summary, ai_summary, and tag_list.
CREATE VIRTUAL TABLE IF NOT EXISTS rss_items_fts USING fts5(
  title,
  summary,
  ai_summary,
  tag_list,
  content=rss_items,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS rss_items_fts_ai
  AFTER INSERT ON rss_items BEGIN
    INSERT INTO rss_items_fts(rowid, title, summary, ai_summary, tag_list)
    VALUES (new.id, new.title, new.summary, new.ai_summary, new.tag_list);
  END;

CREATE TRIGGER IF NOT EXISTS rss_items_fts_ad
  AFTER DELETE ON rss_items BEGIN
    INSERT INTO rss_items_fts(rss_items_fts, rowid, title, summary, ai_summary, tag_list)
    VALUES ('delete', old.id, old.title, old.summary, old.ai_summary, old.tag_list);
  END;

CREATE TRIGGER IF NOT EXISTS rss_items_fts_au
  AFTER UPDATE ON rss_items BEGIN
    INSERT INTO rss_items_fts(rss_items_fts, rowid, title, summary, ai_summary, tag_list)
    VALUES ('delete', old.id, old.title, old.summary, old.ai_summary, old.tag_list);
    INSERT INTO rss_items_fts(rowid, title, summary, ai_summary, tag_list)
    VALUES (new.id, new.title, new.summary, new.ai_summary, new.tag_list);
  END;

-- ─── Full-Text Search (FTS5) ──────────────────────────────────────────────────
-- Content table mirrors bookmarks; rowid = bookmarks.id.
-- Searches across title, short_description, ai_summary, tag_list, and url.
CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
  title,
  short_description,
  ai_summary,
  tag_list,
  url,
  content=bookmarks,
  content_rowid=id
);

-- Keep the FTS index in sync with the bookmarks table
CREATE TRIGGER IF NOT EXISTS bookmarks_fts_ai
  AFTER INSERT ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(rowid, title, short_description, ai_summary, tag_list, url)
    VALUES (new.id, new.title, new.short_description, new.ai_summary, new.tag_list, new.url);
  END;

CREATE TRIGGER IF NOT EXISTS bookmarks_fts_ad
  AFTER DELETE ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, short_description, ai_summary, tag_list, url)
    VALUES ('delete', old.id, old.title, old.short_description, old.ai_summary, old.tag_list, old.url);
  END;

CREATE TRIGGER IF NOT EXISTS bookmarks_fts_au
  AFTER UPDATE ON bookmarks BEGIN
    INSERT INTO bookmarks_fts(bookmarks_fts, rowid, title, short_description, ai_summary, tag_list, url)
    VALUES ('delete', old.id, old.title, old.short_description, old.ai_summary, old.tag_list, old.url);
    INSERT INTO bookmarks_fts(rowid, title, short_description, ai_summary, tag_list, url)
    VALUES (new.id, new.title, new.short_description, new.ai_summary, new.tag_list, new.url);
  END;

-- ─── Chat Full-Text Search (FTS5) ───────────────────────────────────────────
-- Content table mirrors chats; rowid = chats.id.
CREATE VIRTUAL TABLE IF NOT EXISTS chats_fts USING fts5(
  content,
  content=chats,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS chats_fts_ai
  AFTER INSERT ON chats BEGIN
    INSERT INTO chats_fts(rowid, content)
    VALUES (new.id, new.content);
  END;

CREATE TRIGGER IF NOT EXISTS chats_fts_ad
  AFTER DELETE ON chats BEGIN
    INSERT INTO chats_fts(chats_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
  END;

CREATE TRIGGER IF NOT EXISTS chats_fts_au
  AFTER UPDATE ON chats BEGIN
    INSERT INTO chats_fts(chats_fts, rowid, content)
    VALUES ('delete', old.id, old.content);
    INSERT INTO chats_fts(rowid, content)
    VALUES (new.id, new.content);
  END;

-- ─── Notes Full-Text Search (FTS5) ──────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content,
  tag_list,
  ai_tags,
  ai_summary,
  content=notes,
  content_rowid=note_id
);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai
  AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, content, tag_list, ai_tags, ai_summary)
    VALUES (new.note_id, new.content, new.tag_list, new.ai_tags, new.ai_summary);
  END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad
  AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, content, tag_list, ai_tags, ai_summary)
    VALUES ('delete', old.note_id, old.content, old.tag_list, old.ai_tags, old.ai_summary);
  END;

CREATE TRIGGER IF NOT EXISTS notes_fts_au
  AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, content, tag_list, ai_tags, ai_summary)
    VALUES ('delete', old.note_id, old.content, old.tag_list, old.ai_tags, old.ai_summary);
    INSERT INTO notes_fts(rowid, content, tag_list, ai_tags, ai_summary)
    VALUES (new.note_id, new.content, new.tag_list, new.ai_tags, new.ai_summary);
  END;
