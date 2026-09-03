-- Fixes the 4.74M row scan query
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_url ON bookmarks(user_id, url);

-- Fixes the 607k row scan query
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);