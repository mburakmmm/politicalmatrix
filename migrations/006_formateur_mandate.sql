-- Parlamenter formateur (hükümet kurma görevi) mandatı

ALTER TABLE simulations ADD COLUMN mandate_party_id TEXT;
ALTER TABLE simulations ADD COLUMN mandate_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE simulations ADD COLUMN mandate_started_month INTEGER;
ALTER TABLE simulations ADD COLUMN mandate_duration_months INTEGER NOT NULL DEFAULT 3;
