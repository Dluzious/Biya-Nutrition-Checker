-- Obat harian (jam tetap tiap hari) dan obat berkala (mis. terapi tiap 3–4 minggu / bulanan).
CREATE TABLE medications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('harian', 'berkala')),
  times TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '',
  next_date TEXT,
  next_time TEXT,
  interval_days INTEGER,
  location TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE med_logs (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL,
  med_name TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('diminum', 'dilewati')),
  taken_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  logged_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX med_logs_date ON med_logs (scheduled_date);
CREATE INDEX med_logs_med ON med_logs (medication_id, scheduled_date);
