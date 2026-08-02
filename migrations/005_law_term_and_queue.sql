-- Dönem bazlı özgür slot kota + simülasyon dönem başlangıcı + komisyon limiti için hazırlık

ALTER TABLE simulations ADD COLUMN term_start_month INTEGER NOT NULL DEFAULT 1;

ALTER TABLE custom_bill_usage ADD COLUMN term INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_custom_usage_term
  ON custom_bill_usage(simulation_id, party_id, term);
