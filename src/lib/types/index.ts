export type SimStatus = "idle" | "running" | "paused" | "election";
export type SimPhase =
  | "governing"
  | "voting"
  | "election"
  | "coalition_talks"
  | "crisis"
  | "confidence"
  | "negotiation"
  | "regime_transition";

export type TickMode = "sequential" | "hybrid" | "parallel_intent";

export type BillStatus =
  | "proposed"
  | "voting"
  | "in_committee"
  | "passed"
  | "rejected"
  | "vetoed_aym";

export type VoteChoice = "YES" | "NO" | "ABSTAIN";
export type AllianceStatus = "pending" | "accepted" | "rejected" | "broken";

export type MetricKey =
  | "economy"
  | "freedom"
  | "security"
  | "fear"
  | "inflation"
  | "unemployment";

export type BillCategory =
  | "economy"
  | "freedom"
  | "security"
  | "welfare"
  | "media"
  | "judiciary"
  | "foreign"
  | "constitutional"
  | "religious"
  | "revolutionary";

export type RallyTone = "POPULIST" | "RADICAL" | "MODERATE";
export type ScandalType = "corruption" | "nepotism" | "espionage" | "ethics";
export type PRStance = "resign" | "deny" | "reform";
export type CrisisType =
  | "economic_crisis"
  | "aym_veto"
  | "corruption_scandal"
  | "revolutionary_moment"
  | "theocratic_surge"
  | null;

/** Ülke herhangi bir forma evrilebilir — demokrasi kilidi yok */
export type RegimeType =
  | "parliamentary_republic"
  | "presidential_republic"
  | "constitutional_monarchy"
  | "absolute_monarchy"
  | "theocracy"
  | "caliphate"
  | "socialist_republic"
  | "communist_state"
  | "fascist_state"
  | "military_junta"
  | "one_party_state"
  | "anarcho_commune"
  | "technocratic_state"
  | "confederation";

export const REGIME_LABELS: Record<RegimeType, string> = {
  parliamentary_republic: "Parlamenter Cumhuriyet",
  presidential_republic: "Başkanlık Cumhuriyeti",
  constitutional_monarchy: "Anayasal Monarşi",
  absolute_monarchy: "Mutlak Monarşi / Krallık",
  theocracy: "Teokratik Devlet",
  caliphate: "Hilafet / Dini Egemenlik",
  socialist_republic: "Sosyalist Cumhuriyet",
  communist_state: "Komünist Devlet",
  fascist_state: "Faşist / Ulusalcı Otoriter Devlet",
  military_junta: "Askeri Cunta",
  one_party_state: "Tek Parti Devleti",
  anarcho_commune: "Anarko-Komün / Devletsiz Düzen",
  technocratic_state: "Teknokratik Devlet",
  confederation: "Konfederasyon",
};

export const MINISTRY_DEFS = [
  { key: "interior", title: "İçişleri Bakanlığı" },
  { key: "finance", title: "Hazine ve Maliye" },
  { key: "justice", title: "Adalet Bakanlığı" },
  { key: "defense", title: "Milli Savunma" },
  { key: "education", title: "Milli Eğitim" },
  { key: "media", title: "İletişim / Medya" },
  { key: "religious", title: "Din İşleri / İnanç" },
  { key: "labor", title: "Çalışma ve Sosyal Güvenlik" },
] as const;

export type MinistryKey = (typeof MINISTRY_DEFS)[number]["key"];

export interface SimulationRow {
  id: string;
  term: number;
  month: number;
  speed: number;
  status: SimStatus;
  seed: number;
  phase: SimPhase;
  pending_crisis: CrisisType | string | null;
  tick_mode?: TickMode | string;
  observer_model_id?: string | null;
  scenario_id?: string | null;
  term_start_month?: number;
  mandate_party_id?: string | null;
  mandate_rank?: number;
  mandate_started_month?: number | null;
  mandate_duration_months?: number;
  created_at: string;
  updated_at: string;
}

export interface PartyRow {
  id: string;
  simulation_id: string;
  slug: string;
  name: string;
  color: string;
  ideology: string;
  seats: number;
  poll_share: number;
  model_id: string | null;
  system_prompt: string;
  is_government: number;
}

export interface MetricsRow {
  simulation_id: string;
  economy: number;
  freedom: number;
  security: number;
  fear: number;
  inflation: number;
  unemployment: number;
}

