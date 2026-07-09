-- Dev utility: reset AI enrichment fields for all attachments.
-- Purpose: force attachments back into the AI daemon queue by clearing ai_processed_at.
-- Safe for local/dev use. Be careful running this against remote/prod.

UPDATE attachments
SET
  ai_tags = '[]',
  ai_summary = '',
  ai_processed_at = NULL;

-- Optional verification query:
-- SELECT
--   COUNT(*) AS total,
--   SUM(CASE WHEN ai_processed_at IS NULL THEN 1 ELSE 0 END) AS pending
-- FROM attachments;
