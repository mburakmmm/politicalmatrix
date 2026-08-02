import { MAJORITY_THRESHOLD, TOTAL_SEATS } from "../types";
import type { PartyRow } from "../types";

export function hasMajority(seats: number): boolean {
  return seats >= MAJORITY_THRESHOLD;
}

/**
 * Hükümet/formateur bloğu sandalye toplamı.
 * leadPartyId: formateur (henüz is_government yokken) veya mühürlü iktidar.
 */
export function governmentSeatTotal(
  parties: PartyRow[],
  alliancePartnerIds: string[],
  leadPartyId?: string | null
): number {
  const gov =
    (leadPartyId
      ? parties.find((p) => p.id === leadPartyId)
      : undefined) ?? parties.find((p) => p.is_government === 1);
  if (!gov) return 0;
  const partnerSet = new Set(alliancePartnerIds);
  return parties
    .filter((p) => p.id === gov.id || partnerSet.has(p.id))
    .reduce((sum, p) => sum + p.seats, 0);
}

export function resolveBillVote(
  yesSeats: number,
  noSeats: number
): "passed" | "rejected" {
  return yesSeats >= MAJORITY_THRESHOLD && yesSeats > noSeats
    ? "passed"
    : "rejected";
}

/** Sainte-Laguë / d'Hondt hybrid: classic d'Hondt for 600 seats */
export function allocateSeatsDhondt(
  pollShares: Array<{ id: string; share: number }>,
  totalSeats = TOTAL_SEATS
): Record<string, number> {
  const quotas = pollShares.map((p) => ({
    id: p.id,
    votes: Math.max(0.01, p.share),
    seats: 0,
  }));

  for (let i = 0; i < totalSeats; i++) {
    let best = 0;
    for (let j = 1; j < quotas.length; j++) {
      const scoreJ = quotas[j].votes / (quotas[j].seats + 1);
      const scoreBest = quotas[best].votes / (quotas[best].seats + 1);
      if (scoreJ > scoreBest) best = j;
    }
    quotas[best].seats += 1;
  }

  return Object.fromEntries(quotas.map((q) => [q.id, q.seats]));
}

export function normalizePollShares(
  parties: Array<{ id: string; poll_share: number }>
): Array<{ id: string; share: number }> {
  const sum = parties.reduce((s, p) => s + Math.max(0, p.poll_share), 0) || 1;
  return parties.map((p) => ({
    id: p.id,
    share: (Math.max(0, p.poll_share) / sum) * 100,
  }));
}
