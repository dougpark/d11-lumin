-- =============================================================================
-- user_settings: scoped JSON settings by app_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_id     TEXT    NOT NULL,
  settings   TEXT    NOT NULL DEFAULT '{}',
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (user_id, app_id)
) STRICT;

INSERT OR IGNORE INTO user_settings (user_id, app_id, settings)
  SELECT id, 'profile', '{}'
  FROM users;

INSERT OR IGNORE INTO user_settings (user_id, app_id, settings)
  SELECT id, 'system', '{}'
  FROM users;