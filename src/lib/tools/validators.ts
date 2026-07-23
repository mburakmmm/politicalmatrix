import {
  getAcceptedAlliancePartners,
  getAlliances,
  getMetrics,
  getParties,
  getParty,
  getSimulation,
} from "../db/repository";
import { governmentSeatTotal, hasMajority } from "../sim/parliament";
import { canEnqueueBill } from "../sim/lawEngine";
import { isSealedGovernment } from "../sim/mandate";
import { MAJORITY_THRESHOLD } from "../types";

export function canCallEarlyElection(
  simulationId: string,
  callerPartyId: string
): { ok: boolean; reason: string; supportSeats: number } {
  const parties = getParties(simulationId);
  const caller = parties.find((p) => p.id === callerPartyId);
  if (!caller) return { ok: false, reason: "Parti bulunamadı", supportSeats: 0 };

  const partners = getAcceptedAlliancePartners(simulationId, callerPartyId);
  const support = governmentSeatTotal(
    parties.map((p) =>
      p.id === callerPartyId ? { ...p, is_government: 1 } : p
    ),
    partners,
    callerPartyId
  );
  const opposition = parties
    .filter((p) => p.id !== callerPartyId)
    .reduce((s, p) => s + p.seats, 0);

  const partnerSeats = partners.reduce((s, id) => {
    const p = parties.find((x) => x.id === id);
    return s + (p?.seats ?? 0);
  }, 0);

  if (
    isSealedGovernment(simulationId) &&
    caller.is_government &&
    hasMajority(caller.seats + partnerSeats)
  ) {
    return {
      ok: true,
      reason: "İktidar çoğunluğu ile erken seçim",
      supportSeats: support,
    };
  }

  const callerBloc = caller.seats + partnerSeats;

  if (callerBloc >= MAJORITY_THRESHOLD) {
    return {
      ok: true,
      reason: "Meclis çoğunluğu ile erken seçim",
      supportSeats: callerBloc,
    };
  }

  // Soft path: muhalefet 200+ VE kriz/ağır metrik baskısı
  const sim = getSimulation(simulationId);
  const metrics = getMetrics(simulationId);
  const pressure =
    !!sim?.pending_crisis ||
    metrics.economy <= 35 ||
    metrics.fear >= 55 ||
    metrics.unemployment >= 32 ||
    metrics.inflation >= 55;

  if (!caller.is_government && callerBloc >= 200) {
    if (!pressure) {
      return {
        ok: false,
        reason: `Erken seçim için kriz veya ağır ekonomik/sosyal baskı gerekli (sandalye ${callerBloc}/301, baskı yok).`,
        supportSeats: callerBloc,
      };
    }
    return {
      ok: true,
      reason: "Muhalefet kriz/baskı altında erken seçim oylaması başlattı",
      supportSeats: callerBloc,
    };
  }

  return {
    ok: false,
    reason: `Yetersiz sandalye (${callerBloc}/301). Muhalefet toplamı: ${opposition}`,
    supportSeats: callerBloc,
  };
}

export function assertCanProposeBill(
  simulationId: string,
  debateMonths = 1
): {
  ok: boolean;
  reason: string;
} {
  return canEnqueueBill(simulationId, debateMonths);
}

export function findPendingAllianceFor(
  simulationId: string,
  partyId: string
) {
  return getAlliances(simulationId).filter(
    (a) => a.status === "pending" && a.to_party_id === partyId
  );
}

export function partyExists(partyId: string): boolean {
  return !!getParty(partyId);
}
