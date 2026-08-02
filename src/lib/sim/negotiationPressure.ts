import { getDb } from "../db/client";
import {
  getParties,
  getParty,
  getSimulation,
  insertEvent,
  updateParty,
  clampMetric,
} from "../db/repository";
import { mutualShift, attitudeVoteBias } from "./attitudes";
import { logAlmanac } from "./almanac";
import { MAJORITY_THRESHOLD, MAX_NEGOTIATION_ROUNDS } from "../types";
import type { PartyRow } from "../types";

/**
 * Hibrit müzakere (özgür LLM RPG):
 * - Tur 1: soft karşı teklif serbest
 * - Tur ≥2: soft devam serbest AMA anket/bakış cezası (zorla accept YOK)
 * - accept:false her turda siyasi red hakkı
 * - Tur limiti / açık walk-away → masa dağılır
 */
export const NEGOTIATION_DECISION_ROUND = 2;

export type OpenNegotiation = {
  id: string;
  from_party_id: string;
  to_party_id: string;
  round: number;
  updated_month: number;
};

export function canSoftCounterOffer(currentRound: number): boolean {
  return true; // soft her tur mümkün; geç turda cezalı
}

export function isPastSoftPhase(currentRound: number): boolean {
  return currentRound >= NEGOTIATION_DECISION_ROUND;
}

export function isAtRoundLimit(currentRound: number): boolean {
  return currentRound >= MAX_NEGOTIATION_ROUNDS;
}

/** Partinin yanıtlaması gereken açık masa (to_party_id = party) */
export function getOpenNegotiationTargeting(
  simulationId: string,
  partyId: string
): OpenNegotiation | null {
  const row = getDb()
    .prepare(
      `SELECT id, from_party_id, to_party_id, round, updated_month FROM negotiations
       WHERE simulation_id = ? AND status = 'open' AND to_party_id = ?
         AND from_party_id != to_party_id
       ORDER BY updated_month DESC, round DESC LIMIT 1`
    )
    .get(simulationId, partyId) as OpenNegotiation | undefined;
  return row ?? null;
}

/** Partiyle ilgili herhangi bir açık masa (gönderen veya alıcı) */
export function getOpenNegotiationInvolving(
  simulationId: string,
  partyId: string
): OpenNegotiation | null {
  const row = getDb()
    .prepare(
      `SELECT id, from_party_id, to_party_id, round, updated_month FROM negotiations
       WHERE simulation_id = ? AND status = 'open'
         AND from_party_id != to_party_id
         AND (from_party_id = ? OR to_party_id = ?)
       ORDER BY updated_month DESC, round DESC LIMIT 1`
    )
    .get(simulationId, partyId, partyId) as OpenNegotiation | undefined;
  return row ?? null;
}

/**
 * Formateur yeni masa açabilir mi?
 * Kendisine gelen açık masa varken yeniden açmak yasak (önce yanıtla).
 */
export function canOpenFreshNegotiation(
  simulationId: string,
  partyId: string
): { ok: boolean; reason?: string; blocking?: OpenNegotiation } {
  const open = getOpenNegotiationInvolving(simulationId, partyId);
  if (!open) return { ok: true };
  if (open.to_party_id === partyId) {
    return {
      ok: false,
      reason:
        "Size açık müzakere var — respondNegotiation ile yanıtlayın (kabul veya red sizin kararınız).",
      blocking: open,
    };
  }
  return {
    ok: false,
    reason:
      "Açık müzakere sürüyor — karşı yanıtı bekleyin; aynı masaya yeniden negotiateCoalition açmayın.",
    blocking: open,
  };
}

/**
 * Geç tur soft devam cezası — accept zorlamaz, siyasi maliyeti vardır.
 */
