import {
  getActiveBill,
  getActiveSimulation,
  getMetrics,
  getParties,
  getSimulation,
  getVotesForBill,
  insertEvent,
  insertPollSnapshot,
  mulberry32,
  updateSimulation,
} from "../db/repository";
import { runPartyTurn } from "../ai/partyAgent";
import { runObserverNarration } from "../ai/analyst";
import {
  driftMetrics,
  rebalancePollsFromMetrics,
} from "./metrics";
import { maybeTriggerCrisis, clearCrisisIfResolved } from "./crises";
import { refreshGovernmentPhase } from "./coalitions";
import {
  runElection,
  shouldHoldScheduledElection,
} from "./elections";
import { advanceCommitteeBills } from "../tools/executor";
import { syncLegislativePhase } from "./phase";
import {
  advanceFormateurMandateIfExpired,
} from "./mandate";
import { recomputeNationalFromRegions } from "./regions";
import { regimeAllowsElections } from "./regime";
import {
  captureMonthSnapshot,
  getPreviousSnapshotJson,
} from "./monthDiff";
import { getDb } from "../db/client";
import type { PartyRow, SimulationRow } from "../types";

function phaseLabelTr(phase: string): string {
  const map: Record<string, string> = {
    campaign: "kampanya",
    governing: "iktidar",
    coalition_talks: "koalisyon görüşmeleri",
    negotiation: "müzakere",
    election: "seçim",
    crisis: "kriz",
    regime_transition: "rejim geçişi",
    inaugural: "kurucu dönem",
  };
  return map[phase] || phase;
}

let ticking = false;

function orderedParties(simId: string): PartyRow[] {
  let parties = getParties(simId);
  parties = [
    ...parties.filter((p) => p.is_government),
    ...parties
      .filter((p) => !p.is_government)
      .sort((a, b) => b.seats - a.seats),
  ];
  const seen = new Set<string>();
  parties = parties.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const activeBill = getActiveBill(simId);
  if (activeBill) {
    const votes = getVotesForBill(activeBill.id);
    const voted = new Set(votes.map((v) => v.party_id));
    parties = [
      ...parties.filter((p) => !voted.has(p.id)),
      ...parties.filter((p) => voted.has(p.id)),
    ];
  }
  return parties;
}

async function runTurns(
  sim: SimulationRow,
  parties: PartyRow[]
): Promise<void> {
  // Yerel LM Studio eşzamanlı isteği çoğu modelde sessizce düşürür.
  // hybrid/parallel_intent bile seri çalışır (üretim güvenliği).
  void sim;
  for (const party of parties) {
    await runPartyTurn(party);
  }
}

export async function runSimulationTick(
  simulationId?: string
): Promise<{ ok: boolean; month: number; message: string }> {
  if (ticking) {
    return { ok: false, month: 0, message: "Tick zaten çalışıyor" };
  }
  ticking = true;

  try {
    const sim =
      (simulationId
        ? getSimulation(simulationId)
        : getActiveSimulation()) ?? null;
    if (!sim) {
      return { ok: false, month: 0, message: "Simülasyon yok" };
    }
    if (sim.status !== "running" && sim.status !== "election") {
      return {
        ok: false,
        month: sim.month,
        message: `Durum uygun değil: ${sim.status}`,
      };
    }

    let current = getSimulation(sim.id)!;

    insertEvent(
      current.id,
      "month_tick",
      {
        message: `${current.month}. ay — faz: ${phaseLabelTr(current.phase)}.`,
        month: current.month,
        phase: current.phase,
      },
      current.month
    );

    const rng = mulberry32(current.seed + current.month * 17);

    if (
      shouldHoldScheduledElection(current.month) &&
      regimeAllowsElections(current.id)
    ) {
      runElection(current, "5 yıllık olağan seçim");
      current = getSimulation(sim.id)!;
      updateSimulation(sim.id, { month: current.month + 1 });
      return {
        ok: true,
        month: getSimulation(sim.id)!.month,
        message: "Olağan seçim tamamlandı",
      };
    }

    advanceCommitteeBills(current.id, current.month);
    syncLegislativePhase(current.id);

    const mandateAdv = advanceFormateurMandateIfExpired(current.id);
    if (mandateAdv.exhausted) {
      insertEvent(
        current.id,
        "mandate_exhausted",
        {
          message: mandateAdv.message,
        },
        current.month
      );
      runElection(
        getSimulation(current.id)!,
        "Formateur süreci tükendi — zorunlu erken seçim"
      );
      current = getSimulation(sim.id)!;
      updateSimulation(sim.id, { month: current.month + 1 });
      return {
        ok: true,
        month: getSimulation(sim.id)!.month,
        message: "Formateur süreci tükendi, erken seçim yapıldı",
      };
    }
    current = getSimulation(sim.id)!;

    // Bozuk kendine-müzakere kayıtlarını kapat
    getDb()
      .prepare(
        `UPDATE negotiations SET status = 'failed'
         WHERE simulation_id = ? AND status = 'open' AND from_party_id = to_party_id`
      )
      .run(current.id);

    // İlk ay kampanyasında ağır kriz fırlatma
    if (!(current.month === 1 && current.phase === "election")) {
      maybeTriggerCrisis(current);
    }
    current = getSimulation(sim.id)!;

    const parties = orderedParties(current.id);
    await runTurns(current, parties);

    current = getSimulation(sim.id)!;

    // Kurucu mini seçim: ay 1 kampanya sonrası
    const noGovernment = getParties(current.id).every(
      (p) => !p.is_government
    );
    if (
      current.month === 1 &&
      noGovernment &&
      regimeAllowsElections(current.id)
    ) {
      recomputeNationalFromRegions(current.id, current.month);
      runElection(
        getSimulation(current.id)!,
        "Kurucu mini seçim (eşit başlangıç kampanyası)",
        { countAsNewTerm: false }
      );
      current = getSimulation(sim.id)!;
    }

    if (current.phase !== "election") {
      const metrics = driftMetrics(
        current.id,
        getMetrics(current.id),
        rng
      );
      recomputeNationalFromRegions(current.id, current.month);
      const updatedParties = rebalancePollsFromMetrics(
        current.id,
        getParties(current.id),
        metrics,
        rng
      );
      insertPollSnapshot(current.id, current.month, updatedParties);
      refreshGovernmentPhase(getSimulation(current.id)!);
      syncLegislativePhase(current.id);
      clearCrisisIfResolved(getSimulation(current.id)!);
    } else {
      // Hâlâ seçim fazıysa (seçim engellendi) anket snapshot al
      insertPollSnapshot(current.id, current.month, getParties(current.id));
    }

    current = getSimulation(sim.id)!;
    const prev = getPreviousSnapshotJson(current.id, current.month);
    captureMonthSnapshot(current.id, current.month, prev);

    await runObserverNarration(current.id);

    const finishedMonth = current.month;
    updateSimulation(sim.id, { month: finishedMonth + 1 });

    return {
      ok: true,
      month: finishedMonth,
      message: `Ay ${finishedMonth} tamamlandı`,
    };
  } finally {
    ticking = false;
  }
}

export function getTickLock(): boolean {
  return ticking;
}

export type { SimulationRow };
