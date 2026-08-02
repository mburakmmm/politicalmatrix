import { getDb } from "../db/client";
import {
  createId,
  getParty,
  getSimulation,
  insertEvent,
} from "../db/repository";
import { applyMetricImpact } from "./metrics";
import { getMetrics } from "../db/repository";
import { applyRegimeChange } from "./regime";
import type { MetricKey, RegimeType } from "../types";
import {
  CUSTOM_COOLDOWN_MONTHS,
  CUSTOM_MAX_PER_PARTY_PER_TERM,
  CUSTOM_REQUIRES_CATALOG_PROPOSALS,
  LAW_GROUP_LABELS,
  MAX_COMMITTEE_QUEUE,
  catalogStats,
  formatDeltas,
  getCustomTemplate,
  getLaw,
  lawFitsIdeology,
  resolveCatalogLawId,
  suggestLawsForSlug,
  type LawDef,
  type LawGroup,
} from "./laws/catalog";
import { suggestLawsForParty } from "./lawSuggestions";
import { logAlmanac } from "./almanac";

export interface LawGroupStateRow {
  simulation_id: string;
  group_key: string;
  law_id: string;
  title: string;
  tier: number;
  enacted_month: number;
}

export function getLawGroupStates(simulationId: string): LawGroupStateRow[] {
  return getDb()
    .prepare(`SELECT * FROM law_group_state WHERE simulation_id = ?`)
    .all(simulationId) as LawGroupStateRow[];
}

export function getCommitteeBills(simulationId: string): Array<{
  id: string;
  title: string;
  law_id: string | null;
  is_custom: number;
  debate_progress: number;
  debate_months_required: number;
  proposer_id: string;
  created_month: number;
}> {
  return getDb()
    .prepare(
      `SELECT id, title, law_id, is_custom, debate_progress, debate_months_required,
              proposer_id, created_month
       FROM bills WHERE simulation_id = ? AND status = 'in_committee'
       ORDER BY created_month ASC, rowid ASC`
    )
    .all(simulationId) as Array<{
    id: string;
    title: string;
    law_id: string | null;
    is_custom: number;
    debate_progress: number;
    debate_months_required: number;
    proposer_id: string;
    created_month: number;
  }>;
}

export function getEnactedLawId(
  simulationId: string,
  group: string
): string | null {
  const row = getDb()
    .prepare(
      `SELECT law_id FROM law_group_state WHERE simulation_id = ? AND group_key = ?`
    )
    .get(simulationId, group) as { law_id: string } | undefined;
  return row?.law_id ?? null;
}

export function enactLaw(
  simulationId: string,
  law: LawDef,
  month: number
): void {
  getDb()
    .prepare(
      `INSERT INTO law_group_state (simulation_id, group_key, law_id, title, tier, enacted_month)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(simulation_id, group_key) DO UPDATE SET
         law_id = excluded.law_id,
         title = excluded.title,
         tier = excluded.tier,
         enacted_month = excluded.enacted_month`
    )
    .run(simulationId, law.group, law.id, law.title, law.tier, month);
}

export function applyLawDeltas(
  simulationId: string,
  deltas: Partial<Record<MetricKey, number>>,
  reason: string
): void {
  let metrics = getMetrics(simulationId);
  for (const [key, value] of Object.entries(deltas)) {
    if (value === undefined || value === 0) continue;
    metrics = applyMetricImpact(
      simulationId,
      metrics,
      key as MetricKey,
      value,
      reason
    );
  }
}

