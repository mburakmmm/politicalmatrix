import { getDb } from "../db/client";
import {
  getAcceptedAlliancePartners,
  getParties,
  getParty,
  getSimulation,
  insertEvent,
  updateParty,
  updateSimulation,
} from "../db/repository";
import {
  reclaimMinistriesToHolder,
  seedMinistries,
  seedMinistriesVacant,
} from "./ministries";
import { logAlmanac } from "./almanac";
import { governmentSeatTotal, hasMajority } from "./parliament";
import { MAJORITY_THRESHOLD } from "../types";
import type { SimulationRow } from "../types";

/** Cumhurbaşkanının verdiği hükümet kurma süresi (ay) */
export const MANDATE_DURATION_MONTHS = 3;

export function clearMandate(simulationId: string): void {
  updateSimulation(simulationId, {
    mandate_party_id: null,
    mandate_rank: 0,
    mandate_started_month: null,
    mandate_duration_months: MANDATE_DURATION_MONTHS,
  });
}

function partiesBySeats(simulationId: string) {
  return [...getParties(simulationId)].sort(
    (a, b) => b.seats - a.seats || a.slug.localeCompare(b.slug)
  );
}

/** Formateur veya mühürlü iktidar lideri */
export function getCabinetLeadId(simulationId: string): string | null {
  const mandate = getMandatePartyId(simulationId);
  if (mandate) return mandate;
  const gov = getParties(simulationId).find((p) => p.is_government === 1);
  return gov?.id ?? null;
}

/** 301+ ve is_government ile mühürlü kabine */
export function isSealedGovernment(simulationId: string): boolean {
  if (needsCabinetFormation(simulationId)) return false;
  return !!getParties(simulationId).find((p) => p.is_government === 1);
}

/**
 * Çoğunluk sağlandığında kabineyi mühürle: is_government + bakanlık + governing.
 */
export function sealCabinet(
  simulationId: string,
  leadPartyId: string,
  opts?: { announce?: boolean; seats?: number; partners?: string[] }
): void {
  const parties = getParties(simulationId);
  const lead = parties.find((p) => p.id === leadPartyId);
  if (!lead) return;

  for (const p of parties) {
    updateParty(p.id, { is_government: p.id === leadPartyId ? 1 : 0 });
  }
  seedMinistries(simulationId, leadPartyId);
  clearMandate(simulationId);
  const month = getSimulation(simulationId)?.month ?? 1;
  updateSimulation(simulationId, {
    phase: "governing",
    gov_sealed_month: month,
  });

  if (opts?.announce !== false) {
    const seats =
      opts?.seats ??
      governmentSeatTotal(
        parties,
        opts?.partners ?? getAcceptedAlliancePartners(simulationId, leadPartyId),
        leadPartyId
      );
    insertEvent(
      simulationId,
      "government_formed",
      {
        message: `Hükümet mühürlendi: ${lead.name}. Koalisyon sandalyesi: ${seats}/600 (eşik 301).`,
        seats,
        partners: opts?.partners ?? getAcceptedAlliancePartners(simulationId, leadPartyId),
        partyName: lead.name,
        partyColor: lead.color,
        sealedMonth: month,
      },
      month
    );
  }
}

