-- PoliticalMatrix depth: regime freedom, ministries, regions, negotiations, ideology, latency, month diffs

CREATE TABLE IF NOT EXISTS regime_state (
  simulation_id TEXT PRIMARY KEY REFERENCES simulations(id) ON DELETE CASCADE,
  regime_type TEXT NOT NULL DEFAULT 'parliamentary_republic',
  regime_label TEXT NOT NULL DEFAULT 'Parlamenter Cumhuriyet',
  constitution_strength REAL NOT NULL DEFAULT 70,
  secularism REAL NOT NULL DEFAULT 55,
  civil_liberties REAL NOT NULL DEFAULT 55,
  press_freedom REAL NOT NULL DEFAULT 50,
  parliament_dissolved INTEGER NOT NULL DEFAULT 0,
  elections_suspended INTEGER NOT NULL DEFAULT 0,
  state_religion TEXT,
  ruling_doctrine TEXT,
  monarch_title TEXT,
  transformed_at_month INTEGER,
  transformation_notes TEXT
);

CREATE TABLE IF NOT EXISTS ministries (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  holder_party_id TEXT REFERENCES parties(id),
  influence REAL NOT NULL DEFAULT 50,
  UNIQUE(simulation_id, key)
);

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  city_id TEXT NOT NULL,
  name TEXT NOT NULL,
  population_weight REAL NOT NULL,
  economy REAL NOT NULL DEFAULT 50,
  unrest REAL NOT NULL DEFAULT 20,
  religiosity REAL NOT NULL DEFAULT 50,
  UNIQUE(simulation_id, city_id)
);

CREATE TABLE IF NOT EXISTS regional_polls (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  support REAL NOT NULL,
  month INTEGER NOT NULL,
  UNIQUE(region_id, party_id, month)
);

CREATE TABLE IF NOT EXISTS ideology_vectors (
  party_id TEXT PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  econ_left_right REAL NOT NULL DEFAULT 0,
  auth_liberty REAL NOT NULL DEFAULT 0,
  secular_religious REAL NOT NULL DEFAULT 0,
  nation_global REAL NOT NULL DEFAULT 0,
  radicalism REAL NOT NULL DEFAULT 10,
  media_power REAL NOT NULL DEFAULT 40
);

CREATE TABLE IF NOT EXISTS negotiations (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  from_party_id TEXT NOT NULL REFERENCES parties(id),
  to_party_id TEXT NOT NULL REFERENCES parties(id),
  round INTEGER NOT NULL DEFAULT 1,
  offer_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_month INTEGER NOT NULL,
  updated_month INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS confidence_motions (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  motion_type TEXT NOT NULL,
  initiator_id TEXT NOT NULL REFERENCES parties(id),
  target_party_id TEXT REFERENCES parties(id),
  status TEXT NOT NULL DEFAULT 'voting',
  yes_votes INTEGER NOT NULL DEFAULT 0,
  no_votes INTEGER NOT NULL DEFAULT 0,
  created_month INTEGER NOT NULL,
  resolved_month INTEGER
);

CREATE TABLE IF NOT EXISTS confidence_votes (
  id TEXT PRIMARY KEY,
  motion_id TEXT NOT NULL REFERENCES confidence_motions(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id),
  vote TEXT NOT NULL,
  speech_text TEXT NOT NULL DEFAULT '',
  UNIQUE(motion_id, party_id)
);

CREATE TABLE IF NOT EXISTS month_snapshots (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  diff_json TEXT,
  UNIQUE(simulation_id, month)
);

CREATE TABLE IF NOT EXISTS agent_latency (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  party_id TEXT,
  month INTEGER NOT NULL,
  model_id TEXT,
  duration_ms INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS party_summaries (
  party_id TEXT PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  updated_month INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pending_intents (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id),
  month INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  phase_bucket TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

-- Extend simulations
ALTER TABLE simulations ADD COLUMN tick_mode TEXT NOT NULL DEFAULT 'hybrid';
ALTER TABLE simulations ADD COLUMN observer_model_id TEXT;
ALTER TABLE simulations ADD COLUMN scenario_id TEXT;

-- Extend bills for delayed legislation
ALTER TABLE bills ADD COLUMN debate_months_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bills ADD COLUMN debate_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN is_regime_change INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN proposed_regime TEXT;

CREATE INDEX IF NOT EXISTS idx_regions_sim ON regions(simulation_id);
CREATE INDEX IF NOT EXISTS idx_regional_polls_month ON regional_polls(simulation_id, month);
CREATE INDEX IF NOT EXISTS idx_negotiations_sim ON negotiations(simulation_id, status);
CREATE INDEX IF NOT EXISTS idx_month_snapshots ON month_snapshots(simulation_id, month);
CREATE INDEX IF NOT EXISTS idx_agent_latency ON agent_latency(simulation_id, month);
CREATE INDEX IF NOT EXISTS idx_pending_intents ON pending_intents(simulation_id, month, resolved);
