-- =============================================================================
-- shared_tags: explicit allow-list gating d11.me/:handle/share/:tag
-- A row must exist for a (user_id, tag) pair for the share page to resolve —
-- this is the only thing that makes a tag "shareable", independent of is_public.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shared_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tag         TEXT    NOT NULL,
  view_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  UNIQUE (user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_shared_tags_user_id ON shared_tags (user_id);