function catalogProposalsThisTerm(
  simulationId: string,
  partyId: string,
  termStartMonth: number
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM bills
       WHERE simulation_id = ? AND proposer_id = ?
         AND IFNULL(is_custom, 0) = 0
         AND created_month >= ?`
    )
    .get(simulationId, partyId, termStartMonth) as { c: number };
  return row?.c ?? 0;
}

export function canUseCustomSlot(
  simulationId: string,
  partyId: string,
  month: number,
  term: number
): { ok: boolean; reason: string } {
  const sim = getSimulation(simulationId);
  const termStart = sim?.term_start_month ?? 1;

  const catalogCount = catalogProposalsThisTerm(
    simulationId,
    partyId,
    termStart
  );
  if (catalogCount < CUSTOM_REQUIRES_CATALOG_PROPOSALS) {
    return {
      ok: false,
      reason: `Özgür slot için önce bu dönemde en az ${CUSTOM_REQUIRES_CATALOG_PROPOSALS} katalog yasası (proposeLaw) teklif edin. Serbest slot’a kaymayı engellemek için.`,
    };
  }

  const rows = getDb()
    .prepare(
      `SELECT month, term FROM custom_bill_usage
       WHERE simulation_id = ? AND party_id = ? AND term = ?
       ORDER BY month DESC`
    )
    .all(simulationId, partyId, term) as Array<{ month: number; term: number }>;

  if (rows.length >= CUSTOM_MAX_PER_PARTY_PER_TERM) {
    return {
      ok: false,
      reason: `Özgür slot kotası doldu (dönemde en fazla ${CUSTOM_MAX_PER_PARTY_PER_TERM}). Katalogdan proposeLaw kullanın.`,
    };
  }

  const last = rows[0];
  if (last && month - last.month < CUSTOM_COOLDOWN_MONTHS) {
    return {
      ok: false,
      reason: `Özgür slot soğuma: ${CUSTOM_COOLDOWN_MONTHS - (month - last.month)} ay sonra tekrar. Önce katalog yasası (proposeLaw) deneyin.`,
    };
  }

  return { ok: true, reason: "OK" };
}

export function recordCustomUsage(
  simulationId: string,
  partyId: string,
  month: number,
  term: number,
  templateId: string,
  billId: string
): void {
  getDb()
    .prepare(
      `INSERT INTO custom_bill_usage (id, simulation_id, party_id, month, template_id, bill_id, term)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      createId("cbu"),
      simulationId,
      partyId,
      month,
      templateId,
      billId,
      term
    );
}

/** Genel kurulda yalnızca 1 voting yasası */
export function hasFloorBill(simulationId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM bills WHERE simulation_id = ? AND status = 'voting' LIMIT 1`
    )
    .get(simulationId);
  return !!row;
}

export function countCommittee(simulationId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM bills WHERE simulation_id = ? AND status = 'in_committee'`
    )
    .get(simulationId) as { c: number };
  return row?.c ?? 0;
}

export function resolveBillPlacement(
  simulationId: string,
  debateMonths: number
): "voting" | "in_committee" {
  // Hibrit: genel kurulda tek yasa; doluysa veya uzun tartışma → komisyon
  if (hasFloorBill(simulationId)) return "in_committee";
  if (debateMonths > 1) return "in_committee";
  return "voting";
}

export function canEnqueueBill(
  simulationId: string,
  debateMonths: number
): { ok: boolean; reason: string } {
  const placement = resolveBillPlacement(simulationId, debateMonths);
  if (placement === "voting") return { ok: true, reason: "OK" };
  if (countCommittee(simulationId) >= MAX_COMMITTEE_QUEUE) {
    return {
      ok: false,
      reason: `Komisyon kuyruğu dolu (max ${MAX_COMMITTEE_QUEUE}) ve genel kurul meşgul. Mevcut yasayı bekleyin.`,
    };
  }
  return { ok: true, reason: "OK" };
}

