-- Migration: attachment permalinks (private auth) + cache version
-- Safe for one-time execution on D1.
-- Slug format target: att_ + random hex

-- 1) Add columns (run once; if already exists, skip manually)
ALTER TABLE attachments ADD COLUMN attachment_slug TEXT;
ALTER TABLE attachments ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1;

-- 2) Backfill slugs for existing attachments
-- 16 random bytes => 32 hex chars, prefixed with att_
UPDATE attachments
SET attachment_slug = 'att_' || lower(hex(randomblob(16)))
WHERE attachment_slug IS NULL OR attachment_slug = '';

-- 3) Enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_attachment_slug
ON attachments (attachment_slug);

-- 4) Keep legacy inserts working temporarily (if app code not yet writing slug)
CREATE TRIGGER IF NOT EXISTS trg_attachments_fill_slug_after_insert
AFTER INSERT ON attachments
FOR EACH ROW
WHEN NEW.attachment_slug IS NULL OR NEW.attachment_slug = ''
BEGIN
  UPDATE attachments
  SET attachment_slug = 'att_' || lower(hex(randomblob(16)))
  WHERE attachment_id = NEW.attachment_id;
END;

-- Optional verification queries:
-- SELECT COUNT(*) AS missing FROM attachments WHERE attachment_slug IS NULL OR attachment_slug = '';
-- SELECT attachment_slug, COUNT(*) c FROM attachments GROUP BY attachment_slug HAVING c > 1;