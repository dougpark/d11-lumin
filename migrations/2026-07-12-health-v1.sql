-- Health tracking v1 table and query indexes.
CREATE TABLE IF NOT EXISTS health_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weight         REAL,
  glucose_level  REAL,
  blood_pressure TEXT,
  heart_rate     INTEGER,
  note           TEXT,
  timestamp      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at     TEXT,

  CHECK (weight IS NULL OR (weight >= 0 AND weight <= 2000)),
  CHECK (glucose_level IS NULL OR (glucose_level >= 0 AND glucose_level <= 2000)),
  CHECK (heart_rate IS NULL OR (heart_rate >= 0 AND heart_rate <= 300))
);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_timestamp
  ON health_entries (user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_deleted
  ON health_entries (user_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_health_entries_user_created
  ON health_entries (user_id, created_at DESC);
