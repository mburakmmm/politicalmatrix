import { getDb } from "../db/client";
import {
  createId,
  getParties,
  updateParty,
  clampMetric,
} from "../db/repository";
import {
  CITIES,
  CITY_PROFILES,
  type RegionRow,
  type PartyRow,
} from "../types";

export function seedRegions(simulationId: string, parties: PartyRow[]): void {
  const insertRegion = getDb().prepare(
    `INSERT OR IGNORE INTO regions (
      id, simulation_id, city_id, name, population_weight, economy, unrest, religiosity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPoll = getDb().prepare(
    `INSERT OR IGNORE INTO regional_polls (
      id, simulation_id, region_id, party_id, support, month
    ) VALUES (?, ?, ?, ?, ?, 1)`
  );

  for (const city of CITIES) {
    const profile = CITY_PROFILES[city];
    const regionId = createId("reg");
    insertRegion.run(
      regionId,
      simulationId,
      city,
      city,
      profile.weight,
      profile.economy,
      15 + Math.random() * 20,
      profile.religiosity
    );

    // Distribute support by ideology affinity to religiosity/economy
    const raw = parties.map((p) => {
      let base = p.poll_share;
      if (p.slug === "left") base += (100 - profile.religiosity) * 0.12;
      if (p.slug === "right") base += profile.religiosity * 0.12;
      if (p.slug === "center") base += 4;
      return { id: p.id, v: Math.max(5, base + (Math.random() - 0.5) * 6) };
    });
    const sum = raw.reduce((s, x) => s + x.v, 0);
    for (const r of raw) {
      insertPoll.run(
        createId("rp"),
        simulationId,
        regionId,
        r.id,
        Number(((r.v / sum) * 100).toFixed(2))
      );
    }
  }
}

export function getRegions(simulationId: string): RegionRow[] {
  return getDb()
    .prepare("SELECT * FROM regions WHERE simulation_id = ? ORDER BY name")
    .all(simulationId) as RegionRow[];
}

export function getLatestRegionalSupports(
  simulationId: string,
  month: number
): Array<{
  region_id: string;
  party_id: string;
  support: number;
}> {
  // Prefer exact month, else latest <= month
  return getDb()
    .prepare(
      `SELECT rp.region_id, rp.party_id, rp.support
       FROM regional_polls rp
       INNER JOIN (
         SELECT region_id, party_id, MAX(month) AS m
         FROM regional_polls
         WHERE simulation_id = ? AND month <= ?
         GROUP BY region_id, party_id
       ) t ON t.region_id = rp.region_id AND t.party_id = rp.party_id AND t.m = rp.month
       WHERE rp.simulation_id = ?`
    )
    .all(simulationId, month, simulationId) as Array<{
    region_id: string;
    party_id: string;
    support: number;
  }>;
}

export function applyRallyToRegion(
  simulationId: string,
  cityName: string,
  partyId: string,
  toneBoost: number,
  month: number
): void {
  const region = getDb()
    .prepare(
      `SELECT * FROM regions WHERE simulation_id = ? AND lower(city_id) = lower(?)`
    )
    .get(simulationId, cityName) as RegionRow | undefined;
  if (!region) return;

  const parties = getParties(simulationId);
  const supports = getLatestRegionalSupports(simulationId, month).filter(
    (s) => s.region_id === region.id
  );

  const next = parties.map((p) => {
    const cur = supports.find((s) => s.party_id === p.id)?.support ?? p.poll_share;
    if (p.id === partyId) return { id: p.id, support: cur + toneBoost * 1.5 };
    return { id: p.id, support: Math.max(3, cur - (toneBoost * 1.5) / Math.max(1, parties.length - 1)) };
  });
  const sum = next.reduce((s, x) => s + x.support, 0);

  const insert = getDb().prepare(
    `INSERT INTO regional_polls (id, simulation_id, region_id, party_id, support, month)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(region_id, party_id, month) DO UPDATE SET support = excluded.support`
  );
  for (const n of next) {
    insert.run(
      createId("rp"),
      simulationId,
      region.id,
      n.id,
      Number(((n.support / sum) * 100).toFixed(2)),
      month
    );
  }

  getDb()
    .prepare(
      `UPDATE regions SET unrest = ? WHERE id = ?`
    )
    .run(clampMetric(region.unrest + (toneBoost > 2 ? 2 : -1)), region.id);
}

/** Aggregate regional polls into national poll_share */
export function recomputeNationalFromRegions(
  simulationId: string,
  month: number
): void {
  const regions = getRegions(simulationId);
  const parties = getParties(simulationId);
  const supports = getLatestRegionalSupports(simulationId, month);

  const totals: Record<string, number> = {};
  for (const p of parties) totals[p.id] = 0;

  for (const region of regions) {
    for (const p of parties) {
      const s =
        supports.find(
          (x) => x.region_id === region.id && x.party_id === p.id
        )?.support ?? p.poll_share;
      totals[p.id] += s * region.population_weight;
    }
  }

  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  for (const p of parties) {
    updateParty(p.id, {
      poll_share: Number(((totals[p.id] / sum) * 100).toFixed(2)),
    });
  }
}
