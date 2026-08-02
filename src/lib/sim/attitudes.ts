import { getDb } from "../db/client";
import { createId, getParties, getSimulation } from "../db/repository";
import { logAlmanac } from "./almanac";

export type AttitudeStance =
  | "hostile"
  | "rival"
  | "wary"
  | "neutral"
  | "warm"
  | "allied";

export interface AttitudeRow {
  id: string;
  simulation_id: string;
  from_party_id: string;
  to_party_id: string;
  score: number;
  stance: string;
  note: string;
  updated_month: number;
}

function stanceFromScore(score: number): AttitudeStance {
  if (score <= -60) return "hostile";
  if (score <= -25) return "rival";
  if (score < -5) return "wary";
  if (score < 20) return "neutral";
  if (score < 55) return "warm";
  return "allied";
}

const STANCE_TR: Record<AttitudeStance, string> = {
  hostile: "Düşman",
  rival: "Rakip",
  wary: "Mesafeli",
  neutral: "Nötr",
  warm: "Yakın",
  allied: "Müttefik",
};

export function stanceLabel(stance: string): string {
  return STANCE_TR[stance as AttitudeStance] || stance;
}

/** Başlangıç bakış açıları — V3 etki grubu hissi */
export function seedAttitudes(simulationId: string): void {
  const parties = getParties(simulationId);
  const bySlug = Object.fromEntries(parties.map((p) => [p.slug, p]));
  const pairs: Array<[string, string, number, string]> = [];

  const left = bySlug.left;
  const center = bySlug.center;
  const right = bySlug.right;
  if (!left || !center || !right) return;

  // from, to, score, note
  pairs.push(
    [left.id, right.id, -45, "Sınıfsal ve değerler uçurumu"],
    [right.id, left.id, -48, "Düzen ve gelenek tehdidi görüyor"],
    [left.id, center.id, -8, "Yavaş reformcu, yetersiz bulunuyor"],
    [center.id, left.id, 5, "Koalisyon için kullanılabilir"],
    [right.id, center.id, 10, "İstikrar ortaklığı mümkün"],
    [center.id, right.id, -5, "Aşırı sağ riski"]
  );

  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO party_attitudes (
      id, simulation_id, from_party_id, to_party_id, score, stance, note, updated_month
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );

  for (const [from, to, score, note] of pairs) {
    stmt.run(
      createId("att"),
      simulationId,
      from,
      to,
      score,
      stanceFromScore(score),
      note
    );
  }
}

export function getAttitudes(simulationId: string): AttitudeRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM party_attitudes WHERE simulation_id = ?
       AND from_party_id != to_party_id`
    )
    .all(simulationId) as AttitudeRow[];
}

export function getAttitude(
  fromPartyId: string,
  toPartyId: string
): AttitudeRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM party_attitudes WHERE from_party_id = ? AND to_party_id = ?`
      )
      .get(fromPartyId, toPartyId) as AttitudeRow | undefined) ?? null
  );
}

export function shiftAttitude(
  simulationId: string,
  fromPartyId: string,
  toPartyId: string,
  delta: number,
  note: string
): void {
  if (fromPartyId === toPartyId) return;
  const sim = getSimulation(simulationId);
  const month = sim?.month ?? 1;
  let row = getAttitude(fromPartyId, toPartyId);
  if (!row) {
    getDb()
      .prepare(
        `INSERT INTO party_attitudes (
          id, simulation_id, from_party_id, to_party_id, score, stance, note, updated_month
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId("att"),
        simulationId,
        fromPartyId,
        toPartyId,
        Math.max(-100, Math.min(100, delta)),
        stanceFromScore(delta),
        note,
        month
      );
    return;
  }
  const score = Math.max(-100, Math.min(100, row.score + delta));
  getDb()
    .prepare(
      `UPDATE party_attitudes SET score = ?, stance = ?, note = ?, updated_month = ?
       WHERE id = ?`
    )
    .run(score, stanceFromScore(score), note, month, row.id);
}

export function mutualShift(
  simulationId: string,
  a: string,
  b: string,
  delta: number,
  note: string
): void {
  shiftAttitude(simulationId, a, b, delta, note);
  shiftAttitude(simulationId, b, a, delta * 0.85, note);
}

/**
 * İttifak için asgari sıcaklık (V3 etki grubu mantığı).
 * Normal: rakip/düşman (<= -25) doğrudan ittifak kuramaz.
 * Formateur / kabine kurulumu: eşik -55 (büyük koalisyon mümkün; soft forever kilidi kırılır).
 */
export function attitudeAllowsAlliance(
  fromPartyId: string,
  toPartyId: string,
  opts?: { formingCabinet?: boolean }
): { ok: boolean; score: number; reason: string } {
  const att = getAttitude(fromPartyId, toPartyId);
  const score = att?.score ?? 0;
  const threshold = opts?.formingCabinet ? -55 : -25;
  if (score <= threshold) {
    return {
      ok: false,
      score,
      reason: `Bakış açısı ittifaka engel (${stanceLabel(att?.stance || "rival")}: ${score.toFixed(0)}). Önce konuşma, ortak yasa veya kriz işbirliğiyle yumuşama gerekir.`,
    };
  }
  return { ok: true, score, reason: "İttifak mümkün" };
}

/**
 * Müzakere kapısı daha yumuşak: yalnızca aşırı düşmanlık (<= -70) engeller.
 * Ortada kalan gerilim müzakere ile yumuşayabilir.
 */
export function attitudeAllowsNegotiation(
  fromPartyId: string,
  toPartyId: string
): { ok: boolean; score: number; reason: string; soft: boolean } {
  const att = getAttitude(fromPartyId, toPartyId);
  const score = att?.score ?? 0;
  if (score <= -70) {
    return {
      ok: false,
      score,
      soft: false,
      reason: `Bakış aşırı düşman (${stanceLabel(att?.stance || "hostile")}: ${score.toFixed(0)}). Önce PR, ortak oy veya kriz işbirliği gerekir.`,
    };
  }
  return {
    ok: true,
    score,
    soft: score < -25,
    reason:
      score < -25
        ? "Müzakere mümkün ama soğuk — taviz şart"
        : "Müzakere mümkün",
  };
}

/** Oy eğilimi: karşı partiye bakış, yasa sahibine göre */
export function attitudeVoteBias(
  voterId: string,
  proposerId: string
): number {
  if (voterId === proposerId) return 15;
  const att = getAttitude(voterId, proposerId);
  if (!att) return 0;
  // -100..100 → roughly -20..+20 seat-independent bias on YES preference
  return att.score / 5;
}

export function describeAttitudesForAgent(
  simulationId: string,
  partyId: string
): string {
  const parties = getParties(simulationId);
  const rows = getAttitudes(simulationId).filter(
    (a) => a.from_party_id === partyId
  );
  if (!rows.length) return "Bakış açıları: yok";
  return rows
    .map((a) => {
      const other = parties.find((p) => p.id === a.to_party_id);
      return `${other?.slug || "?"}:${a.score.toFixed(0)}(${stanceLabel(a.stance)})`;
    })
    .join(" ");
}

export function logAttitudeEvent(
  simulationId: string,
  month: number,
  title: string,
  detail: string
): void {
  logAlmanac({
    simulationId,
    month,
    kind: "attitude",
    title,
    detail,
  });
}
