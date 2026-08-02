-- PoliticalMatrix local schema v1

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  term INTEGER NOT NULL DEFAULT 28,
  month INTEGER NOT NULL DEFAULT 1,
  speed REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'idle',
  seed INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'governing',
  pending_crisis TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  ideology TEXT NOT NULL,
  seats INTEGER NOT NULL,
  poll_share REAL NOT NULL,
  model_id TEXT,
  system_prompt TEXT NOT NULL,
  is_government INTEGER NOT NULL DEFAULT 0,
  UNIQUE(simulation_id, slug)
);

CREATE TABLE IF NOT EXISTS metrics (
  simulation_id TEXT PRIMARY KEY REFERENCES simulations(id) ON DELETE CASCADE,
  economy REAL NOT NULL DEFAULT 50,
  freedom REAL NOT NULL DEFAULT 50,
  security REAL NOT NULL DEFAULT 50,
  fear REAL NOT NULL DEFAULT 30,
  inflation REAL NOT NULL DEFAULT 25,
  unemployment REAL NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  target_metric TEXT NOT NULL,
  impact_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  proposer_id TEXT NOT NULL REFERENCES parties(id),
  yes_votes INTEGER NOT NULL DEFAULT 0,
  no_votes INTEGER NOT NULL DEFAULT 0,
  abstain_votes INTEGER NOT NULL DEFAULT 0,
  created_month INTEGER NOT NULL,
  resolved_month INTEGER
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id),
  vote TEXT NOT NULL,
  speech_text TEXT NOT NULL DEFAULT '',
  UNIQUE(bill_id, party_id)
);

CREATE TABLE IF NOT EXISTS alliances (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  from_party_id TEXT NOT NULL REFERENCES parties(id),
  to_party_id TEXT NOT NULL REFERENCES parties(id),
  concessions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_month INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  month INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS poll_history (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  party_slug TEXT NOT NULL,
  poll_share REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_sim_created ON events(simulation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bills_sim_status ON bills(simulation_id, status);
CREATE INDEX IF NOT EXISTS idx_alliances_sim ON alliances(simulation_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_party ON agent_memory(party_id, created_at);
CREATE INDEX IF NOT EXISTS idx_poll_history_sim ON poll_history(simulation_id, month);
