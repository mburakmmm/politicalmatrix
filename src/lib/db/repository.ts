import { getDb, getSetting, setSetting } from "./client";
import { DEFAULT_PARTY_DEFS } from "../ai/prompts";
import type {
  AllianceRow,
  BillRow,
  EventRow,
  MetricsRow,
  PartyRow,
  PollHistoryRow,
  SimulationRow,
  VoteRow,
} from "../types";
import { TOTAL_SEATS } from "../types";
import { getScenario } from "../sim/scenarios";
import { finalizeNewSimulation } from "../sim/bootstrap";

export function createId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function getActiveSimulation(): SimulationRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM simulations ORDER BY created_at DESC LIMIT 1`
      )
      .get() as SimulationRow | undefined) ?? null
  );
}

export function getSimulation(id: string): SimulationRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM simulations WHERE id = ?")
      .get(id) as SimulationRow | undefined) ?? null
  );
}

export function getParties(simulationId: string): PartyRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM parties WHERE simulation_id = ? ORDER BY seats DESC"
    )
    .all(simulationId) as PartyRow[];
}

export function getParty(id: string): PartyRow | null {
  return (
    (getDb().prepare("SELECT * FROM parties WHERE id = ?").get(id) as
      | PartyRow
      | undefined) ?? null
  );
}

export function getMetrics(simulationId: string): MetricsRow {
  return getDb()
    .prepare("SELECT * FROM metrics WHERE simulation_id = ?")
    .get(simulationId) as MetricsRow;
}

export function updateMetrics(
  simulationId: string,
  patch: Partial<Omit<MetricsRow, "simulation_id">>
): MetricsRow {
  const current = getMetrics(simulationId);
  const next = { ...current, ...patch };
  getDb()
    .prepare(
      `UPDATE metrics SET
        economy = ?, freedom = ?, security = ?, fear = ?,
        inflation = ?, unemployment = ?
       WHERE simulation_id = ?`
    )
    .run(
      clamp(next.economy),
      clamp(next.freedom),
      clamp(next.security),
      clamp(next.fear),
      clamp(next.inflation),
      clamp(next.unemployment),
      simulationId
    );
  return getMetrics(simulationId);
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number(n.toFixed(2))));
}

export function updateSimulation(
  id: string,
  patch: Partial<
    Pick<
      SimulationRow,
      | "term"
      | "month"
      | "speed"
      | "status"
      | "phase"
      | "pending_crisis"
      | "term_start_month"
      | "mandate_party_id"
      | "mandate_rank"
      | "mandate_started_month"
      | "mandate_duration_months"
    >
  >
): void {
  const current = getSimulation(id);
  if (!current) return;
  getDb()
    .prepare(
      `UPDATE simulations SET
        term = ?, month = ?, speed = ?, status = ?, phase = ?,
        pending_crisis = ?, term_start_month = ?,
        mandate_party_id = ?, mandate_rank = ?, mandate_started_month = ?,
        mandate_duration_months = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      patch.term ?? current.term,
      patch.month ?? current.month,
      patch.speed ?? current.speed,
      patch.status ?? current.status,
      patch.phase ?? current.phase,
      patch.pending_crisis === undefined
        ? current.pending_crisis
        : patch.pending_crisis,
      patch.term_start_month ?? current.term_start_month ?? 1,
      patch.mandate_party_id !== undefined
        ? patch.mandate_party_id
        : current.mandate_party_id ?? null,
      patch.mandate_rank !== undefined
        ? patch.mandate_rank
        : current.mandate_rank ?? 0,
      patch.mandate_started_month !== undefined
        ? patch.mandate_started_month
        : current.mandate_started_month ?? null,
      patch.mandate_duration_months !== undefined
        ? patch.mandate_duration_months
        : current.mandate_duration_months ?? 3,
      id
    );
}

export function updateParty(
  id: string,
  patch: Partial<
    Pick<
      PartyRow,
      | "seats"
      | "poll_share"
      | "model_id"
      | "system_prompt"
      | "is_government"
      | "name"
    >
  >
): void {
  const current = getParty(id);
  if (!current) return;
  getDb()
    .prepare(
      `UPDATE parties SET
        seats = ?, poll_share = ?, model_id = ?, system_prompt = ?,
        is_government = ?, name = ?
       WHERE id = ?`
    )
    .run(
      patch.seats ?? current.seats,
      patch.poll_share ?? current.poll_share,
      patch.model_id === undefined ? current.model_id : patch.model_id,
      patch.system_prompt ?? current.system_prompt,
      patch.is_government ?? current.is_government,
      patch.name ?? current.name,
      id
    );
}

