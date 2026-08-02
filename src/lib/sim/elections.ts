import {
  getParties,
  getParty,
  getSimulation,
  insertEvent,
  insertPollSnapshot,
  mulberry32,
  updateParty,
  updateSimulation,
} from "../db/repository";
import { allocateSeatsDhondt, normalizePollShares } from "./parliament";
import type { SimulationRow } from "../types";
import { MAJORITY_THRESHOLD, TERM_MONTHS } from "../types";
import { regimeAllowsElections } from "./regime";
import { seedMinistries } from "./ministries";
import { logAlmanac } from "./almanac";
import { getDb } from "../db/client";
import {
  clearMandate,
  grantFormateurMandate,
} from "./mandate";

export function shouldHoldScheduledElection(month: number): boolean {
  return month > 1 && (month - 1) % TERM_MONTHS === 0;
}

/** Seçim = temiz sayfa: eski ittifak ve müzakereler düşer, yeniden değerlendirilir */
function resetCoalitionsAfterElection(simulationId: string, month: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE alliances SET status = 'broken'
     WHERE simulation_id = ? AND status IN ('accepted', 'pending')`
  ).run(simulationId);
  db.prepare(
    `UPDATE negotiations SET status = 'failed'
     WHERE simulation_id = ? AND status = 'open'`
  ).run(simulationId);
  // Açık yasalar seçimle düşer — yeni mecliste koalisyonu kesmesin
  db.prepare(
    `UPDATE bills SET status = 'rejected', resolved_month = ?
     WHERE simulation_id = ? AND status IN ('voting', 'in_committee', 'proposed')`
  ).run(month, simulationId);
  insertEvent(
    simulationId,
    "alliance_broken",
    {
      message:
        "Seçim sonrası: önceki ittifak, müzakereler ve açık yasalar düştü. Koalisyon yeniden değerlendirilecek.",
    },
    month
  );
  logAlmanac({
    simulationId,
    month,
    kind: "election",
    title: "Seçim — koalisyon masası sıfırlandı",
    detail:
      "Kabul edilmiş ittifaklar, açık müzakereler ve genel kurul/komisyon yasaları geçersiz. Yeni meclis aritmetiğine göre yeniden pazarlık gerekir.",
  });
}

export function runElection(
  sim: SimulationRow,
  reason: string,
  opts?: { countAsNewTerm?: boolean }
): void {
  if (!regimeAllowsElections(sim.id)) {
    insertEvent(
      sim.id,
      "election_blocked",
      {
        message:
          "Seçim engellendi: mevcut rejim seçimleri askıya aldı veya meclisi fesh etti.",
        reason,
      },
      sim.month
    );
    updateSimulation(sim.id, { phase: "regime_transition" });
    return;
  }

  // Önce eski koalisyon dünyasını kapat
  resetCoalitionsAfterElection(sim.id, sim.month);

  const rng = mulberry32(sim.seed + sim.month * 997);
  const parties = getParties(sim.id);

  const noisy = parties.map((p) => ({
    id: p.id,
    share: Math.max(3, p.poll_share + (rng() - 0.5) * 6),
  }));
  const normalized = normalizePollShares(
    noisy.map((n) => ({ id: n.id, poll_share: n.share }))
  );
  const seats = allocateSeatsDhondt(normalized);

  let largest: { id: string; seats: number } | null = null;
  for (const p of parties) {
    const s = seats[p.id] ?? 0;
    const share =
      normalized.find((n) => n.id === p.id)?.share ?? p.poll_share;
    updateParty(p.id, {
      seats: s,
      poll_share: Number(share.toFixed(2)),
      is_government: 0,
    });
    if (!largest || s > largest.seats) largest = { id: p.id, seats: s };
  }

  const updated = getParties(sim.id);
  insertPollSnapshot(sim.id, sim.month, updated);

  const bumpTerm = opts?.countAsNewTerm !== false;
  const aloneMajority = !!largest && largest.seats >= MAJORITY_THRESHOLD;

  updateSimulation(sim.id, {
    term: bumpTerm ? sim.term + 1 : sim.term,
    term_start_month: bumpTerm ? sim.month : sim.term_start_month ?? 1,
    status: "running",
    pending_crisis: null,
  });

  if (aloneMajority && largest) {
    clearMandate(sim.id);
    updateParty(largest.id, { is_government: 1 });
    seedMinistries(sim.id, largest.id);
    updateSimulation(sim.id, {
      phase: "governing",
      gov_sealed_month: sim.month,
    });
  } else {
    grantFormateurMandate(getSimulation(sim.id)!, 1);
    updateSimulation(sim.id, { gov_sealed_month: null });
  }

  const finalParties = getParties(sim.id);
  const seatLine = finalParties
    .map((p) => `${p.name} ${p.seats}`)
    .join(" · ");
  const leader =
    finalParties.find((p) => p.is_government) ||
    (largest ? getParty(largest.id) : null);
  const majorityNote =
    leader && leader.seats >= MAJORITY_THRESHOLD && leader.is_government
      ? `${leader.name} tek başına çoğunluk sağladı (${leader.seats}/${MAJORITY_THRESHOLD}).`
      : largest
        ? `${getParty(largest.id)?.name || "?"} en büyük parti (${largest.seats} sandalye) — Cumhurbaşkanı hükümet kurma görevini verdi; koalisyon görüşmeleri başlıyor.`
        : "İktidar belirsiz.";

  insertEvent(
    sim.id,
    "election_result",
    {
      message: `${reason}: ${seatLine}. ${majorityNote}`,
      reason,
      results: finalParties.map((p) => ({
        name: p.name,
        seats: p.seats,
        poll_share: p.poll_share,
        is_government: !!p.is_government,
      })),
      leaderName: leader?.name ?? null,
      leaderSeats: leader?.seats ?? 0,
    },
    sim.month
  );

  if (largest && !aloneMajority) {
    const leaderParty = getParty(largest.id);
    insertEvent(
      sim.id,
      "coalition_needed",
      {
        message: `${leaderParty?.name || "En büyük parti"} ${largest.seats} sandalye ile azınlıkta. ${MAJORITY_THRESHOLD} için en az ${MAJORITY_THRESHOLD - largest.seats} sandalye daha lazım. Önce formateur koalisyon dener; başarısız olursa görev sıradaki partiye geçer.`,
        seatsShort: MAJORITY_THRESHOLD - largest.seats,
        leaderSeats: largest.seats,
      },
      sim.month
    );
  }
}
