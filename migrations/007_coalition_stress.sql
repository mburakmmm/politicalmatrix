-- Koalisyon gerilim sayacı: ortak ideolojik ret birikimi → uyarı → kopma
ALTER TABLE alliances ADD COLUMN stress REAL NOT NULL DEFAULT 0;
ALTER TABLE alliances ADD COLUMN consecutive_nos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alliances ADD COLUMN stress_updated_month INTEGER;