export function insertEvent(
  simulationId: string,
  type: string,
  payload: Record<string, unknown>,
  month: number
): EventRow {
  const id = createId("evt");
  getDb()
    .prepare(
      `INSERT INTO events (id, simulation_id, type, payload, month)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, simulationId, type, JSON.stringify(payload), month);
  return getDb()
    .prepare("SELECT * FROM events WHERE id = ?")
    .get(id) as EventRow;
}

export function getRecentEvents(
  simulationId: string,
  limit = 80
): EventRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM events WHERE simulation_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(simulationId, limit) as EventRow[];
}

/** Tüm olaylar kronolojik (UI baştan sona) */
export function getAllEvents(simulationId: string): EventRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM events WHERE simulation_id = ?
       ORDER BY month ASC, created_at ASC, rowid ASC`
    )
    .all(simulationId) as EventRow[];
}

export function getActiveBill(simulationId: string): BillRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM bills WHERE simulation_id = ?
         AND status IN ('proposed', 'voting')
         ORDER BY created_month ASC LIMIT 1`
      )
      .get(simulationId) as BillRow | undefined) ?? null
  );
}

export function getBill(id: string): BillRow | null {
  return (
    (getDb().prepare("SELECT * FROM bills WHERE id = ?").get(id) as
      | BillRow
      | undefined) ?? null
  );
}

export function getRecentBills(
  simulationId: string,
  limit = 10
): BillRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM bills WHERE simulation_id = ?
       ORDER BY created_month DESC LIMIT ?`
    )
    .all(simulationId, limit) as BillRow[];
}

export function getVotesForBill(billId: string): VoteRow[] {
  return getDb()
    .prepare("SELECT * FROM votes WHERE bill_id = ?")
    .all(billId) as VoteRow[];
}

export function getAlliances(simulationId: string): AllianceRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM alliances WHERE simulation_id = ?
       AND status IN ('pending', 'accepted')
       ORDER BY created_month DESC`
    )
    .all(simulationId) as AllianceRow[];
}

export function getAcceptedAlliancePartners(
  simulationId: string,
  partyId: string
): string[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM alliances WHERE simulation_id = ? AND status = 'accepted'
       AND (from_party_id = ? OR to_party_id = ?)`
    )
    .all(simulationId, partyId, partyId) as AllianceRow[];
  return rows.map((r) =>
    r.from_party_id === partyId ? r.to_party_id : r.from_party_id
  );
}

export function insertPollSnapshot(
  simulationId: string,
  month: number,
  parties: PartyRow[]
): void {
  const stmt = getDb().prepare(
    `INSERT INTO poll_history (id, simulation_id, month, party_slug, poll_share)
     VALUES (?, ?, ?, ?, ?)`
  );
  const tx = getDb().transaction(() => {
    for (const p of parties) {
      stmt.run(createId("poll"), simulationId, month, p.slug, p.poll_share);
    }
  });
  tx();
}

export function getPollHistory(simulationId: string): PollHistoryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM poll_history WHERE simulation_id = ?
       ORDER BY month ASC`
    )
    .all(simulationId) as PollHistoryRow[];
}

export function appendAgentMemory(
  partyId: string,
  role: string,
  content: string,
  maxKeep = 6
): void {
  const clipped = content.slice(0, 220);
  getDb()
    .prepare(
      `INSERT INTO agent_memory (id, party_id, role, content) VALUES (?, ?, ?, ?)`
    )
    .run(createId("mem"), partyId, role, clipped);

  const extras = getDb()
    .prepare(
      `SELECT id FROM agent_memory WHERE party_id = ?
       ORDER BY created_at DESC LIMIT -1 OFFSET ?`
    )
    .all(partyId, maxKeep) as Array<{ id: string }>;

  if (extras.length) {
    const del = getDb().prepare("DELETE FROM agent_memory WHERE id = ?");
    for (const e of extras) del.run(e.id);
  }
}

export function clearAgentMemory(partyId: string): void {
  getDb().prepare("DELETE FROM agent_memory WHERE party_id = ?").run(partyId);
}

export function getAgentMemory(
  partyId: string,
  limit = 4
): Array<{ role: string; content: string }> {
  const rows = getDb()
    .prepare(
      `SELECT role, content FROM agent_memory WHERE party_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(partyId, limit) as Array<{ role: string; content: string }>;
  return rows.reverse();
}

export function ensureDefaultSettings(): void {
  if (!getSetting("llm_provider")) {
    setSetting(
      "llm_provider",
      process.env.LLM_PROVIDER === "openrouter" ? "openrouter" : "lm_studio"
    );
  }
  if (!getSetting("lm_base_url")) {
    setSetting(
      "lm_base_url",
      process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1"
    );
  }
  if (!getSetting("openrouter_base_url")) {
    setSetting(
      "openrouter_base_url",
      process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
    );
  }
  if (!getSetting("openrouter_api_key") && process.env.OPENROUTER_API_KEY) {
    setSetting("openrouter_api_key", process.env.OPENROUTER_API_KEY);
  }
  if (!getSetting("model_map")) {
    setSetting(
      "model_map",
      JSON.stringify({
        left: "",
        center: "",
        right: "",
      })
    );
  } else {
    // Migrate legacy keys if present and new keys empty
    try {
      const map = JSON.parse(getSetting("model_map", "{}")) as Record<
        string,
        string
      >;
      if (!map.left && !map.center && !map.right) {
        const migrated = {
          left: map.reformist || map.left || "",
          center: map.populist || map.center || "",
          right: map.kingmaker || map.right || "",
        };
        if (migrated.left || migrated.center || migrated.right) {
          setSetting("model_map", JSON.stringify(migrated));
        } else {
          setSetting(
            "model_map",
            JSON.stringify({ left: "", center: "", right: "" })
          );
        }
      }
    } catch {
      setSetting(
        "model_map",
        JSON.stringify({ left: "", center: "", right: "" })
      );
    }
  }
}

