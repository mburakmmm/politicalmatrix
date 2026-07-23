import { getDb, getSetting } from "./client";
import {
  ensureDefaultSettings,
  getActiveBill,
  getActiveSimulation,
  getAlliances,
  getMetrics,
  getParties,
  getPollHistory,
  getRecentBills,
  getAllEvents,
  getVotesForBill,
  createNewSimulation,
  getAcceptedAlliancePartners,
} from "./repository";
import {
  listLlmModels,
  getLlmProvider,
  providerLabel,
  OPENROUTER_DEFAULT_BASE,
} from "../ai/llmProvider";
import { governmentSeatTotal, hasMajority } from "../sim/parliament";
import { getRegime, ensureRegimeRow } from "../sim/regime";
import { getMinistries } from "../sim/ministries";
import { getRegions, getLatestRegionalSupports } from "../sim/regions";
import { getIdeology, getPartySummary } from "../sim/ideology";
import { getMonthDiffs } from "../sim/monthDiff";
import { getAlmanac } from "../sim/almanac";
import { getAttitudes, stanceLabel } from "../sim/attitudes";
import { describeBillImpact } from "../sim/billEffects";
import { getCommitteeBills, getLawGroupStates } from "../sim/lawEngine";
import { SCENARIO_PACKS } from "../sim/scenarios";
import { ministriesHeldBy } from "../sim/ministries";
import type {
  BillPublic,
  DecisionExplain,
  EventPublic,
  LatencyStat,
  SimulationState,
} from "../types";

