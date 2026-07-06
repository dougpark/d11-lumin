-- Migration: Drive V1 tables + attachment ownership metadata
-- Safe for one-time execution on D1.

-- 1) Expand attachments metadata for shared Drive + Notes usage
ALTER TABLE attachments ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE attachments ADD COLUMN file_last_modified TEXT;
ALTER TABLE attachments ADD COLUMN file_category TEXT;
ALTER TABLE attachments ADD COLUMN file_etag TEXT;
ALTER TABLE attachments ADD COLUMN deleted_at TEXT;

-- 2) Backfill ownership from note attachment linkage
UPDATE attachments
SET owner_user_id = (
  SELECT n.user_id
  FROM attachment_list al
  JOIN notes n ON n.note_id = al.note_id
  WHERE al.attachment_id = attachments.attachment_id
  LIMIT 1
)
WHERE owner_user_id IS NULL;

-- 3) Create Drive domain tables
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

CREATE TABLE IF NOT EXISTS drive_list (
  drive_item_id   INTEGER NOT NULL REFERENCES drive_items (drive_item_id) ON DELETE CASCADE,
  attachment_id   INTEGER NOT NULL REFERENCES attachments (attachment_id) ON DELETE CASCADE,
  PRIMARY KEY (drive_item_id, attachment_id)
);

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_attachments_owner_user_id ON attachments (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments (deleted_at);
CREATE INDEX IF NOT EXISTS idx_drive_items_user_parent ON drive_items (user_id, parent_id, deleted_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_items_user_kind ON drive_items (user_id, kind, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_items_user_name ON drive_items (user_id, display_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_list_drive_item_id ON drive_list (drive_item_id);
CREATE INDEX IF NOT EXISTS idx_drive_list_attachment_id ON drive_list (attachment_id);

-- Optional checks:
-- SELECT COUNT(*) FROM attachments WHERE owner_user_id IS NULL;