export function createNewSimulation(options?: {
  seed?: number;
  modelMap?: Record<string, string>;
  speed?: number;
  scenarioId?: string;
  tickMode?: string;
  observerModelId?: string;
}): SimulationRow {
  ensureDefaultSettings();
  const db = getDb();
  const seed = options?.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const rng = mulberry32(seed);
  const simId = createId("sim");

  const scenario = options?.scenarioId
    ? getScenario(options.scenarioId)
    : getScenario("balanced");

  // Eşit başlangıç: %33.33 anket, 200 sandalye; iktidar yok — 1. ay mini seçim
  const equalShare = Number((100 / 3).toFixed(2));
  const equalSeats = Math.floor(TOTAL_SEATS / 3); // 200
  const seatRemainder = TOTAL_SEATS - equalSeats * 3; // 0

  db.prepare(
    `INSERT INTO simulations (
      id, term, month, speed, status, seed, phase, tick_mode, observer_model_id, scenario_id
    ) VALUES (?, 28, 1, ?, 'idle', ?, 'election', ?, ?, ?)`
  ).run(
    simId,
    options?.speed ?? 1,
    seed,
    options?.tickMode ?? "hybrid",
    options?.observerModelId ?? null,
    options?.scenarioId ?? scenario?.id ?? "balanced"
  );

  const baseMetrics = {
    economy: 48 + rng() * 12,
    freedom: 45 + rng() * 15,
    security: 50 + rng() * 10,
    fear: 25 + rng() * 15,
    inflation: 20 + rng() * 15,
    unemployment: 15 + rng() * 12,
    ...(scenario?.metrics ?? {}),
  };

  db.prepare(
    `INSERT INTO metrics (simulation_id, economy, freedom, security, fear, inflation, unemployment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    simId,
    baseMetrics.economy,
    baseMetrics.freedom,
    baseMetrics.security,
    baseMetrics.fear,
    baseMetrics.inflation,
    baseMetrics.unemployment
  );

  const modelMap =
    options?.modelMap ??
    (JSON.parse(getSetting("model_map", "{}")) as Record<string, string>);

  const insertParty = db.prepare(
    `INSERT INTO parties (
      id, simulation_id, slug, name, color, ideology, seats, poll_share,
      model_id, system_prompt, is_government
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  );

  DEFAULT_PARTY_DEFS.forEach((def, i) => {
    const seats = equalSeats + (i === 0 ? seatRemainder : 0);
    insertParty.run(
      createId("party"),
      simId,
      def.slug,
      def.name,
      def.color,
      def.ideology,
      seats,
      equalShare,
      modelMap[def.slug] || null,
      def.systemPrompt
    );
  });

  finalizeNewSimulation(simId, {
    seed,
    seatPlan: [equalSeats, equalSeats, equalSeats],
    scenarioId: options?.scenarioId ?? scenario?.id,
  });

  return getSimulation(simId)!;
}

export function resetDatabaseAndCreate(options?: {
  seed?: number;
  modelMap?: Record<string, string>;
  speed?: number;
  scenarioId?: string;
  tickMode?: string;
  observerModelId?: string;
}): SimulationRow {
  const db = getDb();
  db.exec(`
    DELETE FROM custom_bill_usage;
    DELETE FROM law_group_state;
    DELETE FROM pending_intents;
    DELETE FROM agent_latency;
    DELETE FROM month_snapshots;
    DELETE FROM confidence_votes;
    DELETE FROM confidence_motions;
    DELETE FROM negotiations;
    DELETE FROM regional_polls;
    DELETE FROM regions;
    DELETE FROM ministries;
    DELETE FROM ideology_vectors;
    DELETE FROM party_summaries;
    DELETE FROM party_attitudes;
    DELETE FROM almanac_entries;
    DELETE FROM regime_state;
    DELETE FROM agent_memory;
    DELETE FROM votes;
    DELETE FROM bills;
    DELETE FROM alliances;
    DELETE FROM events;
    DELETE FROM poll_history;
    DELETE FROM metrics;
    DELETE FROM parties;
    DELETE FROM simulations;
  `);
  return createNewSimulation(options);
}

export { clamp as clampMetric };
