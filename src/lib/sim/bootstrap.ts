import { getDb } from "../db/client";
import {
  getParties,
  insertEvent,
  insertPollSnapshot,
} from "../db/repository";
import { ensureRegimeRow } from "./regime";
import { seedMinistriesVacant } from "./ministries";
import { seedRegions } from "./regions";
import { seedIdeology, ensureSummaryRow } from "./ideology";
import { getScenario } from "./scenarios";
import { REGIME_LABELS, type RegimeType } from "../types";
import { seedAttitudes } from "./attitudes";
import { logAlmanac } from "./almanac";
import { getLaw } from "./laws/catalog";
import { enactLaw } from "./lawEngine";

/** Başlangıç: her grupta orta kademe (tier 3) yürürlükte — V3 varsayılanı */
function seedDefaultLaws(simulationId: string): void {
  const defaults = [
    "economy_t3",
    "taxation_t3",
    "trade_t3",
    "labor_t3",
    "welfare_t3",
    "citizenship_t3",
    "civil_rights_t3",
    "policing_t3",
    "military_t3",
    "church_t3",
    "education_t3",
    "media_t4",
    "judiciary_t3",
    "healthcare_t3",
    "environment_t3",
    "agriculture_t2",
    "housing_t2",
    "foreign_t3",
    "migration_t3",
    "constitution_t3",
    "regime_t1",
    "technology_t3",
    "culture_t3",
    "local_gov_t3",
    "energy_t2",
    "infrastructure_t3",
    "banking_t3",
    "elections_t3",
    "intelligence_t3",
    "family_t3",
  ];
  for (const id of defaults) {
    const law = getLaw(id);
    if (law) enactLaw(simulationId, law, 1);
  }
}

/** Call after parties+metrics inserted into a new simulation */
export function finalizeNewSimulation(
  simId: string,
  opts: {
    seed: number;
    seatPlan: number[];
    scenarioId?: string;
  }
): void {
  const scenario = opts.scenarioId
    ? getScenario(opts.scenarioId)
    : getScenario("balanced");

  ensureRegimeRow(simId);
  if (scenario?.regime && scenario.regime in REGIME_LABELS) {
    getDb()
      .prepare(
        `UPDATE regime_state SET regime_type = ?, regime_label = ? WHERE simulation_id = ?`
      )
      .run(
        scenario.regime,
        REGIME_LABELS[scenario.regime as RegimeType],
        simId
      );
  }

  const parties = getParties(simId);
  seedMinistriesVacant(simId);
  seedRegions(simId, parties);
  for (const p of parties) {
    seedIdeology(p);
    ensureSummaryRow(p.id);
  }
  seedAttitudes(simId);
  seedDefaultLaws(simId);

  insertEvent(
    simId,
    "simulation_started",
    {
      message:
        "Yeni dönem: Sol, Merkez ve Sağ eşit ankette (%33.3). İktidar yok — 1. ay kampanya + mini seçimle sandalye ve hükümet belirlenecek. Ülke demokraside kilitli değil.",
      seed: opts.seed,
      seats: opts.seatPlan,
      scenario: scenario?.id,
      equal_start: true,
    },
    1
  );

  logAlmanac({
    simulationId: simId,
    month: 1,
    kind: "era",
    title: "Dönem açıldı",
    detail:
      "Eşit başlangıç. Partiler arası bakış açıları oluştu. 150+ katalog yasası orta kademede yürürlükte; AI proposeLaw ile değiştirir, özgür slot kotası sınırlı.",
  });

  insertPollSnapshot(simId, 1, parties);

  insertEvent(
    simId,
    "inaugural_election_pending",
    {
      message:
        "Kurucu mini seçim bekleniyor. Partiler miting ve algı ile oy toplayacak; ay sonunda sandık.",
    },
    1
  );
}
