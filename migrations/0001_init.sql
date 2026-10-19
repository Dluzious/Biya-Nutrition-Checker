-- Skema awal Biya Nutrition Checker.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pasien', 'pendamping')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX members_name ON members (lower(name));

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL DEFAULT 'cair',
  serving_label TEXT NOT NULL DEFAULT '',
  serving_volume_ml REAL,
  serving_grams REAL,
  preparation TEXT NOT NULL DEFAULT '',
  nutrients TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE intakes (
  id TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('ml', 'porsi')),
  volume_ml REAL NOT NULL DEFAULT 0,
  nutrients TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  logged_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX intakes_day ON intakes (local_date, taken_at);

CREATE TABLE weights (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  kg REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  logged_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX weights_date ON weights (date);

CREATE TABLE symptoms (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  nausea INTEGER NOT NULL DEFAULT 0,
  vomiting INTEGER NOT NULL DEFAULT 0,
  bloating INTEGER NOT NULL DEFAULT 0,
  diarrhea INTEGER NOT NULL DEFAULT 0,
  pain INTEGER NOT NULL DEFAULT 0,
  red_flags TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  logged_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX symptoms_day ON symptoms (local_date, at);

CREATE TABLE labs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  "values" TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  logged_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE schedule (
  id TEXT PRIMARY KEY,
  time TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  product_id TEXT,
  planned_ml REAL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  due_at TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX reminders_due ON reminders (sent_at, due_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  prefs TEXT NOT NULL DEFAULT '{}',
  device TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sent_log (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('evaluasi', 'saran')),
  output TEXT NOT NULL,
  model TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX evaluations_created ON evaluations (created_at);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
