-- Hibrit kanun sistemi: grup durumu + özel slot takibi + bill metadata

CREATE TABLE IF NOT EXISTS law_group_state (
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  group_key TEXT NOT NULL,
  law_id TEXT NOT NULL,
  title TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  enacted_month INTEGER NOT NULL,
  PRIMARY KEY (simulation_id, group_key)
);

CREATE TABLE IF NOT EXISTS custom_bill_usage (
  id TEXT PRIMARY KEY,
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  bill_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_law_group_sim ON law_group_state(simulation_id);
CREATE INDEX IF NOT EXISTS idx_custom_usage_party ON custom_bill_usage(simulation_id, party_id, month);

-- bills genişletme (SQLite ALTER)
ALTER TABLE bills ADD COLUMN law_id TEXT;
ALTER TABLE bills ADD COLUMN law_group TEXT;
ALTER TABLE bills ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN template_id TEXT;
ALTER TABLE bills ADD COLUMN deltas_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bills ADD COLUMN gains_text TEXT NOT NULL DEFAULT '';
ALTER TABLE bills ADD COLUMN losses_text TEXT NOT NULL DEFAULT '';
