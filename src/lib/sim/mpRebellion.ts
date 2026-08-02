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
 * Tetikler (sıkı):
 * - Yalnızca sert ideoloji çelişkisi (±2)
 * - Yüksek koalisyon stresinde hükümet yasasına Ret
 * ±1 gri alan / taktik oy → isyan yok (spam kesildi)
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
    // Yalnız ±2 sert çelişki — ±1 taktik oy isyan doğurmaz
    if (score >= 2 && opts.partyVote === "NO") {
      rebelRate += 0.1 + Math.min(0.12, (score - 1) * 0.04);
      reasons.push(`taban uyumlu yasaya sert Ret (skor ${score})`);
    } else if (score <= -2 && opts.partyVote === "YES") {
      rebelRate += 0.12 + Math.min(0.14, (Math.abs(score) - 1) * 0.05);
      reasons.push(`taban karşıtı yasaya Kabul (skor ${score})`);
    }
  }

  const stress = opts.coalitionStress ?? 0;
  if (opts.votingAgainstGovBill && opts.partyVote === "NO" && stress >= 35) {
    const add = 0.06 + Math.min(0.14, stress / 280);
    rebelRate += add;
    reasons.push(`koalisyon stresi ${stress.toFixed(0)} — hükümet yasasına Ret`);
  } else if (stress >= 60) {
    rebelRate += 0.04;
    reasons.push("çok yüksek koalisyon gerilimi");
  }

  // Tetik yoksa gürültüyle sahte isyan üretme
  if (!reasons.length || rebelRate <= 0) {
    return { ...applyLoyal(seats, opts.partyVote), reason: undefined };
  }

  // Hafif gürültü (yalnız gerçek tetik varken)
  rebelRate += (rng() - 0.5) * 0.025;
  rebelRate = Math.max(0.04, Math.min(0.28, rebelRate));

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
