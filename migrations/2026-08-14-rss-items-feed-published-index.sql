-- Covering indexes so news feed queries (all + per-source) don't need an
-- in-memory sort (confirmed via EXPLAIN QUERY PLAN: "USE TEMP B-TREE FOR ORDER BY").
CREATE INDEX IF NOT EXISTS idx_rss_items_feed_published ON rss_items (feed_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_rss_items_published_at   ON rss_items (published_at DESC);