export function describeLawsForAgent(
  simulationId: string,
  partySlug: string
): string {
  const states = getLawGroupStates(simulationId);
  const stateLine =
    states.length === 0
      ? "Yürürlükte katalog yasası yok (başlangıç)."
      : states
          .slice(0, 14)
          .map(
            (s) =>
              `${LAW_GROUP_LABELS[s.group_key as LawGroup] || s.group_key}: ${s.title} (t${s.tier})`
          )
          .join(" | ");

  const suggestions = suggestLawsForParty(simulationId, partySlug, 8);
  const sugLine = suggestions
    .map(
      (l) =>
        `${l.id}="${l.title}" [${LAW_GROUP_LABELS[l.group]}] Δ${JSON.stringify(l.deltas)}`
    )
    .join("; ");

  const committee = getCommitteeBills(simulationId);
  const floor = hasFloorBill(simulationId);
  const queueLine = `Floor=${floor ? "dolu(1)" : "boş"} · Komisyon=${committee.length}/${MAX_COMMITTEE_QUEUE}${
    committee.length
      ? " [" +
        committee
          .slice(0, 4)
          .map((b) => b.title.slice(0, 28))
          .join("; ") +
        "]"
      : ""
  }`;

  const stats = catalogStats();
  return [
    `Kanun kataloğu: ${stats.total} madde / ${stats.groups} grup. ÖNCELİK: proposeLaw(lawId) — sert karşıt (bias≤-2) yasak; gri alan ve taktik teklif serbest.`,
    `Özgür slot (proposeCustomBill) NADİR — kota ${CUSTOM_MAX_PER_PARTY_PER_TERM}/dönem, soğuma ${CUSTOM_COOLDOWN_MONTHS} ay, önce katalog teklifi şart.`,
    `Yasama hattı: ${queueLine}`,
    `Yürürlük: ${stateLine}`,
    `Sana uygun öneriler (ters ideoloji YOK): ${sugLine || "-"}`,
  ].join("\n");
}

export function onCatalogLawPassed(
  simulationId: string,
  law: LawDef,
  proposerId: string,
  month: number
): void {
  enactLaw(simulationId, law, month);
  applyLawDeltas(simulationId, law.deltas, `Kanun: ${law.title}`);
  if (law.proposedRegime) {
    const sim = getSimulation(simulationId)!;
    applyRegimeChange(
      sim,
      law.proposedRegime,
      proposerId,
      `Katalog yasası kabul: ${law.title}`
    );
  }
  const { gains, losses } = formatDeltas(law.deltas);
  logAlmanac({
    simulationId,
    month,
    kind: "bill",
    title: `Yürürlükte: ${law.title}`,
    detail: `${LAW_GROUP_LABELS[law.group]} grubu t${law.tier}. Getiri: ${gains.join(", ") || "—"} / Götürü: ${losses.join(", ") || "—"}`,
    deltas: law.deltas as Record<string, number>,
    actorPartyId: proposerId,
  });
  insertEvent(
    simulationId,
    "law_enacted",
    {
      message: `Kanun yürürlükte: “${law.title}” (${LAW_GROUP_LABELS[law.group]})`,
      lawId: law.id,
      group: law.group,
      partyName: getParty(proposerId)?.name,
    },
    month
  );
}

export function onCustomLawPassed(
  simulationId: string,
  templateId: string,
  title: string,
  proposerId: string,
  month: number
): void {
  const tpl = getCustomTemplate(templateId);
  if (!tpl) return;
  applyLawDeltas(simulationId, tpl.deltas, `Özel yasa: ${title}`);
  if (tpl.proposedRegime) {
    const sim = getSimulation(simulationId)!;
    applyRegimeChange(
      sim,
      tpl.proposedRegime as RegimeType,
      proposerId,
      `Özel yasa: ${title}`
    );
  }
  logAlmanac({
    simulationId,
    month,
    kind: "bill",
    title: `Özel slot kabul: ${title}`,
    detail: `Şablon ${templateId}: ${tpl.summary}`,
    deltas: tpl.deltas as Record<string, number>,
    actorPartyId: proposerId,
  });
}

export { getLaw, getCustomTemplate, LAW_GROUP_LABELS, catalogStats, suggestLawsForSlug, lawFitsIdeology, resolveCatalogLawId };