export interface RegimeRow {
  simulation_id: string;
  regime_type: RegimeType | string;
  regime_label: string;
  constitution_strength: number;
  secularism: number;
  civil_liberties: number;
  press_freedom: number;
  parliament_dissolved: number;
  elections_suspended: number;
  state_religion: string | null;
  ruling_doctrine: string | null;
  monarch_title: string | null;
  transformed_at_month: number | null;
  transformation_notes: string | null;
}

export interface IdeologyRow {
  party_id: string;
  econ_left_right: number;
  auth_liberty: number;
  secular_religious: number;
  nation_global: number;
  radicalism: number;
  media_power: number;
}

export interface MinistryRow {
  id: string;
  simulation_id: string;
  key: string;
  title: string;
  holder_party_id: string | null;
  influence: number;
}

export interface RegionRow {
  id: string;
  simulation_id: string;
  city_id: string;
  name: string;
  population_weight: number;
  economy: number;
  unrest: number;
  religiosity: number;
}

export interface BillRow {
  id: string;
  simulation_id: string;
  title: string;
  category: string;
  target_metric: string;
  impact_value: number;
  status: BillStatus | string;
  proposer_id: string;
  yes_votes: number;
  no_votes: number;
  abstain_votes: number;
  created_month: number;
  resolved_month: number | null;
  debate_months_required?: number;
  debate_progress?: number;
  is_regime_change?: number;
  proposed_regime?: string | null;
  law_id?: string | null;
  law_group?: string | null;
  is_custom?: number;
  template_id?: string | null;
  deltas_json?: string;
  gains_text?: string;
  losses_text?: string;
}

export interface VoteRow {
  id: string;
  bill_id: string;
  party_id: string;
  vote: VoteChoice | string;
  speech_text: string;
}

export interface AllianceRow {
  id: string;
  simulation_id: string;
  from_party_id: string;
  to_party_id: string;
  concessions: string;
  status: AllianceStatus | string;
  created_month: number;
}

export interface EventRow {
  id: string;
  simulation_id: string;
  type: string;
  payload: string;
  month: number;
  created_at: string;
}

export interface PollHistoryRow {
  id: string;
  simulation_id: string;
  month: number;
  party_slug: string;
  poll_share: number;
}

export interface NegotiationRow {
  id: string;
  simulation_id: string;
  from_party_id: string;
  to_party_id: string;
  round: number;
  offer_json: string;
  status: string;
  created_month: number;
  updated_month: number;
}

export interface ConfidenceMotionRow {
  id: string;
  simulation_id: string;
  motion_type: string;
  initiator_id: string;
  target_party_id: string | null;
  status: string;
  yes_votes: number;
  no_votes: number;
  created_month: number;
  resolved_month: number | null;
}

export interface PartyPublic {
  id: string;
  slug: string;
  name: string;
  color: string;
  ideology: string;
  seats: number;
  poll_share: number;
  model_id: string | null;
  is_government: boolean;
  is_formateur?: boolean;
  system_prompt: string;
  ideology_vector?: IdeologyRow;
  summary?: string;
  ministries?: string[];
}

export interface BillPublic extends BillRow {
  proposer_name?: string;
  votes?: Array<{
    party_id: string;
    party_name: string;
    party_color: string;
    vote: string;
    speech_text: string;
  }>;
}

export interface EventPublic {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  month: number;
  created_at: string;
}

export interface AlliancePublic {
  id: string;
  from_party_id: string;
  to_party_id: string;
  from_name: string;
  to_name: string;
  concessions: string;
  status: string;
  created_month: number;
}

export interface RegimePublic {
  regime_type: string;
  regime_label: string;
  constitution_strength: number;
  secularism: number;
  civil_liberties: number;
  press_freedom: number;
  parliament_dissolved: boolean;
  elections_suspended: boolean;
  state_religion: string | null;
  ruling_doctrine: string | null;
  monarch_title: string | null;
  transformed_at_month: number | null;
  transformation_notes: string | null;
}

export interface RegionPublic {
  id: string;
  city_id: string;
  name: string;
  population_weight: number;
  economy: number;
  unrest: number;
  religiosity: number;
  supports: Array<{ party_id: string; party_name: string; color: string; support: number }>;
}

export interface LatencyStat {
  party_id: string | null;
  party_name?: string;
  model_id: string | null;
  month: number;
  duration_ms: number;
  tool_calls: number;
  ok: boolean;
  error?: string | null;
}

export interface MonthDiff {
  month: number;
  changes: string[];
  metrics_delta?: Record<string, number>;
  regime_changed?: boolean;
}

