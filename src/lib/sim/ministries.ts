import { getDb } from "../db/client";
import { createId, getParty } from "../db/repository";
import { MINISTRY_DEFS, type MinistryRow } from "../types";

export function seedMinistries(simulationId: string, govPartyId: string): void {
  const insert = getDb().prepare(
    `INSERT INTO ministries (id, simulation_id, key, title, holder_party_id, influence)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(simulation_id, key) DO UPDATE SET holder_party_id = excluded.holder_party_id`
  );
  for (const m of MINISTRY_DEFS) {
    insert.run(
      createId("min"),
      simulationId,
      m.key,
      m.title,
      govPartyId,
      50 + Math.random() * 10
    );
  }
}

/** Seçim öncesi: bakanlıklar boş (iktidar yok) */
export function seedMinistriesVacant(simulationId: string): void {
  const insert = getDb().prepare(
    `INSERT INTO ministries (id, simulation_id, key, title, holder_party_id, influence)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(simulation_id, key) DO UPDATE SET holder_party_id = NULL`
  );
  for (const m of MINISTRY_DEFS) {
    insert.run(createId("min"), simulationId, m.key, m.title, 45);
  }
}

export function getMinistries(simulationId: string): MinistryRow[] {
  return getDb()
    .prepare("SELECT * FROM ministries WHERE simulation_id = ? ORDER BY title")
    .all(simulationId) as MinistryRow[];
}

export function assignMinistry(
  simulationId: string,
  ministryKey: string,
  partyId: string
): { ok: boolean; message: string } {
  const party = getParty(partyId);
  if (!party || party.simulation_id !== simulationId) {
    return { ok: false, message: "Parti bulunamadı" };
  }
  const result = getDb()
    .prepare(
      `UPDATE ministries SET holder_party_id = ? WHERE simulation_id = ? AND key = ?`
    )
    .run(partyId, simulationId, ministryKey);
  if (result.changes === 0) {
    return { ok: false, message: `Bakanlık yok: ${ministryKey}` };
  }
  return {
    ok: true,
    message: `${ministryKey} → ${party.name}`,
  };
}

export function clearMinistries(simulationId: string): void {
  getDb()
    .prepare(
      `UPDATE ministries SET holder_party_id = NULL WHERE simulation_id = ?`
    )
    .run(simulationId);
}

export function ministriesHeldBy(
  simulationId: string,
  partyId: string
): string[] {
  return (
    getDb()
      .prepare(
        `SELECT key FROM ministries WHERE simulation_id = ? AND holder_party_id = ?`
      )
      .all(simulationId, partyId) as Array<{ key: string }>
  ).map((r) => r.key);
}

/** İdeolojiye göre junior ortağa bakanlık paketi */
export function preferredMinistriesForSlug(slug: string): string[] {
  if (slug === "left") return ["labor", "education", "media"];
  if (slug === "right") return ["interior", "defense", "religious"];
  return ["finance", "justice", "media"];
}

/**
 * Koalisyon/ittifak kabulünde: iktidar çoğu bakanlığı tutar,
 * ortak en az minCount bakanlık alır (tercih listesinden).
 */
export function shareMinistriesForAlliance(
  simulationId: string,
  governmentPartyId: string,
  partnerPartyId: string,
  explicitKeys?: string[],
  minCount = 2
): string[] {
  const gov = getParty(governmentPartyId);
  const partner = getParty(partnerPartyId);
  if (!gov || !partner) return [];

  const assigned: string[] = [];
  const keys =
    explicitKeys && explicitKeys.length
      ? explicitKeys
      : preferredMinistriesForSlug(partner.slug);

  for (const key of keys) {
    if (assigned.length >= Math.max(minCount, keys.length > 3 ? 3 : minCount)) {
      break;
    }
    const r = assignMinistry(simulationId, key, partnerPartyId);
    if (r.ok) assigned.push(key);
  }

  // Hâlâ azsa rastgele boşalt
  if (assigned.length < minCount) {
    const all = getMinistries(simulationId);
    for (const m of all) {
      if (assigned.length >= minCount) break;
      if (assigned.includes(m.key)) continue;
      if (m.holder_party_id === partnerPartyId) {
        assigned.push(m.key);
        continue;
      }
      const r = assignMinistry(simulationId, m.key, partnerPartyId);
      if (r.ok) assigned.push(m.key);
    }
  }

  // Kalanları iktidarda tut
  const all = getMinistries(simulationId);
  for (const m of all) {
    if (m.holder_party_id === partnerPartyId) continue;
    assignMinistry(simulationId, m.key, governmentPartyId);
  }

  return assigned;
}

/** İttifak bozulunca / hükümet düşünce: tüm bakanlıkları iktidara (veya boş) çek */
export function reclaimMinistriesToHolder(
  simulationId: string,
  holderPartyId: string | null
): void {
  const all = getMinistries(simulationId);
  for (const m of all) {
    if (holderPartyId) {
      assignMinistry(simulationId, m.key, holderPartyId);
    } else {
      getDb()
        .prepare(
          `UPDATE ministries SET holder_party_id = NULL WHERE simulation_id = ? AND key = ?`
        )
        .run(simulationId, m.key);
    }
  }
}

/** Partnerin elindeki bakanlıkları iktidara iade et */
export function reclaimPartnerMinistries(
  simulationId: string,
  governmentPartyId: string,
  partnerPartyId: string
): string[] {
  const taken: string[] = [];
  for (const m of getMinistries(simulationId)) {
    if (m.holder_party_id === partnerPartyId) {
      assignMinistry(simulationId, m.key, governmentPartyId);
      taken.push(m.key);
    }
  }
  return taken;
}

