-- Attitudes, almanac, clearer bill metadata

CREATE TABLE IF NOT EXISTS party_attitudes (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  from_party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  to_party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0,
  stance TEXT NOT NULL DEFAULT 'neutral',
  note TEXT NOT NULL DEFAULT '',
  updated_month INTEGER NOT NULL DEFAULT 1,
  UNIQUE(from_party_id, to_party_id)
);

CREATE TABLE IF NOT EXISTS almanac_entries (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  deltas_json TEXT NOT NULL DEFAULT '{}',
  actor_party_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attitudes_sim ON party_attitudes(simulation_id);
CREATE INDEX IF NOT EXISTS idx_almanac_sim_month ON almanac_entries(simulation_id, month DESC);
