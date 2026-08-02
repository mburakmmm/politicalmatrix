import type { LawDef } from "./laws/catalog";
import { biasKeyForSlug } from "./laws/catalog";
import type { VoteChoice } from "../types";
import { getDb } from "../db/client";

export type SeatSplit = {
  yes: number;
  no: number;
  abstain: number;
  rebelSeats: number;
  loyalSeats: number;
  reason?: string;
};

/**
 * Parti liderliği tek oy verir; milletvekillerinin bir kısmı isyan edebilir.
 * Uygulanabilir soyutlama: sandalye kaçışı (ayrı MV entity yok).
 *
 * Tetikler:
 * - Lider ideolojiye ters oy verdiyse (skor ±1+)
 * - Koalisyon stresinde hükümet yasasına Ret
 * - Yüksek stres / düşük disiplin
 */
export function computeMpRebellionSplit(opts: {
  seats: number;
  partyVote: VoteChoice;
  slug: string;
  law: LawDef | null;
  isProposer: boolean;
  coalitionStress?: number;
  votingAgainstGovBill?: boolean;
  rng?: () => number;
}): SeatSplit {
  const seats = Math.max(0, Math.floor(opts.seats));
  const empty = (): SeatSplit => ({
    yes: 0,
    no: 0,
    abstain: 0,
    rebelSeats: 0,
    loyalSeats: seats,
  });
  if (seats === 0) return empty();

  // Teklif sahibi: disiplin yüksek — isyan yok
  if (opts.isProposer) {
    return applyLoyal(seats, opts.partyVote);
  }

  const rng = opts.rng ?? Math.random;
  let rebelRate = 0;
  const reasons: string[] = [];

  if (opts.law) {
    const score = opts.law.bias[biasKeyForSlug(opts.slug)];
    if (score >= 1 && opts.partyVote === "NO") {
      rebelRate += 0.12 + Math.min(0.18, score * 0.06);
      reasons.push(`taban uyumlu yasaya Ret (skor ${score})`);
    } else if (score <= -1 && opts.partyVote === "YES") {
      rebelRate += 0.14 + Math.min(0.2, Math.abs(score) * 0.07);
      reasons.push(`taban karşıtı yasaya Kabul (skor ${score})`);
    } else if (score >= 1 && opts.partyVote === "ABSTAIN") {
      rebelRate += 0.06;
      reasons.push("uyumlu yasada çekimserlik");
    }
  }

  const stress = opts.coalitionStress ?? 0;
  if (opts.votingAgainstGovBill && opts.partyVote === "NO" && stress >= 20) {
    const add = 0.08 + Math.min(0.22, stress / 200);
    rebelRate += add;
    reasons.push(`koalisyon stresi ${stress.toFixed(0)} — hükümet yasasına Ret`);
  } else if (stress >= 45) {
    rebelRate += 0.05;
    reasons.push("yüksek koalisyon gerilimi");
  }

  // Gürültü
  rebelRate += (rng() - 0.5) * 0.04;
  rebelRate = Math.max(0, Math.min(0.42, rebelRate));

  const rebelSeats = Math.floor(seats * rebelRate);
  if (rebelSeats <= 0) {
    return { ...applyLoyal(seats, opts.partyVote), reason: undefined };
  }

  const loyalSeats = seats - rebelSeats;
  const rebelVote = oppositeVote(opts.partyVote);
  const split = mergeVotes(
    applyLoyal(loyalSeats, opts.partyVote),
    applyLoyal(rebelSeats, rebelVote)
  );
  split.rebelSeats = rebelSeats;
  split.loyalSeats = loyalSeats;
  split.reason = reasons[0] || "grup içi isyan";
  return split;
}

function oppositeVote(v: VoteChoice): VoteChoice {
  if (v === "YES") return "NO";
  if (v === "NO") return "YES";
  // Çekimser isyan → çoğunlukla Ret'e kayar (muhalif kanat)
  return "NO";
}

function applyLoyal(seats: number, vote: VoteChoice): SeatSplit {
  return {
    yes: vote === "YES" ? seats : 0,
    no: vote === "NO" ? seats : 0,
    abstain: vote === "ABSTAIN" ? seats : 0,
    rebelSeats: 0,
    loyalSeats: seats,
  };
}

function mergeVotes(a: SeatSplit, b: SeatSplit): SeatSplit {
  return {
    yes: a.yes + b.yes,
    no: a.no + b.no,
    abstain: a.abstain + b.abstain,
    rebelSeats: a.rebelSeats + b.rebelSeats,
    loyalSeats: a.loyalSeats + b.loyalSeats,
  };
}

/** İttifak satırından stres oku (yoksa 0) */
export function readCoalitionStressForVoter(
  simulationId: string,
  voterPartyId: string,
  govPartyId: string | null
): number {
  if (!govPartyId) return 0;
  const row = getDb()
    .prepare(
      `SELECT stress FROM alliances
       WHERE simulation_id = ? AND status = 'accepted'
         AND ((from_party_id = ? AND to_party_id = ?)
           OR (from_party_id = ? AND to_party_id = ?))
       LIMIT 1`
    )
    .get(
      simulationId,
      voterPartyId,
      govPartyId,
      govPartyId,
      voterPartyId
    ) as { stress?: number } | undefined;
  return Number(row?.stress ?? 0);
}
