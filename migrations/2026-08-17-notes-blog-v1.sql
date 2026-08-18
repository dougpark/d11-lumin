-- Notes → Blog: publishing metadata on notes, CDN copy tracking on attachments.
-- Blog is global (admin-only toggle), not per-user — see do_docs/notes-blog-plan.md.

ALTER TABLE notes ADD COLUMN title        TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN excerpt      TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN slug         TEXT;
ALTER TABLE notes ADD COLUMN is_blog      INTEGER NOT NULL DEFAULT 0 CHECK (is_blog IN (0, 1));
ALTER TABLE notes ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1));
ALTER TABLE notes ADD COLUMN published_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_slug ON notes (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_blog_feed ON notes (is_blog, is_published, published_at DESC);

-- Per-attachment CDN copy — attachment_list is many-to-many, so the copy is keyed
-- off the attachment row itself (one CDN object per attachment, scoped by note id in the key).
ALTER TABLE attachments ADD COLUMN cdn_key TEXT;
ALTER TABLE attachments ADD COLUMN cdn_url TEXT;
CREATE INDEX IF NOT EXISTS idx_attachments_cdn_key ON attachments (cdn_key);
