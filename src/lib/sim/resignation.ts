import {
  getAcceptedAlliancePartners,
  getAlliances,
  getParties,
  getParty,
  getSimulation,
  insertEvent,
  updateSimulation,
} from "../db/repository";
import { fallGovernment, refreshGovernmentPhase } from "./coalitions";
import { ruptureCoalitionAlliance } from "./coalitionStress";
import { reclaimPartnerMinistries } from "./ministries";
import { isSealedGovernment } from "./mandate";

/** Mühürlü iktidar lideri veya kabul edilmiş koalisyon ortağı */
export function isGovernmentBlocMember(
  simulationId: string,
  partyId: string
): boolean {
  if (!isSealedGovernment(simulationId)) return false;
  const parties = getParties(simulationId);
  const lead = parties.find((p) => p.is_government === 1);
  if (!lead) return false;
  if (lead.id === partyId) return true;
  return getAcceptedAlliancePartners(simulationId, lead.id).includes(partyId);
}

export function isCabinetLead(
  simulationId: string,
  partyId: string
): boolean {
  const lead = getParties(simulationId).find((p) => p.is_government === 1);
  return !!lead && lead.id === partyId && isSealedGovernment(simulationId);
}

/**
 * İktidar lideri veya koalisyon ortağı istifası.
 * Lider → hükümet düşer; ortak → ittifak kopar (çoğunluk yoksa düşer).
 */
export function applyCabinetResignation(opts: {
  simulationId: string;
  partyId: string;
  reason: string;
  month: number;
}): {
  ok: boolean;
  kind: "lead" | "partner" | "none";
  message: string;
} {
  const { simulationId, partyId, reason, month } = opts;
  const actor = getParty(partyId);
  if (!actor) {
    return { ok: false, kind: "none", message: "Parti yok" };
  }

  if (!isGovernmentBlocMember(simulationId, partyId)) {
    return {
      ok: false,
      kind: "none",
      message:
        "İstifa (kabine etkisi) yalnız mühürlü iktidar veya koalisyon ortağı için geçerli.",
    };
  }

  const lead = getParties(simulationId).find((p) => p.is_government === 1)!;

  if (actor.id === lead.id) {
    const sim = getSimulation(simulationId)!;
    fallGovernment(
      sim,
      `${actor.name} istifa etti — hükümet düştü. ${reason.slice(0, 120)}`
    );
    insertEvent(
      simulationId,
      "resignation",
      {
        partyName: actor.name,
        partyColor: actor.color,
        role: "lead",
        message: `${actor.name} (iktidar) istifa etti. Kabine düştü.`,
      },
      month
    );
    return {
      ok: true,
      kind: "lead",
      message: "İktidar istifası: hükümet düştü, formateur süreci başlar",
    };
  }

  // Ortak istifa → ittifak kopar
  const alliance = getAlliances(simulationId).find(
    (a) =>
      a.status === "accepted" &&
      ((a.from_party_id === actor.id && a.to_party_id === lead.id) ||
        (a.to_party_id === actor.id && a.from_party_id === lead.id))
  );

  if (alliance) {
    ruptureCoalitionAlliance({
      simulationId,
      allianceId: alliance.id,
      initiatorId: actor.id,
      otherId: lead.id,
      month,
      reason: `${actor.name} koalisyondan çekildi (istifa). ${reason.slice(0, 100)}`,
      automatic: false,
    });
  } else {
    reclaimPartnerMinistries(simulationId, lead.id, actor.id);
    const sim = getSimulation(simulationId);
    if (sim) refreshGovernmentPhase(sim);
  }

  updateSimulation(simulationId, { pending_crisis: null });

  insertEvent(
    simulationId,
    "resignation",
    {
      partyName: actor.name,
      partyColor: actor.color,
      role: "partner",
      message: `${actor.name} (koalisyon ortağı) istifa ederek bloktan ayrıldı.`,
    },
    month
  );

  return {
    ok: true,
    kind: "partner",
    message: "Koalisyon ortağı istifa: ittifak bozuldu; çoğunluk yoksa hükümet düşer",
  };
}