/** Seçim / hükümet düşmesi sonrası: 1. sıradaki partiye görev */
export function grantFormateurMandate(
  sim: SimulationRow,
  rank = 1
): { ok: boolean; partyId: string | null; message: string } {
  const ordered = partiesBySeats(sim.id);
  const idx = Math.max(0, rank - 1);
  const holder = ordered[idx];
  if (!holder) {
    clearMandate(sim.id);
    return { ok: false, partyId: null, message: "Görev verilecek parti yok" };
  }

  if (holder.seats >= MAJORITY_THRESHOLD) {
    for (const p of ordered) {
      updateParty(p.id, { is_government: p.id === holder.id ? 1 : 0 });
    }
    seedMinistries(sim.id, holder.id);
    clearMandate(sim.id);
    updateSimulation(sim.id, { phase: "governing" });
    return {
      ok: true,
      partyId: holder.id,
      message: `${holder.name} tek başına hükümet kurdu`,
    };
  }

  // Azınlık formateur: İKTİDAR DEĞİL — yalnızca görev + boş bakanlıklar
  for (const p of ordered) {
    updateParty(p.id, { is_government: 0 });
  }
  seedMinistriesVacant(sim.id);

  getDb()
    .prepare(
      `UPDATE negotiations SET status = 'failed'
       WHERE simulation_id = ? AND status = 'open'`
    )
    .run(sim.id);

  updateSimulation(sim.id, {
    phase: "coalition_talks",
    mandate_party_id: holder.id,
    mandate_rank: rank,
    mandate_started_month: sim.month,
    mandate_duration_months: MANDATE_DURATION_MONTHS,
  });

  const ordinal =
    rank === 1 ? "birinci" : rank === 2 ? "ikinci" : `${rank}.`;
  const msg = `Cumhurbaşkanı hükümet kurma görevini ${ordinal} olarak ${holder.name}'ne verdi (${holder.seats} sandalye, ${MANDATE_DURATION_MONTHS} ay süre). Kabine henüz mühürlenmedi — bakanlıklar boş; diğer partiler bu süre boyunca alternatif hükümet kuramaz.`;

  insertEvent(
    sim.id,
    "mandate_granted",
    {
      message: msg,
      partyId: holder.id,
      partyName: holder.name,
      partyColor: holder.color,
      rank,
      seats: holder.seats,
      durationMonths: MANDATE_DURATION_MONTHS,
    },
    sim.month
  );
  logAlmanac({
    simulationId: sim.id,
    month: sim.month,
    kind: "coalition",
    title: `Formateur: ${holder.name}`,
    detail: msg,
    actorPartyId: holder.id,
  });

  return { ok: true, partyId: holder.id, message: msg };
}

export function getMandatePartyId(simulationId: string): string | null {
  const sim = getSimulation(simulationId);
  return sim?.mandate_party_id ?? null;
}

/**
 * Kabine henüz 301 sandalyelik çoğunlukla mühürlenmedi.
 */
export function needsCabinetFormation(simulationId: string): boolean {
  const sim = getSimulation(simulationId);
  if (!sim) return false;
  if (sim.phase === "election") return false;
  if (sim.mandate_party_id) return true;
  if (sim.phase === "coalition_talks" || sim.phase === "negotiation") {
    return true;
  }
  const parties = getParties(simulationId);
  const gov = parties.find((p) => p.is_government === 1);
  if (!gov) return true;
  const partners = getAcceptedAlliancePartners(simulationId, gov.id);
  return !hasMajority(governmentSeatTotal(parties, partners, gov.id));
}

export function isFormateur(
  simulationId: string,
  partyId: string
): boolean {
  const mid = getMandatePartyId(simulationId);
  if (mid) return mid === partyId;
  return false;
}

/**
 * Koalisyon döneminde yalnızca formateur hükümet kurma müzakeresi/ittifakı başlatabilir.
 */
export function assertCanInitiateGovernmentTalks(
  simulationId: string,
  actorPartyId: string
): { ok: boolean; reason: string } {
  const sim = getSimulation(simulationId);
  if (!sim) return { ok: false, reason: "Simülasyon yok" };

  const mandateId = sim.mandate_party_id;
  if (mandateId && mandateId !== actorPartyId) {
    const holder = getParty(mandateId);
    const started = sim.mandate_started_month ?? sim.month;
    const dur = sim.mandate_duration_months ?? MANDATE_DURATION_MONTHS;
    const left = Math.max(0, started + dur - sim.month);
    return {
      ok: false,
      reason: `Cumhurbaşkanı hükümet kurma görevini ${holder?.name || "formateur"}'e verdi (${left} ay kaldı). Alternatif koalisyon ancak görev iade edilince denenebilir. Gelen müzakereye respondNegotiation ile yanıt verebilirsiniz.`,
    };
  }

  if (sim.phase === "election") {
    return { ok: false, reason: "Seçim kampanyasında hükümet müzakeresi yok." };
  }

  if (
    !needsCabinetFormation(simulationId) &&
    (sim.phase === "governing" || sim.phase === "crisis")
  ) {
    return { ok: true, reason: "OK" };
  }

  if (
    !needsCabinetFormation(simulationId) &&
    sim.phase !== "coalition_talks" &&
    sim.phase !== "negotiation"
  ) {
    return { ok: true, reason: "OK" };
  }

  if (!mandateId) {
    const gov = getParties(simulationId).find((p) => p.is_government);
    if (gov && gov.id !== actorPartyId) {
      return {
        ok: false,
        reason: `Hükümet kurma görevi ${gov.name}'nde. Siz yalnızca gelen teklife yanıt verebilirsiniz.`,
      };
    }
    return { ok: true, reason: "OK" };
  }

  return { ok: true, reason: "OK" };
}