export async function buildSimulationState(): Promise<SimulationState> {
  ensureDefaultSettings();
  let sim = getActiveSimulation();
  if (!sim) {
    sim = createNewSimulation();
  }

  ensureRegimeRow(sim.id);
  const regime = getRegime(sim.id);
  const parties = getParties(sim.id);
  const metrics = getMetrics(sim.id);
  const activeBillRow = getActiveBill(sim.id);
  const recentBillRows = getRecentBills(sim.id, 8);
  const alliances = getAlliances(sim.id);
  const events = getAllEvents(sim.id);
  const pollRows = getPollHistory(sim.id);
  const ministries = getMinistries(sim.id);
  const regions = getRegions(sim.id);
  const regionalSupports = getLatestRegionalSupports(sim.id, sim.month);
  const monthDiffs = getMonthDiffs(sim.id, 20);

  const lm = await listLlmModels();
  const llmProvider = getLlmProvider();
  const openrouterKey =
    getSetting("openrouter_api_key") || process.env.OPENROUTER_API_KEY || "";

  let modelMap: Record<string, string> = {};
  try {
    modelMap = JSON.parse(getSetting("model_map", "{}"));
  } catch {
    modelMap = {};
  }

  const toBillPublic = (b: (typeof recentBillRows)[0]): BillPublic => {
    const votes = getVotesForBill(b.id);
    const proposer = parties.find((p) => p.id === b.proposer_id);
    return {
      ...b,
      proposer_name: proposer?.name,
      votes: votes.map((v) => {
        const p = parties.find((x) => x.id === v.party_id);
        return {
          party_id: v.party_id,
          party_name: p?.name ?? "?",
          party_color: p?.color ?? "#999",
          vote: v.vote,
          speech_text: v.speech_text,
        };
      }),
    };
  };

  const gov = parties.find((p) => p.is_government);
  const leadId = sim.mandate_party_id ?? gov?.id ?? null;
  const partners = leadId ? getAcceptedAlliancePartners(sim.id, leadId) : [];
  const governmentSeats = governmentSeatTotal(parties, partners, leadId);

  const monthMap = new Map<number, Record<string, number>>();
  for (const row of pollRows) {
    const existing = monthMap.get(row.month) ?? {};
    existing[row.party_slug] = row.poll_share;
    monthMap.set(row.month, existing);
  }
  const pollHistory = [...monthMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, shares]) => ({ month, shares }));

  const parsedEvents: EventPublic[] = events.map((e) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(e.payload);
    } catch {
      payload = { raw: e.payload };
    }
    return {
      id: e.id,
      type: e.type,
      payload,
      month: e.month,
      created_at: e.created_at,
    };
  });

  const decisions: DecisionExplain[] = parsedEvents
    .filter((e) => e.type === "decision" || e.type === "vote_cast")
    .slice(-30)
    .reverse()
    .map((e) => ({
      id: e.id,
      month: e.month,
      party_name: String(e.payload.partyName || "?"),
      party_color: String(e.payload.partyColor || "#888"),
      tool: String(e.payload.tool || e.type),
      rationale: String(
        e.payload.rationale ||
          e.payload.speechText ||
          e.payload.message ||
          ""
      ),
      args: (e.payload.args as Record<string, unknown>) || {},
    }));

  const latencyRows = getDb()
    .prepare(
      `SELECT * FROM agent_latency WHERE simulation_id = ?
       ORDER BY created_at DESC LIMIT 24`
    )
    .all(sim.id) as Array<{
    party_id: string | null;
    model_id: string | null;
    month: number;
    duration_ms: number;
    tool_calls: number;
    ok: number;
    error: string | null;
  }>;

  const latency: LatencyStat[] = latencyRows.map((r) => ({
    party_id: r.party_id,
    party_name: parties.find((p) => p.id === r.party_id)?.name,
    model_id: r.model_id,
    month: r.month,
    duration_ms: r.duration_ms,
    tool_calls: r.tool_calls,
    ok: !!r.ok,
    error: r.error,
  }));

  const negotiations = (
    getDb()
      .prepare(
        `SELECT * FROM negotiations WHERE simulation_id = ?
         AND status IN ('open','accepted') ORDER BY updated_month DESC LIMIT 10`
      )
      .all(sim.id) as Array<{
      id: string;
      from_party_id: string;
      to_party_id: string;
      round: number;
      offer_json: string;
      status: string;
    }>
  ).map((n) => ({
    id: n.id,
    from_name: parties.find((p) => p.id === n.from_party_id)?.name ?? "?",
    to_name: parties.find((p) => p.id === n.to_party_id)?.name ?? "?",
    round: n.round,
    offer: JSON.parse(n.offer_json || "{}") as Record<string, unknown>,
    status: n.status,
  }));

  const activeConfidence =
    (getDb()
      .prepare(
        `SELECT * FROM confidence_motions WHERE simulation_id = ? AND status = 'voting' LIMIT 1`
      )
      .get(sim.id) as SimulationState["activeConfidence"]) ?? null;

  const yearInTerm = Math.floor((sim.month - 1) / 12) + 1;
  const monthInYear = ((sim.month - 1) % 12) + 1;

  return {
    simulation: {
      id: sim.id,
      term: sim.term,
      month: sim.month,
      yearLabel: `Yıl ${yearInTerm} / Ay ${monthInYear}`,
      speed: sim.speed,
      status: sim.status,
      phase: sim.phase,
      pending_crisis: sim.pending_crisis,
      seed: sim.seed,
      tick_mode: sim.tick_mode || "hybrid",
      observer_model_id: sim.observer_model_id ?? null,
      scenario_id: sim.scenario_id ?? null,
    },
    regime: {
      regime_type: regime.regime_type,
      regime_label: regime.regime_label,
      constitution_strength: regime.constitution_strength,
      secularism: regime.secularism,
      civil_liberties: regime.civil_liberties,
      press_freedom: regime.press_freedom,
      parliament_dissolved: !!regime.parliament_dissolved,
      elections_suspended: !!regime.elections_suspended,
      state_religion: regime.state_religion,
      ruling_doctrine: regime.ruling_doctrine,
      monarch_title: regime.monarch_title,
      transformed_at_month: regime.transformed_at_month,
      transformation_notes: regime.transformation_notes,
    },
    parties: parties.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      color: p.color,
      ideology: p.ideology,
      seats: p.seats,
      poll_share: p.poll_share,
      model_id: p.model_id,
      is_government: !!p.is_government,
      is_formateur: sim.mandate_party_id === p.id,
      system_prompt: p.system_prompt,
      ideology_vector: getIdeology(p.id) ?? undefined,
      summary: getPartySummary(p.id),
      ministries: ministriesHeldBy(sim.id, p.id),
    })),
    metrics: {
      economy: metrics.economy,
      freedom: metrics.freedom,
      security: metrics.security,
      fear: metrics.fear,
      inflation: metrics.inflation,
      unemployment: metrics.unemployment,
    },
    activeBill: activeBillRow ? toBillPublic(activeBillRow) : null,
    activeConfidence,
    recentBills: recentBillRows.map(toBillPublic),
    alliances: alliances.map((a) => {
      const from = parties.find((p) => p.id === a.from_party_id);
      const to = parties.find((p) => p.id === a.to_party_id);
      return {
        id: a.id,
        from_party_id: a.from_party_id,
        to_party_id: a.to_party_id,
        from_name: from?.name ?? "?",
        to_name: to?.name ?? "?",
        concessions: a.concessions,
        status: a.status,
        created_month: a.created_month,
      };
    }),
    ministries: ministries.map((m) => ({
      ...m,
      holder_name: parties.find((p) => p.id === m.holder_party_id)?.name ?? null,
    })),
    regions: regions.map((r) => ({
      id: r.id,
      city_id: r.city_id,
      name: r.name,
      population_weight: r.population_weight,
      economy: r.economy,
      unrest: r.unrest,
      religiosity: r.religiosity,
      supports: parties.map((p) => ({
        party_id: p.id,
        party_name: p.name,
        color: p.color,
        support:
          regionalSupports.find(
            (s) => s.region_id === r.id && s.party_id === p.id
          )?.support ?? p.poll_share,
      })),
    })),
    negotiations,
    events: parsedEvents,
    pollHistory,
    monthDiffs,
    latency,
    recentDecisions: decisions,
    podium: decisions[0] ?? null,
    governmentSeats,
    majority: hasMajority(governmentSeats),
    lmConnected: lm.connected,
    lmModels: lm.models,
    llmProvider,
    llmProviderLabel: providerLabel(llmProvider),
    settings: {
      llm_provider: llmProvider,
      lm_base_url: getSetting(
        "lm_base_url",
        process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1"
      ),
      openrouter_base_url: getSetting(
        "openrouter_base_url",
        process.env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE
      ),
      openrouter_api_key: openrouterKey,
      openrouter_api_key_set: Boolean(openrouterKey.trim()),
      model_map: modelMap,
      observer_model_id: getSetting("observer_model_id", ""),
    },
    scenarios: SCENARIO_PACKS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
    almanac: getAlmanac(sim.id, 35),
    attitudes: getAttitudes(sim.id).map((a) => {
      const from = parties.find((p) => p.id === a.from_party_id);
      const to = parties.find((p) => p.id === a.to_party_id);
      return {
        from_party_id: a.from_party_id,
        to_party_id: a.to_party_id,
        from_name: from?.name ?? "?",
        to_name: to?.name ?? "?",
        from_color: from?.color ?? "#888",
        to_color: to?.color ?? "#888",
        score: a.score,
        stance: a.stance,
        stance_label: stanceLabel(a.stance),
        note: a.note,
      };
    }),
    lawGroups: getLawGroupStates(sim.id).map((s) => ({
      group_key: s.group_key,
      law_id: s.law_id,
      title: s.title,
      tier: s.tier,
      enacted_month: s.enacted_month,
    })),
    committeeBills: getCommitteeBills(sim.id).map((b) => ({
      ...b,
      proposer_name: parties.find((p) => p.id === b.proposer_id)?.name,
    })),
    billImpact: activeBillRow ? describeBillImpact(activeBillRow) : null,
  };
}
