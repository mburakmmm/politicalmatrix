import { getDb } from "../db/client";
import {
  getParties,
  insertEvent,
  updateMetrics,
  updateSimulation,
  clampMetric,
  getMetrics,
} from "../db/repository";
import type { RegimeRow, RegimeType, SimulationRow } from "../types";
import { REGIME_LABELS } from "../types";

export function getRegime(simulationId: string): RegimeRow {
  const row = getDb()
    .prepare("SELECT * FROM regime_state WHERE simulation_id = ?")
    .get(simulationId) as RegimeRow | undefined;
  if (row) return row;
  // Fallback if migration applied but row missing
  ensureRegimeRow(simulationId);
  return getDb()
    .prepare("SELECT * FROM regime_state WHERE simulation_id = ?")
    .get(simulationId) as RegimeRow;
}

export function ensureRegimeRow(simulationId: string): void {
  const exists = getDb()
    .prepare("SELECT 1 FROM regime_state WHERE simulation_id = ?")
    .get(simulationId);
  if (exists) return;
  getDb()
    .prepare(
      `INSERT INTO regime_state (simulation_id, regime_type, regime_label)
       VALUES (?, 'parliamentary_republic', ?)`
    )
    .run(simulationId, REGIME_LABELS.parliamentary_republic);
}

export function applyRegimeChange(
  sim: SimulationRow,
  newRegime: RegimeType,
  actorPartyId: string,
  notes: string,
  extras?: {
    state_religion?: string;
    ruling_doctrine?: string;
    monarch_title?: string;
  }
): RegimeRow {
  const dissolveParliament = [
    "absolute_monarchy",
    "military_junta",
    "fascist_state",
    "communist_state",
    "caliphate",
    "theocracy",
    "one_party_state",
  ].includes(newRegime);

  const suspendElections = [
    "absolute_monarchy",
    "military_junta",
    "fascist_state",
    "communist_state",
    "caliphate",
    "one_party_state",
  ].includes(newRegime);

  const label = REGIME_LABELS[newRegime] ?? newRegime;

  getDb()
    .prepare(
      `UPDATE regime_state SET
        regime_type = ?,
        regime_label = ?,
        parliament_dissolved = ?,
        elections_suspended = ?,
        state_religion = COALESCE(?, state_religion),
        ruling_doctrine = COALESCE(?, ruling_doctrine),
        monarch_title = COALESCE(?, monarch_title),
        transformed_at_month = ?,
        transformation_notes = ?,
        constitution_strength = ?,
        civil_liberties = ?,
        press_freedom = ?,
        secularism = ?
       WHERE simulation_id = ?`
    )
    .run(
      newRegime,
      label,
      dissolveParliament ? 1 : 0,
      suspendElections ? 1 : 0,
      extras?.state_religion ?? null,
      extras?.ruling_doctrine ?? null,
      extras?.monarch_title ?? null,
      sim.month,
      notes,
      dissolveParliament ? 15 : 40,
      dissolveParliament ? 20 : 45,
      dissolveParliament ? 15 : 40,
      newRegime === "theocracy" || newRegime === "caliphate" ? 10 : 40,
      sim.id
    );

  const metrics = getMetrics(sim.id);
  if (newRegime === "communist_state" || newRegime === "socialist_republic") {
    updateMetrics(sim.id, {
      unemployment: clampMetric(metrics.unemployment - 5),
      freedom: clampMetric(metrics.freedom - 15),
      fear: clampMetric(metrics.fear + 10),
    });
  } else if (newRegime === "fascist_state" || newRegime === "military_junta") {
    updateMetrics(sim.id, {
      security: clampMetric(metrics.security + 20),
      freedom: clampMetric(metrics.freedom - 25),
      fear: clampMetric(metrics.fear + 20),
    });
  } else if (newRegime === "theocracy" || newRegime === "caliphate") {
    updateMetrics(sim.id, {
      freedom: clampMetric(metrics.freedom - 20),
      fear: clampMetric(metrics.fear + 8),
      security: clampMetric(metrics.security + 5),
    });
  } else if (newRegime === "absolute_monarchy") {
    updateMetrics(sim.id, {
      freedom: clampMetric(metrics.freedom - 18),
      security: clampMetric(metrics.security + 10),
    });
  } else if (newRegime === "anarcho_commune") {
    updateMetrics(sim.id, {
      freedom: clampMetric(metrics.freedom + 25),
      security: clampMetric(metrics.security - 20),
      fear: clampMetric(metrics.fear + 15),
    });
  }

  // In authoritarian regimes, winner party absorbs seats if parliament dissolved
  if (dissolveParliament) {
    const parties = getParties(sim.id);
    const actor = parties.find((p) => p.id === actorPartyId);
    if (actor) {
      for (const p of parties) {
        getDb()
          .prepare(
            `UPDATE parties SET seats = ?, is_government = ? WHERE id = ?`
          )
          .run(p.id === actor.id ? 600 : 0, p.id === actor.id ? 1 : 0, p.id);
      }
    }
  }

  updateSimulation(sim.id, {
    phase: dissolveParliament ? "regime_transition" : "governing",
    pending_crisis: null,
  });

  insertEvent(sim.id, "regime_changed", {
    message: `ÜLKE DÖNÜŞTÜ: ${label}. ${notes}`,
    regime: newRegime,
    regime_label: label,
    actorPartyId,
    notes,
    parliament_dissolved: dissolveParliament,
    elections_suspended: suspendElections,
  }, sim.month);

  return getRegime(sim.id);
}

export function regimeAllowsElections(simulationId: string): boolean {
  const r = getRegime(simulationId);
  return !r.elections_suspended && !r.parliament_dissolved;
}

export function regimeAllowsParliament(simulationId: string): boolean {
  const r = getRegime(simulationId);
  return !r.parliament_dissolved;
}

export function isValidRegime(value: string): value is RegimeType {
  return value in REGIME_LABELS;
}
