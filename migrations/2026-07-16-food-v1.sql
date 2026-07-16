-- Food Tracker V1
CREATE TABLE IF NOT EXISTS food_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feel              TEXT,
  energy            TEXT,
  location          TEXT NOT NULL DEFAULT 'home',
  location_exif     TEXT,
  time_of_day       TEXT,
  ai_generated_tags TEXT,
  ai_summary        TEXT,
  note              TEXT,
  image_url         TEXT,
  timestamp         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at        TEXT,

  CHECK (feel IS NULL OR feel IN ('happy', 'sad')),
  CHECK (energy IS NULL OR energy IN ('energized', 'sluggish')),
  CHECK (location IN ('home', 'away')),
  CHECK (time_of_day IS NULL OR time_of_day IN ('breakfast', 'lunch', 'dinner', 'late-night'))
);

CREATE INDEX IF NOT EXISTS idx_food_entries_user_timestamp
  ON food_entries (user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_food_entries_user_deleted
  ON food_entries (user_id, deleted_at);
