import {
  getMetrics,
  getRecentBills,
  getRecentEvents,
  getSimulation,
  insertEvent,
  mulberry32,
  updateMetrics,
  updateSimulation,
  clampMetric,
} from "../db/repository";
import type { CrisisType, SimulationRow } from "../types";
import { getDb } from "../db/client";
import { refreshGovernmentPhase } from "./coalitions";
import { needsCabinetFormation } from "./mandate";

export function maybeTriggerCrisis(sim: SimulationRow): CrisisType {
  const rng = mulberry32(sim.seed + sim.month * 131);
  const metrics = getMetrics(sim.id);

  if (sim.pending_crisis) return sim.pending_crisis as CrisisType;

  // Formateur / koalisyon sürecinde rastgele kriz yok — hükümet kurma öncelikli
  if (needsCabinetFormation(sim.id)) return null;

  if (metrics.inflation >= 60 && rng() < 0.55) {
    updateMetrics(sim.id, {
      economy: clampMetric(metrics.economy - 12),
      fear: clampMetric(metrics.fear + 15),
      unemployment: clampMetric(metrics.unemployment + 8),
      inflation: clampMetric(Math.min(95, metrics.inflation + 10)),
    });
    updateSimulation(sim.id, {
      pending_crisis: "economic_crisis",
      phase: "crisis",
    });
    insertEvent(
      sim.id,
      "crisis",
      {
        crisis: "economic_crisis",
        message:
          "Büyük Ekonomik Kriz: Enflasyon kontrol dışına çıktı. Muhalefet erken seçim baskısı yapabilir.",
      },
      sim.month
    );
    return "economic_crisis";
  }

  const passed = getRecentBills(sim.id, 5).filter(
    (b) => b.status === "passed" && b.resolved_month === sim.month - 1
  );
  if (passed.length && rng() < 0.08) {
    const bill = passed[0];
    getDb()
      .prepare(`UPDATE bills SET status = 'vetoed_aym' WHERE id = ?`)
      .run(bill.id);
    updateSimulation(sim.id, {
      pending_crisis: "aym_veto",
      phase: "crisis",
    });
    insertEvent(
      sim.id,
      "crisis",
      {
        crisis: "aym_veto",
        message: `Anayasa Mahkemesi iptali: "${bill.title}" yürürlükten kalktı. İktidar yargı reformu ile yanıt verebilir.`,
        billId: bill.id,
        billTitle: bill.title,
      },
      sim.month
    );
    return "aym_veto";
  }

  if (
    (metrics.fear >= 70 || metrics.unemployment >= 30 || metrics.economy <= 25) &&
    rng() < 0.2
  ) {
    updateSimulation(sim.id, {
      pending_crisis: "revolutionary_moment",
      phase: "crisis",
    });
    insertEvent(
      sim.id,
      "crisis",
      {
        crisis: "revolutionary_moment",
        message:
          "Devrimci Moment: Düzen sarsılıyor. Partiler seizePower / proposeRegimeChange ile krallık, teokrasi, komünizm veya faşizme yol açabilir.",
      },
      sim.month
    );
    return "revolutionary_moment";
  }

  if (metrics.fear >= 55 && rng() < 0.08) {
    updateSimulation(sim.id, {
      pending_crisis: "theocratic_surge",
      phase: "crisis",
    });
    insertEvent(
      sim.id,
      "crisis",
      {
        crisis: "theocratic_surge",
        message:
          "Dini Dalga: Sokaklar ve camiler hareketlendi. Teokrasi/hilafet teklifleri güç kazandı.",
      },
      sim.month
    );
    return "theocratic_surge";
  }

  if (rng() < 0.06) {
    updateSimulation(sim.id, {
      pending_crisis: "corruption_scandal",
      phase: "crisis",
    });
    insertEvent(
      sim.id,
      "crisis",
      {
        crisis: "corruption_scandal",
        message:
          "Yolsuzluk Skandalı: İktidar kanadında bir bakan skandala karıştı. issuePRStatement zorunlu.",
      },
      sim.month
    );
    return "corruption_scandal";
  }

  return null;
}

/** Kriz en az 2 ay sürer; corruption PR ile çözülene kadar açık kalır */
export function clearCrisisIfResolved(sim: SimulationRow): void {
  if (!sim.pending_crisis) return;

  if (sim.pending_crisis === "corruption_scandal") {
    return;
  }

  const recent = getRecentEvents(sim.id, 40).find((e) => e.type === "crisis");
  const startedMonth = recent?.month ?? sim.month;
  if (sim.month - startedMonth < 2) {
    return;
  }

  updateSimulation(sim.id, { pending_crisis: null });
  const fresh = getSimulation(sim.id);
  if (fresh) refreshGovernmentPhase(fresh);
}