export interface DecisionExplain {
  id: string;
  month: number;
  party_name: string;
  party_color: string;
  tool: string;
  rationale: string;
  args: Record<string, unknown>;
}

export interface SimulationState {
  simulation: {
    id: string;
    term: number;
    month: number;
    yearLabel: string;
    speed: number;
    status: SimStatus;
    phase: SimPhase;
    pending_crisis: string | null;
    seed: number;
    tick_mode: TickMode | string;
    observer_model_id: string | null;
    scenario_id: string | null;
  };
  regime: RegimePublic;
  parties: PartyPublic[];
  metrics: Omit<MetricsRow, "simulation_id">;
  activeBill: BillPublic | null;
  activeConfidence: ConfidenceMotionRow | null;
  recentBills: BillPublic[];
  alliances: AlliancePublic[];
  ministries: Array<MinistryRow & { holder_name?: string | null }>;
  regions: RegionPublic[];
  negotiations: Array<{
    id: string;
    from_name: string;
    to_name: string;
    round: number;
    offer: Record<string, unknown>;
    status: string;
  }>;
  events: EventPublic[];
  pollHistory: Array<{ month: number; shares: Record<string, number> }>;
  monthDiffs: MonthDiff[];
  latency: LatencyStat[];
  recentDecisions: DecisionExplain[];
  podium: DecisionExplain | null;
  governmentSeats: number;
  majority: boolean;
  lmConnected: boolean;
  lmModels: string[];
  llmProvider: "lm_studio" | "openrouter";
  llmProviderLabel: string;
  settings: {
    llm_provider: "lm_studio" | "openrouter";
    lm_base_url: string;
    openrouter_base_url: string;
    openrouter_api_key: string;
    openrouter_api_key_set: boolean;
    model_map: Record<string, string>;
    observer_model_id?: string;
  };
  scenarios: Array<{ id: string; name: string; description: string }>;
  almanac: Array<{
    id: string;
    month: number;
    kind: string;
    title: string;
    detail: string;
    deltas: Record<string, number>;
  }>;
  attitudes: Array<{
    from_party_id: string;
    to_party_id: string;
    from_name: string;
    to_name: string;
    from_color: string;
    to_color: string;
    score: number;
    stance: string;
    stance_label: string;
    note: string;
  }>;
  lawGroups: Array<{
    group_key: string;
    law_id: string;
    title: string;
    tier: number;
    enacted_month: number;
  }>;
  committeeBills: Array<{
    id: string;
    title: string;
    law_id: string | null;
    is_custom: number;
    debate_progress: number;
    debate_months_required: number;
    proposer_name?: string;
    created_month: number;
  }>;
  billImpact?: {
    summary: string;
    gains: string[];
    losses: string[];
    sideEffects: string[];
    regimeNote: string | null;
  } | null;
}

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export const TOTAL_SEATS = 600;
export const MAJORITY_THRESHOLD = 301;
export const TERM_MONTHS = 60;
export const MAX_TOOL_CALLS_PER_TURN = 3;
export const MAX_AGENT_MEMORY = 6;
export const MAX_MEMORY_CHARS = 220;
export const MAX_CONTEXT_CHARS = 1400;
export const MAX_NEGOTIATION_ROUNDS = 3;

export const CITIES = [
  "Ankara",
  "İstanbul",
  "İzmir",
  "Bursa",
  "Antalya",
  "Adana",
  "Konya",
  "Gaziantep",
  "Trabzon",
  "Diyarbakır",
] as const;

export const CITY_PROFILES: Record<
  (typeof CITIES)[number],
  { weight: number; religiosity: number; economy: number }
> = {
  Ankara: { weight: 0.1, religiosity: 45, economy: 55 },
  İstanbul: { weight: 0.22, religiosity: 40, economy: 62 },
  İzmir: { weight: 0.08, religiosity: 30, economy: 58 },
  Bursa: { weight: 0.07, religiosity: 50, economy: 54 },
  Antalya: { weight: 0.06, religiosity: 42, economy: 57 },
  Adana: { weight: 0.06, religiosity: 48, economy: 48 },
  Konya: { weight: 0.07, religiosity: 75, economy: 50 },
  Gaziantep: { weight: 0.06, religiosity: 65, economy: 49 },
  Trabzon: { weight: 0.05, religiosity: 60, economy: 46 },
  Diyarbakır: { weight: 0.06, religiosity: 70, economy: 40 },
};
