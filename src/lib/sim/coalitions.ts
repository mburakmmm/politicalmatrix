import {
  getAcceptedAlliancePartners,
  getAlliances,
  getParties,
  getSimulation,
  insertEvent,
  updateParty,
  updateSimulation,
} from "../db/repository";
import { governmentSeatTotal, hasMajority } from "./parliament";
import type { SimulationRow } from "../types";
import { getDb } from "../db/client";
import { reclaimMinistriesToHolder, shareMinistriesForAlliance } from "./ministries";
import {
  clearMandate,
  getCabinetLeadId,
  grantFormateurMandate,
  sealCabinet,
} from "./mandate";

export function breakGovernmentAlliances(
  simulationId: string,
  month: number
): void {
  getDb()
    .prepare(
      `UPDATE alliances SET status = 'broken'
       WHERE simulation_id = ? AND status = 'accepted'`
    )
    .run(simulationId);
  getDb()
    .prepare(
      `UPDATE negotiations SET status = 'failed'
       WHERE simulation_id = ? AND status = 'open'`
    )
    .run(simulationId);
  insertEvent(
    simulationId,
    "alliance_broken",
    {
      message: "Hükümet düştü — koalisyon ve açık müzakereler geçersiz.",
    },
    month
  );
}

/** Hükümeti düşür: bayrak, bakanlık, ittifak, faz, kriz temizliği */
export function fallGovernment(
  sim: SimulationRow,
  reason: string
): void {
  const parties = getParties(sim.id);
  for (const p of parties) {
    if (p.is_government) updateParty(p.id, { is_government: 0 });
  }
  reclaimMinistriesToHolder(sim.id, null);
  breakGovernmentAlliances(sim.id, sim.month);
  clearMandate(sim.id);
  updateSimulation(sim.id, {
    phase: "coalition_talks",
    pending_crisis: null,
  });
  insertEvent(
    sim.id,
    "government_fallen",
    { message: reason },
    sim.month
  );
  grantFormateurMandate(getSimulation(sim.id)!, 1);
}

export function refreshGovernmentPhase(sim: SimulationRow): void {
  const parties = getParties(sim.id);
  const leadId = getCabinetLeadId(sim.id);

  if (!leadId) {
    if (
      sim.phase === "governing" ||
      sim.phase === "negotiation" ||
      sim.phase === "crisis"
    ) {
      updateSimulation(sim.id, { phase: "coalition_talks" });
    }
    return;
  }

  const partners = getAcceptedAlliancePartners(sim.id, leadId);
  const total = governmentSeatTotal(parties, partners, leadId);
  const lead = parties.find((p) => p.id === leadId)!;
  const sealed = !!lead.is_government && !sim.mandate_party_id;

  if (hasMajority(total)) {
    if (!sealed) {
      const wasForming =
        !!sim.mandate_party_id ||
        sim.phase === "coalition_talks" ||
        sim.phase === "negotiation" ||
        sim.phase === "crisis";
      sealCabinet(sim.id, leadId, {
        announce: wasForming && sim.phase !== "crisis",
        seats: total,
        partners,
      });
      for (const partnerId of partners) {
        shareMinistriesForAlliance(sim.id, leadId, partnerId, undefined, 2);
      }
    } else if (
      sim.phase !== "governing" &&
      sim.phase !== "voting" &&
      sim.phase !== "confidence"
    ) {
      updateSimulation(sim.id, { phase: "governing" });
    }
    return;
  }

  // Çoğunluk yok
  if (sealed || sim.phase === "governing") {
    fallGovernment(
      getSimulation(sim.id)!,
      `Hükümet çoğunluğunu kaybetti (${total}/600, eşik 301).`
    );
    return;
  }

  if (sim.phase === "negotiation" || sim.phase === "crisis") {
    updateSimulation(sim.id, { phase: "coalition_talks" });
  }
}

export function describeAlliances(simulationId: string): string {
  const alliances = getAlliances(simulationId);
  const parties = getParties(simulationId);
  const name = (id: string) =>
    parties.find((p) => p.id === id)?.name ?? id;

  if (!alliances.length) return "Aktif ittifak yok.";
  return alliances
    .map(
      (a) =>
        `${name(a.from_party_id)} → ${name(a.to_party_id)} [${a.status}]: ${a.concessions}`
    )
    .join("\n");
}
