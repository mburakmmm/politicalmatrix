import {
  getAcceptedAlliancePartners,
  getParties,
  getSimulation,
  insertEvent,
  createId,
} from "../db/repository";
import { getDb } from "../db/client";
import { getCabinetLeadId, needsCabinetFormation } from "./mandate";
import { fallGovernment } from "./coalitions";
import type { PartyRow, SimulationRow } from "../types";

/** Anket bloğu bu eşiğin altında → otomatik gensoru (muhalefet) */
export const GOV_POLL_CENSURE_THRESHOLD = 32;
/** Anket bloğu bu eşiğin altında → hükümet düşer */
export const GOV_POLL_FALL_THRESHOLD = 22;
/** Üst üste zayıf ay (censure bandında) sonrası düşüş */
export const GOV_POLL_WEAK_STREAK_FALL = 3;

export function governmentBlocPollShare(
  simulationId: string,
  parties?: PartyRow[]
): { share: number; lead: PartyRow | null; partners: PartyRow[] } {
  const all = parties ?? getParties(simulationId);
  const leadId = getCabinetLeadId(simulationId);
  const lead =
    (leadId ? all.find((p) => p.id === leadId) : null) ??
    all.find((p) => p.is_government) ??
    null;
  if (!lead) return { share: 0, lead: null, partners: [] };
  const partnerIds = new Set(
    getAcceptedAlliancePartners(simulationId, lead.id)
  );
  const partners = all.filter((p) => partnerIds.has(p.id));
  const share =
    lead.poll_share + partners.reduce((s, p) => s + p.poll_share, 0);
  return { share, lead, partners };
}

export function strongestOpposition(
  simulationId: string,
  parties?: PartyRow[]
): PartyRow | null {
  const all = parties ?? getParties(simulationId);
  const { lead, partners } = governmentBlocPollShare(simulationId, all);
  if (!lead) return null;
  const bloc = new Set([lead.id, ...partners.map((p) => p.id)]);
  return (
    all
      .filter((p) => !bloc.has(p.id))
      .sort((a, b) => b.seats - a.seats || b.poll_share - a.poll_share)[0] ??
    null
  );
}

function getWeakStreak(simulationId: string): number {
  const row = getDb()
    .prepare(`SELECT gov_poll_weak_streak FROM simulations WHERE id = ?`)
    .get(simulationId) as { gov_poll_weak_streak?: number } | undefined;
  return Number(row?.gov_poll_weak_streak ?? 0);
}

function setWeakStreak(simulationId: string, n: number): void {
  getDb()
    .prepare(`UPDATE simulations SET gov_poll_weak_streak = ? WHERE id = ?`)
    .run(n, simulationId);
}

function hasActiveConfidence(simulationId: string): boolean {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM confidence_motions WHERE simulation_id = ? AND status = 'voting'`
    )
    .get(simulationId);
}

/** Muhalefet adına otomatik gensoru aç */
export function openAutoCensure(
  sim: SimulationRow,
  initiator: PartyRow,
  pollShare: number
): string | null {
  if (hasActiveConfidence(sim.id)) return null;
  const leadId = getCabinetLeadId(sim.id);
  const id = createId("conf");
  getDb()
    .prepare(
      `INSERT INTO confidence_motions (
        id, simulation_id, motion_type, initiator_id, target_party_id,
        status, created_month
      ) VALUES (?, ?, 'censure', ?, ?, 'voting', ?)`
    )
    .run(id, sim.id, initiator.id, leadId, sim.month);

  getDb()
    .prepare(`UPDATE simulations SET phase = 'confidence' WHERE id = ?`)
    .run(sim.id);

  insertEvent(
    sim.id,
    "confidence_motion",
    {
      message: `${initiator.name} anket çöküşü nedeniyle gensoru verdi (iktidar bloğu %${pollShare.toFixed(0)}).`,
      partyName: initiator.name,
      partyColor: initiator.color,
      motionId: id,
      auto: true,
      pollShare,
    },
    sim.month
  );
  return id;
}

export type PollPressureResult = {
  share: number;
  fell: boolean;
  censureOpened: boolean;
  shouldForceOppositionCensure: boolean;
};

/**
 * Ay sonu: anket baskısı.
 * <22% → hükümet düşer
 * <32% → streak++ ; streak≥3 → düşer; yoksa otomatik gensoru
 * ≥32% → streak sıfır
 */
export function applyGovernmentPollPressure(
  simulationId: string
): PollPressureResult {
  const sim = getSimulation(simulationId);
  const empty: PollPressureResult = {
    share: 0,
    fell: false,
    censureOpened: false,
    shouldForceOppositionCensure: false,
  };
  if (!sim || needsCabinetFormation(simulationId)) {
    setWeakStreak(simulationId, 0);
    return empty;
  }

  const parties = getParties(simulationId);
  const { share, lead } = governmentBlocPollShare(simulationId, parties);
  if (!lead?.is_government) {
    setWeakStreak(simulationId, 0);
    return { ...empty, share };
  }

  if (share < GOV_POLL_FALL_THRESHOLD) {
    setWeakStreak(simulationId, 0);
    fallGovernment(
      getSimulation(simulationId)!,
      `Anket çöküşü: iktidar bloğu %${share.toFixed(0)} (eşik ${GOV_POLL_FALL_THRESHOLD}%). Hükümet düştü.`
    );
    return {
      share,
      fell: true,
      censureOpened: false,
      shouldForceOppositionCensure: false,
    };
  }

  if (share < GOV_POLL_CENSURE_THRESHOLD) {
    const streak = getWeakStreak(simulationId) + 1;
    setWeakStreak(simulationId, streak);

    if (streak >= GOV_POLL_WEAK_STREAK_FALL) {
      setWeakStreak(simulationId, 0);
      fallGovernment(
        getSimulation(simulationId)!,
        `Anket zayıflığı sürdürülemez: iktidar bloğu %${share.toFixed(0)}, ${streak} ay üst üste eşik altı. Hükümet düştü.`
      );
      return {
        share,
        fell: true,
        censureOpened: false,
        shouldForceOppositionCensure: false,
      };
    }

    const opp = strongestOpposition(simulationId, parties);
    let censureOpened = false;
    if (opp && !hasActiveConfidence(simulationId)) {
      censureOpened = !!openAutoCensure(
        getSimulation(simulationId)!,
        opp,
        share
      );
    }
    return {
      share,
      fell: false,
      censureOpened,
      shouldForceOppositionCensure: true,
    };
  }

  setWeakStreak(simulationId, 0);
  return {
    share,
    fell: false,
    censureOpened: false,
    shouldForceOppositionCensure: false,
  };
}

/** Ajan: muhalefete gensoru zorla mı? */
export function shouldForceOppositionCensure(
  simulationId: string,
  partyId: string
): boolean {
  if (needsCabinetFormation(simulationId)) return false;
  if (hasActiveConfidence(simulationId)) return false;
  const parties = getParties(simulationId);
  const { share, lead, partners } = governmentBlocPollShare(
    simulationId,
    parties
  );
  if (!lead?.is_government) return false;
  if (share >= GOV_POLL_CENSURE_THRESHOLD) return false;
  const bloc = new Set([lead.id, ...partners.map((p) => p.id)]);
  if (bloc.has(partyId)) return false;
  const opp = strongestOpposition(simulationId, parties);
  return opp?.id === partyId;
}
