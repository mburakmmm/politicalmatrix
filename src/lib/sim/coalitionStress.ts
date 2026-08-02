import { getDb } from "../db/client";
import {
  getAcceptedAlliancePartners,
  getAlliances,
  getParties,
  getParty,
  getSimulation,
  insertEvent,
} from "../db/repository";
import { mutualShift } from "./attitudes";
import { logAlmanac } from "./almanac";
import { refreshGovernmentPhase } from "./coalitions";
import { reclaimPartnerMinistries } from "./ministries";
import type { AllianceRow } from "../types";

/** Ortak hükümet yasasına Ret → gerilim; eşikler uyarı / zorunlu kopma / otomatik kopma */
export const COALITION_STRESS = {
  no: 14,
  abstain: 5,
  yes: -8,
  streakBonus: 10,
  warn: 28,
  forceBreak: 52,
  autoRupture: 70,
} as const;

function clampStress(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function findAcceptedAlliance(
  simulationId: string,
  a: string,
  b: string
): AllianceRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM alliances
       WHERE simulation_id = ? AND status = 'accepted'
         AND ((from_party_id = ? AND to_party_id = ?)
           OR (from_party_id = ? AND to_party_id = ?))
       LIMIT 1`
    )
    .get(simulationId, a, b, b, a) as AllianceRow | undefined;
  return row ?? null;
}

export function getAllianceStress(allianceId: string): {
  stress: number;
  consecutive_nos: number;
} {
  const row = getDb()
    .prepare(
      `SELECT stress, consecutive_nos FROM alliances WHERE id = ?`
    )
    .get(allianceId) as
    | { stress: number; consecutive_nos: number }
    | undefined;
  return {
    stress: row?.stress ?? 0,
    consecutive_nos: row?.consecutive_nos ?? 0,
  };
}

/**
 * Hükümet teklifine koalisyon ortağının oyu → stres güncelle.
 * Eşik aşımında uyarı / otomatik kopma.
 */
export function applyCoalitionVoteStress(opts: {
  simulationId: string;
  voterPartyId: string;
  proposerPartyId: string;
  vote: "YES" | "NO" | "ABSTAIN";
  billTitle: string;
  month: number;
}): { stress: number; ruptured: boolean; warned: boolean } {
  const { simulationId, voterPartyId, proposerPartyId, vote, billTitle, month } =
    opts;

  if (voterPartyId === proposerPartyId) {
    return { stress: 0, ruptured: false, warned: false };
  }

  const alliance = findAcceptedAlliance(
    simulationId,
    voterPartyId,
    proposerPartyId
  );
  if (!alliance) return { stress: 0, ruptured: false, warned: false };

  // Yalnızca mühürlü iktidar bloğu: teklif sahibi hükümet lideri veya ortağı
  const parties = getParties(simulationId);
  const gov = parties.find((p) => p.is_government === 1);
  if (!gov) return { stress: 0, ruptured: false, warned: false };

  const partners = new Set(getAcceptedAlliancePartners(simulationId, gov.id));
  partners.add(gov.id);
  const govBill =
    proposerPartyId === gov.id || partners.has(proposerPartyId);
  const voterInBloc = partners.has(voterPartyId);
  if (!govBill || !voterInBloc) {
    return { stress: 0, ruptured: false, warned: false };
  }

  const prev = getAllianceStress(alliance.id);
  let consecutive = prev.consecutive_nos;
  let delta = 0;

  if (vote === "NO") {
    consecutive += 1;
    delta = COALITION_STRESS.no;
    if (consecutive >= 3) delta += COALITION_STRESS.streakBonus;
  } else if (vote === "ABSTAIN") {
    consecutive = 0;
    delta = COALITION_STRESS.abstain;
  } else {
    consecutive = 0;
    delta = COALITION_STRESS.yes;
  }

  const before = prev.stress;
  const stress = clampStress(before + delta);

  getDb()
    .prepare(
      `UPDATE alliances SET stress = ?, consecutive_nos = ?, stress_updated_month = ?
       WHERE id = ?`
    )
    .run(stress, consecutive, month, alliance.id);

  let warned = false;
  if (
    before < COALITION_STRESS.warn &&
    stress >= COALITION_STRESS.warn
  ) {
    warned = true;
    const voter = getParty(voterPartyId)!;
    const prop = getParty(proposerPartyId)!;
    insertEvent(
      simulationId,
      "coalition_strain",
      {
        message: `Koalisyon geriliyor: ${voter.name} ↔ ${prop.name} (stres ${stress.toFixed(0)}/100). “${billTitle}” oylaması uyumu bozdu.`,
        partyName: voter.name,
        partyColor: voter.color,
        stress,
        allianceId: alliance.id,
      },
      month
    );
    logAlmanac({
      simulationId,
      month,
      kind: "coalition",
      title: "Koalisyon gerilimi",
      detail: `${voter.name}–${prop.name} stres ${stress.toFixed(0)}. Üst üste ideolojik retler ittifakı zorluyor.`,
    });
  }

  if (stress >= COALITION_STRESS.autoRupture) {
    ruptureCoalitionAlliance({
      simulationId,
      allianceId: alliance.id,
      initiatorId: voterPartyId,
      otherId: proposerPartyId,
      month,
      reason: `Koalisyon koptu: “${billTitle}” sonrası gerilim ${stress.toFixed(0)}/100 — ideolojik uyumsuzluk sürdürülemez.`,
      automatic: true,
    });
    return { stress, ruptured: true, warned };
  }

  return { stress, ruptured: false, warned };
}

/** İttifakı boz + çoğunluk kaybında hükümet düşür */
export function ruptureCoalitionAlliance(opts: {
  simulationId: string;
  allianceId: string;
  initiatorId: string;
  otherId: string;
  month: number;
  reason: string;
  automatic: boolean;
}): void {
  const { simulationId, allianceId, initiatorId, otherId, month, reason } =
    opts;

  getDb()
    .prepare(`UPDATE alliances SET status = 'broken', stress = 0, consecutive_nos = 0 WHERE id = ?`)
    .run(allianceId);

  mutualShift(simulationId, initiatorId, otherId, -35, reason);

  const gov = getParties(simulationId).find((p) => p.is_government === 1);
  if (gov) {
    reclaimPartnerMinistries(simulationId, gov.id, initiatorId);
    reclaimPartnerMinistries(simulationId, gov.id, otherId);
  }

  const a = getParty(initiatorId);
  const b = getParty(otherId);
  insertEvent(
    simulationId,
    "alliance_broken",
    {
      message: reason,
      partyName: a?.name,
      partyColor: a?.color,
      automatic: opts.automatic,
      stressBreak: true,
    },
    month
  );
  logAlmanac({
    simulationId,
    month,
    kind: "coalition",
    title: opts.automatic ? "Koalisyon koptu" : "İttifak bozuldu",
    detail: `${a?.name || "?"} ↔ ${b?.name || "?"}: ${reason}`,
  });

  const sim = getSimulation(simulationId);
  if (sim) refreshGovernmentPhase(sim);
}

/** Ajan bağlamı: stres satırları */
export function describeCoalitionStressForAgent(
  simulationId: string,
  partyId: string
): string {
  const alliances = getAlliances(simulationId).filter(
    (a) =>
      a.status === "accepted" &&
      (a.from_party_id === partyId || a.to_party_id === partyId)
  );
  if (!alliances.length) return "";

  const parties = getParties(simulationId);
  const name = (id: string) => parties.find((p) => p.id === id)?.name || "?";

  return alliances
    .map((a) => {
      const other =
        a.from_party_id === partyId ? a.to_party_id : a.from_party_id;
      const stress = a.stress ?? 0;
      const nos = a.consecutive_nos ?? 0;
      let hint = "";
      if (stress >= COALITION_STRESS.forceBreak) {
        hint = " — KOPMA EŞİĞİ: breakAlliance veya bir ret daha otomatik kopuş";
      } else if (stress >= COALITION_STRESS.warn) {
        hint = " — gerilim yüksek; hükümet ılımlı yasa önermeli / ortak desteklemeli";
      }
      return `Koalisyon stresi ↔ ${name(other)}: ${stress.toFixed(0)}/100 (ardışık ret ${nos})${hint}`;
    })
    .join("\n");
}

/** Ortak için breakAlliance zorunluluğu? */
export function shouldForceBreakAlliance(
  simulationId: string,
  partyId: string
): { force: boolean; partnerId?: string; stress?: number; allianceId?: string } {
  const alliances = getAlliances(simulationId).filter(
    (a) =>
      a.status === "accepted" &&
      (a.from_party_id === partyId || a.to_party_id === partyId)
  );
  let worst: {
    force: true;
    partnerId: string;
    stress: number;
    allianceId: string;
  } | null = null;
  for (const a of alliances) {
    const stress = a.stress ?? 0;
    if (stress < COALITION_STRESS.forceBreak) continue;
    const partnerId =
      a.from_party_id === partyId ? a.to_party_id : a.from_party_id;
    if (!worst || stress > worst.stress) {
      worst = {
        force: true,
        partnerId,
        stress,
        allianceId: a.id,
      };
    }
  }
  return worst ?? { force: false };
}
