import { getDb } from "../db/client";
import {
  getParty,
  getSimulation,
  insertEvent,
  updateParty,
  clampMetric,
} from "../db/repository";
import { mutualShift } from "./attitudes";
import { logAlmanac } from "./almanac";
import { MAX_NEGOTIATION_ROUNDS } from "../types";

/**
 * Tur 1: soft karşı teklif serbest.
 * Tur ≥2: soft devam yasak — accept:true veya masa dağılır (ceza).
 */
export const NEGOTIATION_DECISION_ROUND = 2;

export function canSoftCounterOffer(currentRound: number): boolean {
  return currentRound < NEGOTIATION_DECISION_ROUND;
}

export function isPastSoftPhase(currentRound: number): boolean {
  return currentRound >= NEGOTIATION_DECISION_ROUND;
}

export function isAtRoundLimit(currentRound: number): boolean {
  return currentRound >= MAX_NEGOTIATION_ROUNDS;
}

/**
 * Açık müzakereyi başarısız kapat: anket + bakış cezası.
 */
export function collapseNegotiation(opts: {
  simulationId: string;
  negotiationId: string;
  partyA: string;
  partyB: string;
  reason: string;
  kind: "round_limit" | "decision_timeout" | "walk_away";
}): void {
  const { simulationId, negotiationId, partyA, partyB, reason, kind } = opts;
  const sim = getSimulation(simulationId);
  const month = sim?.month ?? 1;

  getDb()
    .prepare(
      `UPDATE negotiations SET status = 'failed', updated_month = ? WHERE id = ?`
    )
    .run(month, negotiationId);

  const a = getParty(partyA);
  const b = getParty(partyB);
  const pollHit = kind === "round_limit" ? 2.2 : kind === "decision_timeout" ? 1.8 : 1.2;

  if (a) {
    updateParty(a.id, {
      poll_share: clampMetric(a.poll_share - pollHit, 5, 70),
    });
  }
  if (b) {
    updateParty(b.id, {
      poll_share: clampMetric(b.poll_share - pollHit * 0.85, 5, 70),
    });
  }

  mutualShift(
    simulationId,
    partyA,
    partyB,
    kind === "walk_away" ? -6 : -10,
    `Müzakere çöktü: ${reason.slice(0, 60)}`
  );

  const names = `${a?.name || "?"}–${b?.name || "?"}`;
  insertEvent(
    simulationId,
    "negotiation_failed",
    {
      message: `Müzakere çöktü (${names}): ${reason} Anket −${pollHit.toFixed(1)}pp civarı.`,
      partyName: a?.name,
      partyColor: a?.color,
      negotiationId,
      kind,
      reason,
    },
    month
  );
  logAlmanac({
    simulationId,
    month,
    kind: "coalition",
    title: "Müzakere başarısız",
    detail: `${names}: ${reason}`,
    actorPartyId: partyA,
  });
}

export function describeNegotiationPressure(round: number): string {
  if (round < NEGOTIATION_DECISION_ROUND) {
    return `Tur ${round}/${MAX_NEGOTIATION_ROUNDS}: soft karşı teklif serbest; sonra KARAR turu (accept:true veya masa dağılır).`;
  }
  if (round < MAX_NEGOTIATION_ROUNDS) {
    return `KARAR TURU ${round}/${MAX_NEGOTIATION_ROUNDS}: accept:true zorunlu (bakış uygunsa). Soft devam → masa dağılır + anket cezası.`;
  }
  return `Tur limiti (${MAX_NEGOTIATION_ROUNDS}): soft yasak — kabul veya çöküş.`;
}