export function applySoftCounterPressure(opts: {
  simulationId: string;
  partyA: string;
  partyB: string;
  round: number;
}): void {
  if (!isPastSoftPhase(opts.round)) return;
  const sim = getSimulation(opts.simulationId);
  const month = sim?.month ?? 1;
  const a = getParty(opts.partyA);
  const b = getParty(opts.partyB);
  const hit = 0.9 + Math.min(1.2, (opts.round - 1) * 0.35);
  if (a) {
    updateParty(a.id, {
      poll_share: clampMetric(a.poll_share - hit, 5, 70),
    });
  }
  if (b) {
    updateParty(b.id, {
      poll_share: clampMetric(b.poll_share - hit * 0.7, 5, 70),
    });
  }
  mutualShift(
    opts.simulationId,
    opts.partyA,
    opts.partyB,
    -4,
    `Uzayan soft müzakere (tur ${opts.round})`
  );
  insertEvent(
    opts.simulationId,
    "negotiation_soft_pressure",
    {
      message: `Müzakere uzuyor (tur ${opts.round}): kamuoyu sabırsız (−${hit.toFixed(1)}pp). Kabul veya net red bekleniyor.`,
      round: opts.round,
      partyName: a?.name,
      partyColor: a?.color,
    },
    month
  );
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
  const pollHit =
    kind === "round_limit" ? 2.2 : kind === "decision_timeout" ? 1.8 : 1.2;

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
    return `Tur ${round}/${MAX_NEGOTIATION_ROUNDS}: soft karşı teklif serbest; accept:true|false sizin kararınız.`;
  }
  if (round < MAX_NEGOTIATION_ROUNDS) {
    return `Tur ${round}/${MAX_NEGOTIATION_ROUNDS}: soft devam cezalı (anket/bakış). accept:true mühürler; accept:false soft veya net red — zorla kabul YOK.`;
  }
  return `Tur limiti (${MAX_NEGOTIATION_ROUNDS}): kabul edin veya masa dağılır.`;
}

/**
 * Formateur için ortak adayı: 301 aritmetiği + bakış + köprü (Merkez) —
 * uç-uç (Sol↔Sağ) sandalyeye göre kör seçilmesin.
 */
export function pickCoalitionPartner(
  simulationId: string,
  formateurId: string
): PartyRow | null {
  const formateur = getParty(formateurId);
  const others = getParties(simulationId).filter((p) => p.id !== formateurId);
  if (!formateur || !others.length) return null;

  const scored = others.map((p) => {
    const toward = attitudeVoteBias(formateurId, p.id);
    const seatsOk =
      formateur.seats + p.seats >= MAJORITY_THRESHOLD ? 40 : -20;
    const bridge = p.slug === "center" ? 30 : 0;
    const polar =
      (formateur.slug === "left" && p.slug === "right") ||
      (formateur.slug === "right" && p.slug === "left")
        ? -35
        : 0;
    const seatTieBreak = p.seats * 0.02;
    return {
      p,
      score: toward + seatsOk + bridge + polar + seatTieBreak,
    };
  });

  scored.sort((a, b) => b.score - a.score || b.p.seats - a.p.seats);
  return scored[0]?.p ?? null;
}

/**
 * Last-resort yanıt: erken turda bakış; karar turunda / limit öncesi mühürle.
 * (LM 500 → sürekli soft → masa asla kurulmuyordu.)
 */
export function lastResortShouldAccept(opts: {
  toward: number;
  round: number;
}): boolean {
  if (opts.round >= MAX_NEGOTIATION_ROUNDS - 1 || isPastSoftPhase(opts.round)) {
    return true;
  }
  // Erken tur: hafif soğuk bakışta bile soft yerine açılış yolu bırak
  return opts.toward >= -8;
}

/** Metinden net walk-away / ret niyeti */
export function looksLikeHardReject(text: string): boolean {
  return /\b(red|ret|reddet|kabul etmiyor|masay[ıi] kapat|görüşme bitti|reject|refuse|decline|walk.?away)\b/i.test(
    text
  );
}
