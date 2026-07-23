import { getDb } from "../db/client";
import {
  getAcceptedAlliancePartners,
  getParties,
  getSimulation,
  updateSimulation,
} from "../db/repository";
import { governmentSeatTotal, hasMajority } from "./parliament";
import { hasFloorBill } from "./lawEngine";
import { needsCabinetFormation } from "./mandate";

function hasActiveConfidence(simulationId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM confidence_motions
       WHERE simulation_id = ? AND status = 'voting' LIMIT 1`
    )
    .get(simulationId);
  return !!row;
}

/**
 * Yasama/oylama bitince fazı temizler; floor varsa voting'e alır.
 * election / regime_transition / crisis fazlarını ezmez.
 */
export function syncLegislativePhase(simulationId: string): void {
  const sim = getSimulation(simulationId);
  if (!sim) return;

  if (
    sim.phase === "election" ||
    sim.phase === "regime_transition"
  ) {
    return;
  }

  // Kabine kurulurken yeni floor bill oylaması açılmasın; mevcut floor varsa bitir
  if (hasFloorBill(simulationId)) {
    if (sim.phase !== "voting") {
      updateSimulation(simulationId, { phase: "voting" });
    }
    return;
  }

  if (hasActiveConfidence(simulationId)) {
    if (sim.phase !== "confidence") {
      updateSimulation(simulationId, { phase: "confidence" });
    }
    return;
  }

  if (needsCabinetFormation(simulationId)) {
    if (sim.pending_crisis === "corruption_scandal") {
      updateSimulation(simulationId, { phase: "crisis" });
      return;
    }
    if (sim.phase !== "coalition_talks" && sim.phase !== "negotiation") {
      updateSimulation(simulationId, { phase: "coalition_talks" });
    }
    return;
  }

  // Floor yok — voting/confidence fazında takılı kalmayı kır
  if (sim.phase === "voting" || sim.phase === "confidence") {
    if (sim.pending_crisis) {
      updateSimulation(simulationId, { phase: "crisis" });
      return;
    }

    const parties = getParties(simulationId);
    const gov = parties.find((p) => p.is_government === 1);
    if (!gov) {
      updateSimulation(simulationId, { phase: "coalition_talks" });
      return;
    }
    const partners = getAcceptedAlliancePartners(simulationId, gov.id);
    const total = governmentSeatTotal(parties, partners);
    updateSimulation(simulationId, {
      phase: hasMajority(total) ? "governing" : "coalition_talks",
    });
  }
}
