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

/** İdeolojiye göre junior ortağa tercih sırası */
export function preferredMinistriesForSlug(slug: string): string[] {
  if (slug === "left") {
    return ["labor", "education", "media", "justice", "finance"];
  }
  if (slug === "right") {
    return ["interior", "defense", "religious", "finance", "justice"];
  }
  return ["finance", "justice", "media", "education", "interior"];
}

/**
 * Sandalyeye orantılı bakanlık kotası.
 * Lead kabinenin çoğunluğunu tutar (max floor(n/2)).
 * Junior ≥%25 blok → en az 3; ≥%35 → en az 4.
 */
export function partnerMinistryQuota(
  governmentSeats: number,
  partnerSeats: number,
  totalMinistries = MINISTRY_DEFS.length
): number {
  const bloc = Math.max(1, governmentSeats + partnerSeats);
  const share = partnerSeats / bloc;
  let raw = Math.ceil(share * totalMinistries);
  if (share >= 0.35) raw = Math.max(4, raw);
  else if (share >= 0.25) raw = Math.max(3, raw);
  const maxPartner = Math.floor(totalMinistries / 2);
  return Math.min(maxPartner, Math.max(2, raw));
}

/**
 * Koalisyon kabulünde: ortak sandalyeye orantılı bakanlık alır.
 * explicitKeys varsa önce onlar, kalan kota tercihlerden doldurulur.
 */
export function shareMinistriesForAlliance(
  simulationId: string,
  governmentPartyId: string,
  partnerPartyId: string,
  explicitKeys?: string[],
  minCount?: number
): string[] {
  const gov = getParty(governmentPartyId);
  const partner = getParty(partnerPartyId);
  if (!gov || !partner) return [];

  const quota =
    minCount ??
    partnerMinistryQuota(gov.seats, partner.seats, MINISTRY_DEFS.length);

  const assigned: string[] = [];
  const preferred = preferredMinistriesForSlug(partner.slug);
  const ordered = [
    ...(explicitKeys || []).filter(Boolean),
    ...preferred.filter((k) => !(explicitKeys || []).includes(k)),
    ...MINISTRY_DEFS.map((m) => m.key).filter(
      (k) => !(explicitKeys || []).includes(k) && !preferred.includes(k)
    ),
  ];

  for (const key of ordered) {
    if (assigned.length >= quota) break;
    if (assigned.includes(key)) continue;
    const r = assignMinistry(simulationId, key, partnerPartyId);
    if (r.ok) assigned.push(key);
  }

  // Kalanları iktidarda tut
  for (const m of getMinistries(simulationId)) {
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
