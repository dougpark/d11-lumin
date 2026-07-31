-- =============================================================================
-- invite_codes / invite_redemptions: invite-only registration
-- =============================================================================

CREATE TABLE IF NOT EXISTS invite_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  created_by  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  note        TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  use_count   INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_code       ON invite_codes (code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by        ON invite_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status_lookup     ON invite_codes (revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS invite_redemptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code_id   INTEGER NOT NULL REFERENCES invite_codes (id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_redemptions_invite_code_id ON invite_redemptions (invite_code_id);
CREATE INDEX IF NOT EXISTS idx_invite_redemptions_user_id        ON invite_redemptions (user_id);
