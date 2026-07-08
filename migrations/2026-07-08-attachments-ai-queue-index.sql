-- Improve AI queue scans for file enrichment.
CREATE INDEX IF NOT EXISTS idx_attachments_ai_processed_at ON attachments (ai_processed_at);
CREATE INDEX IF NOT EXISTS idx_attachments_queue_pending ON attachments (deleted_at, ai_processed_at, created_at ASC);