export function canSealGovernmentCabinet(
  simulationId: string,
  partyA: string,
  partyB: string
): boolean {
  const sim = getSimulation(simulationId);
  if (!sim?.mandate_party_id) return true;
  return (
    sim.mandate_party_id === partyA || sim.mandate_party_id === partyB
  );
}

/**
 * Süre dolduysa görevi bir sonraki en büyük partiye devret.
 * Oylama/güvenoyu sırasında süre işlemez (pause).
 */
export function advanceFormateurMandateIfExpired(
  simulationId: string
): {
  advanced: boolean;
  exhausted: boolean;
  message: string;
} {
  const sim = getSimulation(simulationId);
  if (!sim) return { advanced: false, exhausted: false, message: "" };

  if (!sim.mandate_party_id || sim.mandate_started_month == null) {
    return { advanced: false, exhausted: false, message: "" };
  }

  // Oylama/güvenoyu formateur süresini yakmasın
  if (sim.phase === "voting" || sim.phase === "confidence") {
    return { advanced: false, exhausted: false, message: "" };
  }

  if (
    sim.phase !== "coalition_talks" &&
    sim.phase !== "negotiation" &&
    sim.phase !== "crisis"
  ) {
    // Mandate varken yanlış faz — yine de süre kontrolü
    if (!needsCabinetFormation(simulationId)) {
      return { advanced: false, exhausted: false, message: "" };
    }
  }

  const dur = sim.mandate_duration_months ?? MANDATE_DURATION_MONTHS;
  if (sim.month < sim.mandate_started_month + dur) {
    return { advanced: false, exhausted: false, message: "" };
  }

  const holder = getParty(sim.mandate_party_id);
  const nextRank = (sim.mandate_rank || 1) + 1;
  const ordered = partiesBySeats(simulationId);

  insertEvent(
    simulationId,
    "mandate_expired",
    {
      message: `${holder?.name || "Formateur"} hükümeti ${dur} ayda kuramadı. Cumhurbaşkanı görevi geri aldı.`,
      partyName: holder?.name,
      partyColor: holder?.color,
      rank: sim.mandate_rank,
    },
    sim.month
  );

  if (nextRank > ordered.length) {
    clearMandate(simulationId);
    for (const p of ordered) updateParty(p.id, { is_government: 0 });
    reclaimMinistriesToHolder(simulationId, null);
    return {
      advanced: true,
      exhausted: true,
      message:
        "Tüm partilere hükümet kurma görevi verildi; kimse çoğunluk sağlayamadı — erken seçim yolu açılıyor.",
    };
  }

  const result = grantFormateurMandate(sim, nextRank);
  return {
    advanced: true,
    exhausted: false,
    message: result.message,
  };
}

export function describeMandateForAgent(simulationId: string): string {
  const sim = getSimulation(simulationId);
  if (!sim) return "";
  if (!needsCabinetFormation(simulationId)) return "";
  if (!sim.mandate_party_id) {
    return "HÜKÜMET KURULMADI: Kabine mühürlenmedi. Öncelik koalisyon (negotiateCoalition). Yasama kapalı. Bakanlıklar boş.";
  }
  const holder = getParty(sim.mandate_party_id);
  const started = sim.mandate_started_month ?? sim.month;
  const dur = sim.mandate_duration_months ?? MANDATE_DURATION_MONTHS;
  const left = Math.max(0, started + dur - sim.month);
  return `HÜKÜMET KURULMADI — FORMATEUR (iktidar değil): ${holder?.name || "?"} (sıra ${sim.mandate_rank}, ${left} ay kaldı). Öncelik: negotiateCoalition + kabul ile 301. Yasama kapalı. Bakanlıklar mühürlenince dolar.`;
}

export function onGovernmentMajoritySecured(simulationId: string): void {
  clearMandate(simulationId);
}
