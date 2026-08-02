import { getDb } from "../db/client";
import { getSimulation } from "../db/repository";
import {
  LAW_CATALOG,
  type LawDef,
  type LawGroup,
  biasKeyForSlug,
  suggestLawsForSlug,
} from "./laws/catalog";

/** Aynı lawId yeniden önerilmesin / geçmesin */
export const LAW_ID_COOLDOWN_MONTHS = 12;
/** Aynı grup peş peşe menüde baskın olmasın */
export const LAW_GROUP_COOLDOWN_MONTHS = 6;

function currentEnactedLawIds(simulationId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT law_id FROM law_group_state WHERE simulation_id = ?`
      )
      .all(simulationId) as Array<{ law_id: string }>
  ).map((r) => r.law_id);
}

function recentEnactedGroups(
  simulationId: string,
  sinceMonth: number
): LawGroup[] {
  return (
    getDb()
      .prepare(
        `SELECT group_key FROM law_group_state
         WHERE simulation_id = ? AND enacted_month >= ?`
      )
      .all(simulationId, sinceMonth) as Array<{ group_key: string }>
  ).map((r) => r.group_key as LawGroup);
}

/**
 * Yürürlükteki + meclisteki + son N ayda kabul/red edilen katalog id'leri.
 * (Grup state değişince eski tier'ın yeniden gelmesini engeller.)
 */
export function buildBlockedLawIds(
  simulationId: string,
  month?: number
): Set<string> {
  const simMonth =
    month ?? getSimulation(simulationId)?.month ?? 1;
  const blocked = new Set<string>();

  for (const id of currentEnactedLawIds(simulationId)) {
    if (id) blocked.add(id);
  }

  const rows = getDb()
    .prepare(
      `SELECT law_id, status, resolved_month FROM bills
       WHERE simulation_id = ? AND law_id IS NOT NULL AND law_id != ''`
    )
    .all(simulationId) as Array<{
    law_id: string;
    status: string;
    resolved_month: number | null;
  }>;

  for (const b of rows) {
    if (!b.law_id) continue;
    if (["voting", "in_committee", "proposed"].includes(b.status)) {
      blocked.add(b.law_id);
      continue;
    }
    if (
      (b.status === "passed" || b.status === "rejected") &&
      b.resolved_month != null &&
      b.resolved_month >= simMonth - LAW_ID_COOLDOWN_MONTHS
    ) {
      blocked.add(b.law_id);
    }
  }

  return blocked;
}

/** Son dönemde dokunulan gruplar — öneride ikincil öncelik */
export function recentlyActiveLawGroups(
  simulationId: string,
  month?: number
): Set<LawGroup> {
  const simMonth =
    month ?? getSimulation(simulationId)?.month ?? 1;
  const groups = new Set<LawGroup>();

  for (const g of recentEnactedGroups(
    simulationId,
    simMonth - LAW_GROUP_COOLDOWN_MONTHS
  )) {
    groups.add(g);
  }

  const rows = getDb()
    .prepare(
      `SELECT law_id, law_group, status, resolved_month, created_month FROM bills
       WHERE simulation_id = ? AND (
         status IN ('voting','in_committee','proposed')
         OR (
           status IN ('passed','rejected')
           AND resolved_month IS NOT NULL
           AND resolved_month >= ?
         )
       )`
    )
    .all(simulationId, simMonth - LAW_GROUP_COOLDOWN_MONTHS) as Array<{
    law_id: string | null;
    law_group: string | null;
    status: string;
    resolved_month: number | null;
    created_month: number;
  }>;

  for (const b of rows) {
    if (b.law_group) {
      groups.add(b.law_group as LawGroup);
      continue;
    }
    if (b.law_id) {
      const law = LAW_CATALOG.find((l) => l.id === b.law_id);
      if (law) groups.add(law.group);
    }
  }

  return groups;
}

/**
 * Path A menü / proposeLaw yedek: blocked id'ler dışarı,
 * soğuyan gruplar arkaya, menüde grup başına en fazla 1.
 */
export function suggestLawsForParty(
  simulationId: string,
  slug: string,
  limit = 5,
  month?: number
): LawDef[] {
  const blocked = buildBlockedLawIds(simulationId, month);
  const coolGroups = recentlyActiveLawGroups(simulationId, month);
  const key = biasKeyForSlug(slug);
  const minScore = -1;

  const pool = [...LAW_CATALOG]
    .filter((l) => !blocked.has(l.id) && l.bias[key] >= minScore)
    .sort((a, b) => {
      const aCool = coolGroups.has(a.group) ? 1 : 0;
      const bCool = coolGroups.has(b.group) ? 1 : 0;
      if (aCool !== bCool) return aCool - bCool;
      return b.bias[key] - a.bias[key] || a.tier - b.tier;
    });

  const picked: LawDef[] = [];
  const usedGroups = new Set<LawGroup>();

  // 1. tur: farklı gruplar (soğuk önce — zaten sıralı)
  for (const law of pool) {
    if (picked.length >= limit) break;
    if (usedGroups.has(law.group)) continue;
    picked.push(law);
    usedGroups.add(law.group);
  }

  // 2. tur: limit dolmadıysa aynı gruptan doldur
  if (picked.length < limit) {
    for (const law of pool) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.id === law.id)) continue;
      picked.push(law);
    }
  }

  // Hiç aday kalmadıysa (aşırı filtre) — sadece mevcut yürürlük id hariç klasik öneri
  if (!picked.length) {
    return suggestLawsForSlug(slug, limit, blocked);
  }

  return picked;
}
