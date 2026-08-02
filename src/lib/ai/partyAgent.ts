import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import { createLmClient } from "./lmStudio";
import { toolsForPhase, phaseHint, PARTY_TOOLS } from "./tools";
import { buildTurnUserPrompt, clipPartyIdeologyPrompt } from "./prompts";
import { executePartyTool } from "../tools/executor";
import {
  appendAgentMemory,
  clearAgentMemory,
  getAcceptedAlliancePartners,
  getActiveBill,
  getAgentMemory,
  getAlliances,
  getMetrics,
  getParties,
  getSimulation,
  getVotesForBill,
  insertEvent,
  updateSimulation,
} from "../db/repository";
import { describeAlliances } from "../sim/coalitions";
import {
  describeCoalitionStressForAgent,
  shouldForceBreakAlliance,
} from "../sim/coalitionStress";
import { isGovernmentBlocMember } from "../sim/resignation";
import {
  partnerMinistryQuota,
  preferredMinistriesForSlug,
} from "../sim/ministries";
import { canonicalizeToolName } from "./toolAliases";
import { getRegime } from "../sim/regime";
import { getMinistries } from "../sim/ministries";
import {
  describeIdeology,
  getIdeology,
  getPartySummary,
} from "../sim/ideology";
import {
  describeAttitudesForAgent,
  attitudeVoteBias,
} from "../sim/attitudes";
import { describeBillForAgent } from "../sim/billEffects";
import { describeLawsForAgent } from "../sim/lawEngine";
import { suggestLawsForParty } from "../sim/lawSuggestions";
import {
  defaultRallyFocusTopic,
  sanitizeRallyFocusTopic,
} from "../sim/rallyFocus";
import {
  buildAlignedBillSpeech,
  preferredVoteForParty,
  resolveLawForBill,
} from "../sim/voteIdeology";
import { defaultCityForSlug } from "../sim/cities";
import {
  describeMandateForAgent,
  getMandatePartyId,
  isFormateur,
  needsCabinetFormation,
} from "../sim/mandate";
import {
  describeNegotiationPressure,
  isPastSoftPhase,
  getOpenNegotiationTargeting,
  canOpenFreshNegotiation,
  pickCoalitionPartner,
  lastResortShouldAccept,
} from "../sim/negotiationPressure";
import { recordLatency } from "../sim/monthDiff";
import { MAX_CONTEXT_CHARS, MAX_TOOL_CALLS_PER_TURN } from "../types";
import type { PartyRow } from "../types";
import { getSetting, getDb } from "../db/client";
import {
  cleanSpeechText,
  looksLikeToolNarration,
  parseTextToolCalls,
  synthesizeToolFromIntent,
} from "./textToolParser";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getLlmProvider } from "./llmProvider";
import {
  buildNativeSystemPrompt,
  buildNativeUserSuffix,
  detectNativeToolProfile,
  parseNativeToolCalls,
  type NativeToolProfile,
} from "./nativeToolFormats";
import { enrichToolArgs, missingDecisionFields } from "./enrichToolArgs";
import {
  buildPathARecoveryHint,
  buildPathAUserTail,
  pathAMaxTokens,
  thinkingDisciplinePrefix,
  type DecisionHints,
} from "./smallModelCoach";

function shortId(id: string): string {
  const parts = id.split("_");
  const raw = parts[parts.length - 1] || id;
  return raw.slice(0, 8);
}

function getActiveConfidence(simulationId: string) {
  return getDb()
    .prepare(
      `SELECT id, motion_type FROM confidence_motions
       WHERE simulation_id = ? AND status = 'voting' LIMIT 1`
    )
    .get(simulationId) as { id: string; motion_type: string } | undefined;
}

function resolveEffectivePhase(
  party: PartyRow
): { phase: string; forceTool?: string; tools: ChatCompletionTool[] } {
  const sim = getSimulation(party.simulation_id)!;
  const bill = getActiveBill(party.simulation_id);
  const confidence = getActiveConfidence(party.simulation_id);
  const forming = needsCabinetFormation(party.simulation_id);

  // Kabine kurulurken yeni oylama önceliği yok — mevcut floor bill varsa oyla bitir
  if (bill && ["proposed", "voting"].includes(bill.status) && !forming) {
    const voted = getVotesForBill(bill.id).some(
      (v) => v.party_id === party.id
    );
    if (!voted) {
      if (sim.phase !== "voting") {
        updateSimulation(party.simulation_id, { phase: "voting" });
      }
      return {
        phase: "voting",
        forceTool: "voteOnBill",
        tools: toolsForPhase("voting"),
      };
    }
  }

  // Formateur sürecinde eski floor bill varsa bitir (takılı kalmasın), sonra koalisyon
  if (bill && ["proposed", "voting"].includes(bill.status) && forming) {
    const voted = getVotesForBill(bill.id).some(
      (v) => v.party_id === party.id
    );
    if (!voted) {
      return {
        phase: "voting",
        forceTool: "voteOnBill",
        tools: toolsForPhase("voting"),
      };
    }
  }

  if (confidence) {
    const voted = getDb()
      .prepare(
        `SELECT 1 FROM confidence_votes WHERE motion_id = ? AND party_id = ?`
      )
      .get(confidence.id, party.id);
    if (!voted) {
      if (sim.phase !== "confidence") {
        updateSimulation(party.simulation_id, { phase: "confidence" });
      }
      return {
        phase: "confidence",
        forceTool: "voteConfidence",
        tools: toolsForPhase("confidence"),
      };
    }
  }

  // Yolsuzluk krizi: PR zorunlu değil — menüden seçer (özgür RPG)
  // (pending_crisis context prompt'ta görünür)

  // Koalisyon stresi: breakAlliance zorunlu değil — auto-rupture fizik katmanında kalır
  // (shouldForceBreakAlliance yalnızca context/hint için kullanılabilir)

  // Kabine kurulumu
  if (forming) {
    if (sim.phase !== "coalition_talks" && sim.phase !== "negotiation") {
      updateSimulation(party.simulation_id, { phase: "coalition_talks" });
    }

    const coalitionBase = stripLegislationTools(toolsForPhase("coalition_talks"));

    // Zorunlu sınıf: size gelen açık masa → respond (accept/red serbest)
    const inbound = getOpenNegotiationTargeting(
      party.simulation_id,
      party.id
    );
    if (inbound) {
      return {
        phase: "coalition_talks",
        forceTool: "respondNegotiation",
        tools: filterToolsByNames(coalitionBase, [
          "respondNegotiation",
          "issuePRStatement",
        ]),
      };
    }

    const formateur = isFormateur(party.simulation_id, party.id);
    const openGate = canOpenFreshNegotiation(party.simulation_id, party.id);

    if (formateur && openGate.ok) {
      // Formateur masa açmalı — respondNegotiation menüde yok (Müzakere yok spam'i kes)
      return {
        phase: "coalition_talks",
        forceTool: "negotiateCoalition",
        tools: filterToolsByNames(coalitionBase, [
          "negotiateCoalition",
          "proposeAlliance",
        ]),
      };
    }

    // Formateur outbound bekliyor VEYA non-formateur: yalnız kampanya
    return {
      phase: "coalition_talks",
      forceTool: undefined,
      tools: filterToolsByNames(coalitionBase, [
        "holdRally",
        "issuePRStatement",
      ]),
    };
  }

  // Mühürlü dönem: tam menü — AI araç seçer (boş ay serbest)
  if (
    (sim.phase === "governing" ||
      sim.phase === "negotiation" ||
      sim.phase === "crisis") &&
    !needsCabinetFormation(party.simulation_id)
  ) {
    return {
      phase: "governing",
      forceTool: undefined,
      tools: toolsForPhase("governing"),
    };
  }

  return {
    phase: sim.phase,
    forceTool: undefined,
    tools: toolsForPhase(sim.phase),
  };
}

function stripLegislationTools(tools: ChatCompletionTool[]): ChatCompletionTool[] {
  const ban = new Set(["proposeLaw", "proposeCustomBill", "proposeBill"]);
  return tools.filter(
    (t) => !(t.type === "function" && ban.has(t.function.name))
  );
}

function filterToolsByNames(
  tools: ChatCompletionTool[],
  names: string[]
): ChatCompletionTool[] {
  const allow = new Set(names);
  return tools.filter(
    (t) => t.type === "function" && allow.has(t.function.name)
  );
}

function preferredRallyCity(slug: string): string {
  return defaultCityForSlug(slug);
}

function preferredRallyTone(slug: string): "POPULIST" | "RADICAL" | "MODERATE" {
  if (slug === "center") return "MODERATE";
  if (slug === "left") return "RADICAL";
  return "POPULIST";
}

/** Path A: modele karar menüsü — sistem seçmez, seçenek listeler */
function buildDecisionHintsForTurn(
  party: PartyRow,
  forceTool?: string
): DecisionHints {
  const hints: DecisionHints = { forceTool };
  const bill = getActiveBill(party.simulation_id);
  if (bill) {
    hints.billId = bill.id;
    hints.billTitle = bill.title;
    const law = resolveLawForBill(bill);
    // İdeoloji kısıtını menüde göster — yine model seçer
    const preferred = preferredVoteForParty(
      party.id,
      party.slug,
      law,
      bill.proposer_id === party.id,
      attitudeVoteBias(party.id, bill.proposer_id)
    );
    // Tüm enum'u sun; preferred sadece ipucu değil seçenek
    hints.voteChoices =
      bill.proposer_id === party.id
        ? ["YES"]
        : ["YES", "NO", "ABSTAIN"];
    // soft hint as bill title context only — don't remove choices
    void preferred;
  }

  const lawChoices = suggestLawsForParty(party.simulation_id, party.slug, 5).map(
    (l) => ({
      id: l.id,
      title: l.title,
    })
  );
  if (lawChoices.length) hints.lawChoices = lawChoices;

  hints.partyChoices = getParties(party.simulation_id)
    .filter((p) => p.id !== party.id)
    .map((p) => ({ id: p.id, slug: p.slug, name: p.name }));

  if (forceTool === "negotiateCoalition") {
    const best = pickCoalitionPartner(party.simulation_id, party.id);
    if (best) {
      hints.partyChoices = [
        { id: best.id, slug: best.slug, name: best.name },
        ...hints.partyChoices.filter((c) => c.id !== best.id),
      ];
    }
  }

  if (forceTool === "breakAlliance") {
    const stress = shouldForceBreakAlliance(party.simulation_id, party.id);
    if (stress.partnerId) {
      const partner = getParties(party.simulation_id).find(
        (p) => p.id === stress.partnerId
      );
      if (partner) {
        hints.partyChoices = [
          { id: partner.id, slug: partner.slug, name: partner.name },
        ];
        hints.breakPartnerId = partner.id;
        hints.coalitionStress = stress.stress;
      }
    }
  }

  const openNeg = getDb()
    .prepare(
      `SELECT id FROM negotiations
       WHERE simulation_id = ? AND status = 'open' AND to_party_id = ?
         AND from_party_id != to_party_id
       ORDER BY updated_month DESC LIMIT 1`
    )
    .get(party.simulation_id, party.id) as { id: string } | undefined;
  if (openNeg) hints.negotiationId = openNeg.id;

  if (forceTool === "respondNegotiation") {
    const inbound = getOpenNegotiationTargeting(
      party.simulation_id,
      party.id
    );
    if (inbound) {
      hints.negotiationId = inbound.id;
      hints.decisionRound = isPastSoftPhase(inbound.round);
      hints.preferAccept = attitudeVoteBias(party.id, inbound.from_party_id) >= -5;
    }
  }

  hints.cityChoices = [
    "ankara",
    "istanbul",
    "izmir",
    "bursa",
    "konya",
    "diyarbakir",
    "adana",
    "gaziantep",
  ];
  return hints;
}

/** Model bir turda birden fazla tool basınca öncelik / güvenlik filtresi */
const RECKLESS_TOOLS = new Set([
  "seizePower",
  "declareEmergency",
  "proposeRegimeChange",
  "callEarlyElection",
]);

const CONSTRUCTIVE_PRIORITY = [
  "voteOnBill",
  "voteConfidence",
  "respondNegotiation",
  "negotiateCoalition",
  "proposeLaw",
  "proposeCustomBill",
  "proposeAlliance",
  "holdRally",
  "issuePRStatement",
  "launchSmearCampaign",
  "breakAlliance",
  "moveConfidence",
];

function selectParsedToolsToApply(
  parsed: Array<{ name: string; args: Record<string, unknown> }>,
  forceTool: string | undefined,
  phase: string
): Array<{ name: string; args: Record<string, unknown> }> {
  if (!parsed.length) return [];

  const normalized = parsed.map((p) => ({
    ...p,
    name: canonicalizeToolName(p.name),
  }));

  if (forceTool) {
    const forced = normalized.filter((p) => p.name === forceTool);
    if (forced.length) return forced.slice(0, 1);
    if (
      forceTool === "respondNegotiation" &&
      normalized.some((p) => p.name === "negotiateCoalition")
    ) {
      return [{ name: "respondNegotiation", args: {} }];
    }
    if (
      forceTool === "voteOnBill" &&
      normalized.some((p) => p.name === "voteOnBill")
    ) {
      return normalized.filter((p) => p.name === "voteOnBill").slice(0, 1);
    }
    if (
      forceTool === "proposeLaw" &&
      normalized.some((p) => p.name === "proposeLaw")
    ) {
      return normalized.filter((p) => p.name === "proposeLaw").slice(0, 1);
    }
  }

  // Oylama / koalisyon dışında darbe/OHAL ikincil çağrılarını yut
  const crisisOk = phase === "crisis";
  let list = normalized.filter(
    (p) => crisisOk || !RECKLESS_TOOLS.has(p.name) || normalized.length === 1
  );
  if (!list.length) list = normalized.slice(0, 1);

  // Constructive öncelik sırası
  list = [...list].sort((a, b) => {
    const ia = CONSTRUCTIVE_PRIORITY.indexOf(a.name);
    const ib = CONSTRUCTIVE_PRIORITY.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // proposeLaw varken seizePower yanına alma
  if (list.some((p) => p.name === "proposeLaw")) {
    list = list.filter((p) => !RECKLESS_TOOLS.has(p.name));
  }

  return list.slice(0, 1);
}

async function applyToolCall(
  party: PartyRow,
  fnName: string,
  args: Record<string, unknown>,
  toolsUsed: string[],
  toolsFailed?: string[],
  opts?: { lastResort?: boolean }
): Promise<string> {
  const mode = opts?.lastResort ? "last_resort" : "format";
  const canonicalName = canonicalizeToolName(fnName);
  const enriched = enrichToolArgs(party, canonicalName, args, mode);
  const missing =
    mode === "format" ? missingDecisionFields(canonicalName, enriched) : [];

  // Path A: kritik karar yoksa executor'a gitme / red spam yok — recovery şansı
  if (missing.length && !opts?.lastResort) {
    toolsFailed?.push(canonicalName);
    appendAgentMemory(
      party.id,
      "assistant",
      `${canonicalName}: eksik karar alanları ${missing.join(",")}`
    );
    return JSON.stringify({
      ok: false,
      message: `Eksik karar: ${missing.join(", ")}`,
      missing,
    });
  }

  const result = await executePartyTool(
    { simulationId: party.simulation_id, actorPartyId: party.id },
    canonicalName,
    enriched
  );

  if (result.ok) {
    toolsUsed.push(canonicalName);
  } else {
    toolsFailed?.push(canonicalName);
  }
  appendAgentMemory(
    party.id,
    "assistant",
    `${canonicalName}: ${result.message.slice(0, 120)}`
  );
  return JSON.stringify({
    ok: result.ok,
    message: result.message.slice(0, 180),
  });
}

/** Model tool çağırmazsa ay boş geçmesin — fazına uygun deterministik hamle */
async function ensurePhaseActionFallback(
  party: PartyRow,
  toolsUsed: string[],
  forceTool?: string,
  toolsFailed: string[] = []
): Promise<void> {
  // Yalnız zorunlu sınıf: oy, masa yanıtı, formateur masa açma.
  if (forceTool === "voteOnBill" || forceTool === "voteConfidence") {
    return; // üst katmanda hallolur
  }
  if (forceTool && toolsUsed.includes(forceTool)) return;
  if (!forceTool) {
    // Serbest tur: hiç araç yoksa idle — reddedilmiş deneme idle sayılmaz
    if (toolsUsed.length === 0 && toolsFailed.length === 0) {
      const sim = getSimulation(party.simulation_id)!;
      insertEvent(
        party.simulation_id,
        "party_idle",
        {
          partyName: party.name,
          partyColor: party.color,
          message: `${party.name} bu ay siyasi hamle yapmadı (pass).`,
        },
        sim.month
      );
    }
    return;
  }

  if (forceTool === "negotiateCoalition") {
    if (toolsUsed.includes("negotiateCoalition")) return;
    const gate = canOpenFreshNegotiation(party.simulation_id, party.id);
    if (!gate.ok) return;
    const target = pickCoalitionPartner(party.simulation_id, party.id);
    if (!target) return;
    const quota = partnerMinistryQuota(party.seats, target.seats);
    await applyToolCall(
      party,
      "negotiateCoalition",
      {
        targetPartyId: target.id,
        message: `${party.name}, ${target.name} ile ortak hükümet ve bakanlık paylaşımı görüşmesi açıyor.`,
        ministriesOffered: preferredMinistriesForSlug(target.slug).slice(
          0,
          quota
        ),
        constitutionalConcessions:
          "Ortak program, 301 sandalye hedefi, bakanlık paylaşımı",
      },
      toolsUsed,
      undefined,
      { lastResort: true }
    );
    return;
  }

  if (forceTool !== "respondNegotiation") return;
  if (toolsUsed.includes("respondNegotiation")) return;

  const openNeg = getOpenNegotiationTargeting(
    party.simulation_id,
    party.id
  );
  if (!openNeg) return;

  const toward = attitudeVoteBias(party.id, openNeg.from_party_id);
  const accept = lastResortShouldAccept({
    toward,
    round: openNeg.round,
  });
  const from = getParties(party.simulation_id).find(
    (p) => p.id === openNeg.from_party_id
  );
  const quota = partnerMinistryQuota(from?.seats ?? 200, party.seats);
  await applyToolCall(
    party,
    "respondNegotiation",
    {
      negotiationId: openNeg.id,
      accept,
      counterMessage: accept
        ? `${party.name}, koalisyon teklifini kabul ediyor — ortak hükümet.`
        : `${party.name}, teklifi yetersiz buluyor; soft karşı teklif sürüyor.`,
      ministriesRequested: preferredMinistriesForSlug(party.slug).slice(
        0,
        quota
      ),
    },
    toolsUsed,
    undefined,
    { lastResort: true }
  );
}

function buildSituationContext(party: PartyRow): string {
  const sim = getSimulation(party.simulation_id)!;
  const parties = getParties(party.simulation_id);
  const metrics = getMetrics(party.simulation_id);
  const bill = getActiveBill(party.simulation_id);
  const regime = getRegime(party.simulation_id);
  const ministries = getMinistries(party.simulation_id);
  const partners = getAcceptedAlliancePartners(
    party.simulation_id,
    party.id
  );
  const pendingToMe = getAlliances(party.simulation_id).filter(
    (a) => a.status === "pending" && a.to_party_id === party.id
  );
  const ideo = getIdeology(party.id);
  const summary = getPartySummary(party.id).split("\n").slice(-3).join(" | ");
  const confidence = getActiveConfidence(party.simulation_id);

  const openNeg = getDb()
    .prepare(
      `SELECT id, from_party_id, to_party_id, round, offer_json FROM negotiations
       WHERE simulation_id = ? AND status = 'open'
       AND (to_party_id = ? OR from_party_id = ?)
       ORDER BY updated_month DESC LIMIT 2`
    )
    .all(party.simulation_id, party.id, party.id) as Array<{
    id: string;
    from_party_id: string;
    to_party_id: string;
    round: number;
    offer_json: string;
  }>;

  const mandateId = getMandatePartyId(party.simulation_id);
  const partyLines = parties
    .map((p) => {
      const tag = p.is_government
        ? "/GOV"
        : mandateId === p.id
          ? "/FORMATEUR"
          : "";
      return `${p.slug}[id=${p.id}]:${p.seats}s/%${p.poll_share.toFixed(0)}${tag}`;
    })
    .join(" ");

  let billLine = "Yasa: yok";
  if (bill) {
    const votes = getVotesForBill(bill.id);
    const myVote = votes.find((v) => v.party_id === party.id);
    const law = resolveLawForBill(bill);
    const attBias = attitudeVoteBias(party.id, bill.proposer_id);
    const preferred = preferredVoteForParty(
      party.id,
      party.slug,
      law,
      bill.proposer_id === party.id,
      attBias
    );
    const biasHint = law
      ? `ideolojiSkoru=${law.bias[party.slug === "left" || party.slug === "right" ? party.slug : "center"]} önerilenOy=${preferred}`
      : `önerilenOy=${preferred}`;
    billLine = `ZORUNLU OY: voteOnBill billId="${bill.id}" oyum=${myVote?.vote ?? "HENÜZ_YOK"} ${biasHint}
${describeBillForAgent(bill)}
KÜRSÜ: speechText yasa başlığı/alanına değinsin (genel güvenlik/emek lafı yetmez).`;
  }

  const attLine = describeAttitudesForAgent(
    party.simulation_id,
    party.id
  );

  const mins =
    ministries
      .filter((m) => m.holder_party_id)
      .map((m) => {
        const holder = parties.find((p) => p.id === m.holder_party_id);
        return `${m.key}:${holder?.slug || "?"}`;
      })
      .join(",") || "-";

  const negLine = openNeg.length
    ? openNeg
        .map((n) => {
          let msg = "";
          try {
            msg = String(
              (JSON.parse(n.offer_json) as { message?: string }).message || ""
            ).slice(0, 40);
          } catch {
            msg = "";
          }
          return `${n.id} r${n.round} ${describeNegotiationPressure(n.round)} | ${msg}`;
        })
        .join("; ")
    : "-";

  const pendingLine = pendingToMe.length
    ? pendingToMe
        .map((a) => {
          const from = parties.find((p) => p.id === a.from_party_id);
          return `PENDING_ALLY id=${a.id} from=${from?.slug || a.from_party_id} → acceptExistingId ile proposeAlliance`;
        })
        .join("; ")
    : "-";

  const text = [
    `Ay${sim.month} faz=${sim.phase} kriz=${sim.pending_crisis || "-"}`,
    `Rejim=${regime.regime_type} fesih=${regime.parliament_dissolved ? 1 : 0}`,
    `Sen=${party.slug} id=${party.id} kimlik=${party.ideology}`,
    ideo
      ? `İdeoloji vektörü: ${describeIdeology(ideo)} | proposeLaw yalnız bias≥0; ±2 ters oy taban isyanı`
      : `İdeoloji: proposeLaw yalnız bias≥0 katalog; ±2 ters oy taban isyanı`,
    `Özet:${summary.slice(0, 220) || "-"}`,
    `Partiler: ${partyLines}`,
    `Bakanlık: ${mins}`,
    `İttifak: ${describeAlliances(party.simulation_id).slice(0, 160)}`,
    describeCoalitionStressForAgent(party.simulation_id, party.id),
    `Bekleyen ittifak: ${pendingLine}`,
    `Ortak=${partners.map((id) => parties.find((p) => p.id === id)?.slug || shortId(id)).join(",") || "-"}`,
    `Müzakere: ${negLine.slice(0, 160)}`,
    confidence
      ? `ZORUNLU: voteConfidence motionId="${confidence.id}" type=${confidence.motion_type}`
      : "Gensoru: -",
    `Metrik eko=${metrics.economy.toFixed(0)} özgür=${metrics.freedom.toFixed(0)} güven=${metrics.security.toFixed(0)} korku=${metrics.fear.toFixed(0)} enf=${metrics.inflation.toFixed(0)}`,
    `Bakışların: ${attLine}`,
    describeLawsForAgent(party.simulation_id, party.slug),
    describeMandateForAgent(party.simulation_id),
    billLine,
  ]
    .filter(Boolean)
    .join("\n");

  return text.slice(0, MAX_CONTEXT_CHARS);
}

function resolveModelId(party: PartyRow): string | null {
  if (party.model_id) return party.model_id;
  try {
    const map = JSON.parse(getSetting("model_map", "{}")) as Record<
      string,
      string
    >;
    return map[party.slug] || null;
  } catch {
    return null;
  }
}

function isContextOverflow(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context size|context length|too many tokens|exceeded/i.test(message);
}

const TOOL_DISCIPLINE = `
ARAÇ: Native tool_calls. Metin strateji yazma. Türkçe argüman. Boş ay (pass) serbest.
YASAMA: Kabine mühürlenince HER parti proposeLaw yapabilir — yalnız ideolojiye uyumlu (bias≥0) katalog. Kendi teklifine Ret yasak. Oylamada karar sizin; ±2 sert çelişki taban isyanı doğurur. Milletvekili isyanı sandalye kaçışı olarak işler.
GENSORU: Muhalefet censure; iktidar confidence.
KOALİSYON: Formateur negotiateCoalition/proposeAlliance ile masa AÇAR. respondNegotiation yalnız size gelen açık masada. Soft uzatma cezalı; net red masayı dağıtır. Zorla kabul YOK.
ZORUNLU SINIF: aktif oylama (voteOnBill/voteConfidence), gelen masa (respondNegotiation), formateur masa açma (negotiateCoalition).`;

/**
 * Küçük / reasoning modeller native tool’u sık kaçırır.
 * Native family (Phi/Qwen/Gemma/Llama/Mistral/GLM/Harmony/Instruct) zaten özel format kullandığı için
 * burada “fragile” daha çok OpenAI tools yolundaki küçük modeller içindir;
 * native path’te de compact prompt tetikler.
 */
function isFragileToolModel(modelId: string): boolean {
  return /phi|reasoning|think|mini|7b|8b|9b|small|tiny|mistral-?7|ministral|bonsai|gpt-?oss|glm-?4|instruct|qwen2\.5-?(3|7|14)|qwen3\.?5?-?(0\.|1\.|3|4|7|8|9|14)|gemma-?[23]?-?(1|2|4|9|12)|function.?gemma|llama-?3\.2?-?(1|3)|llama.?3\.2.?(1|3)b|meta-llama-3\.2-(1|3)|deepseek-r1|r1-distill/i.test(
    modelId
  );
}

function isTransientLmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Engine protocol predict request returned 500/i.test(msg) ||
    /ECONNRESET|ETIMEDOUT|socket hang up|503|502/i.test(msg) ||
    (/status code 5\d\d/i.test(msg) && !/401|403/.test(msg))
  );
}

function summarizeLmError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Engine protocol predict request returned 500/i.test(msg)) {
    return "LM Studio motor hatası (500) — model yanıt veremedi";
  }
  if (/400/.test(msg) && /500/.test(msg)) {
    return "LM Studio geçici protokol hatası (400/500)";
  }
  return msg.slice(0, 120);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageTextBlob(msg: {
  content?: unknown;
  reasoning_content?: string;
}): string {
  const content =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .map((p) =>
              typeof p === "object" && p && "text" in p
                ? String((p as { text?: string }).text || "")
                : ""
            )
            .join("\n")
        : "";
  return [content, msg.reasoning_content].filter(Boolean).join("\n");
}

function resolveToolChoice(
  forceTool: string | undefined,
  round: number,
  fragile: boolean
): ChatCompletionToolChoiceOption {
  // Zorunlu sınıf yoksa model pass/boş bırakabilir (özgür RPG)
  if (!forceTool) return "auto";
  // OpenRouter / OpenAI: named force — küçük modellerde en güvenilir
  if (
    getLlmProvider() === "openrouter" &&
    forceTool &&
    (round === 0 || fragile)
  ) {
    return {
      type: "function",
      function: { name: forceTool },
    };
  }
  // LM Studio: object form çoğu modelde 400 → required|auto
  if (round === 0 || fragile) return "required";
  return "auto";
}

function selectToolsForTurn(
  phaseTools: ChatCompletionTool[],
  forceTool?: string
): ChatCompletionTool[] {
  if (!forceTool) return phaseTools;
  // Karar turu / yanıt zorunluluğu: yalnız respondNegotiation — soft kaçışı yok
  if (forceTool === "respondNegotiation") {
    const only = phaseTools.filter(
      (t) => t.type === "function" && t.function.name === "respondNegotiation"
    );
    if (only.length) return only;
  }
  // Yeni masa açma: miting kaçışı yok; break serbest
  if (forceTool === "negotiateCoalition") {
    const allow = new Set([
      "negotiateCoalition",
      "respondNegotiation",
      "proposeAlliance",
      "breakAlliance",
    ]);
    const narrowed = phaseTools.filter(
      (t) => t.type === "function" && allow.has(t.function.name)
    );
    if (narrowed.length) return narrowed;
  }
  if (forceTool === "breakAlliance") {
    const forced = phaseTools.filter(
      (t) => t.type === "function" && t.function.name === "breakAlliance"
    );
    if (forced.length) return forced;
  }
  const forced = phaseTools.filter(
    (t) => t.type === "function" && t.function.name === forceTool
  );
  if (!forced.length) return phaseTools;
  const rest = phaseTools.filter(
    (t) => t.type === "function" && t.function.name !== forceTool
  );
  return [...forced, ...rest];
}

async function runChatLoop(opts: {
  party: PartyRow;
  modelId: string;
  useMemory: boolean;
  compactPrompt: boolean;
}): Promise<{ toolsUsed: string[]; toolsFailed: string[]; ok: boolean }> {
  const { party, modelId, useMemory, compactPrompt } = opts;
  const sim = getSimulation(party.simulation_id)!;
  const client = createLmClient();
  const effective = resolveEffectivePhase(party);
  const context = buildSituationContext(party);
  const fragile = isFragileToolModel(modelId) || compactPrompt;
  const nativeProfile: NativeToolProfile | null =
    detectNativeToolProfile(modelId);
  const nativeFamily = nativeProfile?.family ?? null;
  const nativeMode = nativeProfile !== null;
  // Native Path A'da da kısa hafıza açık — parti kimliği/son hamle unutulmasın
  const memoryLimit = fragile || nativeMode ? 3 : 4;
  const memory = useMemory ? getAgentMemory(party.id, memoryLimit) : [];
  const memClip = fragile || nativeMode ? 140 : 180;
  const baseTools =
    effective.tools.length > 0 ? effective.tools : PARTY_TOOLS;

  let tools = selectToolsForTurn(baseTools, effective.forceTool);
  if ((fragile || nativeMode) && effective.forceTool) {
    const only = tools.filter(
      (t) => t.type === "function" && t.function.name === effective.forceTool
    );
    if (only.length) tools = only;
  } else if ((fragile || nativeMode) && effective.phase === "election") {
    tools = tools.filter(
      (t) =>
        t.type === "function" &&
        ["holdRally", "issuePRStatement"].includes(t.function.name)
    );
  }

  // Phi / Qwen / Gemma / Mistral: native chat tool formatı (OpenAI tools API değil)
  const decisionHints = buildDecisionHintsForTurn(party, effective.forceTool);
  const thinkPrefix = thinkingDisciplinePrefix(modelId);
  const ideologyBlock = clipPartyIdeologyPrompt(party.system_prompt, {
    compact: fragile || compactPrompt,
  });

  const systemContent = nativeFamily
    ? thinkPrefix +
      buildNativeSystemPrompt(
        nativeFamily,
        {
          partyName: party.name,
          ideologyPrompt: ideologyBlock || party.system_prompt,
          tools,
          forceTool: effective.forceTool,
          compact: fragile || compactPrompt,
        },
        nativeProfile
      )
    : fragile || compactPrompt
      ? `${thinkPrefix}${party.name}. ${ideologyBlock || party.ideology}\nSADECE native function/tool_call. Metin/reasoning yazma. Türkçe argüman.\n${TOOL_DISCIPLINE}`
      : `${thinkPrefix}${ideologyBlock || party.system_prompt.slice(0, 500)}\n${TOOL_DISCIPLINE}`;

  const pathATail =
    nativeFamily && (fragile || nativeMode)
      ? buildPathAUserTail({
          family: nativeFamily,
          profile: nativeProfile,
          forceTool: effective.forceTool,
          hints: decisionHints,
        })
      : "";

  const userPrompt = [
    fragile || nativeMode
      ? buildTurnUserPrompt(context, phaseHint(effective.phase)).slice(0, 900)
      : buildTurnUserPrompt(context, phaseHint(effective.phase)),
    nativeFamily
      ? buildNativeUserSuffix(
          nativeFamily,
          effective.forceTool,
          nativeProfile
        )
      : effective.forceTool
        ? `\nZORUNLU: şimdi yalnızca ${effective.forceTool} tool_call. Başka metin yok.`
        : "\nEn az bir tool_call yap. Hedef parti = başka parti id.",
    pathATail,
  ]
    .join("")
    .slice(0, fragile || nativeMode ? 2400 : MAX_CONTEXT_CHARS + 400);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...memory.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content.slice(0, memClip),
    })),
    { role: "user", content: userPrompt },
  ];

  const toolsUsed: string[] = [];
  const toolsFailed: string[] = [];
  let maxTokens = pathAMaxTokens(fragile, nativeMode);
  let activeTools = tools;

  const callLm = async (
    choice: ChatCompletionToolChoiceOption | undefined,
    tokens: number,
    toolSet: ChatCompletionTool[] | undefined = activeTools
  ) => {
    const once = () =>
      nativeMode
        ? client.chat.completions.create({
            model: modelId,
            messages,
            temperature: 0.15,
            max_tokens: tokens,
          })
        : client.chat.completions.create({
            model: modelId,
            messages,
            tools: toolSet,
            tool_choice: choice ?? "auto",
            temperature: fragile ? 0.1 : 0.25,
            max_tokens: tokens,
          });

    try {
      return await once();
    } catch (err) {
      // LM Studio engine 500 / transient protocol — bir kez kısa bekle+retry
      if (isTransientLmError(err)) {
        await sleepMs(350);
        return await once();
      }
      throw err;
    }
  };

  const tryParseAndApplyText = async (textBlob: string): Promise<boolean> => {
    if (!textBlob.trim()) return false;
    let parsed = parseTextToolCalls(textBlob);
    if (nativeFamily) {
      const nativeParsed = parseNativeToolCalls(
        nativeFamily,
        textBlob,
        nativeProfile
      );
      if (nativeParsed.length) {
        const names = new Set(nativeParsed.map((p) => p.name));
        parsed = [
          ...nativeParsed,
          ...parsed.filter((p) => !names.has(p.name)),
        ];
      }
    }
    if (!parsed.length && effective.forceTool) {
      const synth = synthesizeToolFromIntent(effective.forceTool, textBlob, {
        cityId: preferredRallyCity(party.slug),
        tone: preferredRallyTone(party.slug),
        focusTopic: defaultRallyFocusTopic(party.slug),
        partyName: party.name,
      });
      if (synth) parsed = [synth];
    }
    if (!parsed.length) return false;

    // Zorunlu araç / öncelik: tehlikeli ikincil çağrıları (seizePower vb.) ele
    const ordered = selectParsedToolsToApply(
      parsed,
      effective.forceTool,
      effective.phase
    );

    for (const p of ordered) {
      await applyToolCall(party, p.name, { ...p.args }, toolsUsed, toolsFailed);
      if (
        effective.forceTool &&
        toolsUsed.includes(effective.forceTool)
      ) {
        break;
      }
    }
    return toolsUsed.length > 0;
  };

  const recoveryForcedRound = async (): Promise<boolean> => {
    if (!effective.forceTool) return false;
    const forcedToolDef = baseTools.filter(
      (t) => t.type === "function" && t.function.name === effective.forceTool
    );
    if (!forcedToolDef.length) return false;

    activeTools = forcedToolDef;
    const recoveryMsgs: ChatCompletionMessageParam[] = nativeFamily
      ? [
          {
            role: "system",
            content:
              thinkingDisciplinePrefix(modelId) +
              buildNativeSystemPrompt(
                nativeFamily,
                {
                  partyName: party.name,
                  tools: forcedToolDef,
                  forceTool: effective.forceTool,
                  compact: true,
                },
                nativeProfile
              ),
          },
          {
            role: "user",
            content: buildPathARecoveryHint(
              nativeFamily,
              effective.forceTool,
              decisionHints,
              nativeProfile
            ),
          },
        ]
      : [
          {
            role: "system",
            content: `/no_think Call the function ${effective.forceTool} now. No prose.`,
          },
          {
            role: "user",
            content:
              effective.forceTool === "holdRally"
                ? `Call holdRally with cityId="${preferredRallyCity(party.slug)}", tone="${preferredRallyTone(party.slug)}", focusTopic="kampanya".`
                : effective.forceTool === "voteOnBill"
                  ? `Call voteOnBill now with vote YES|NO|ABSTAIN and a short Turkish speechText.`
                  : `Call ${effective.forceTool} with valid JSON arguments now.`,
          },
        ];
    const saved = messages.splice(0, messages.length, ...recoveryMsgs);
    try {
      const choice = nativeMode
        ? undefined
        : resolveToolChoice(effective.forceTool, 0, true);
      let completion;
      try {
        completion = await callLm(choice, 512, forcedToolDef);
      } catch {
        completion = await callLm(nativeMode ? undefined : "auto", 512, forcedToolDef);
      }
      const msg = completion.choices[0]?.message;
      if (!msg) return false;
      const toolCalls = (msg.tool_calls ||
        []) as ChatCompletionMessageToolCall[];
      if (toolCalls.length) {
        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            args = {};
          }
          await applyToolCall(
            party,
            call.function.name,
            args,
            toolsUsed,
            toolsFailed
          );
        }
        return toolsUsed.includes(effective.forceTool);
      }
      return tryParseAndApplyText(
        messageTextBlob(
          msg as { content?: unknown; reasoning_content?: string }
        )
      );
    } finally {
      messages.splice(0, messages.length, ...saved);
    }
  };

  for (let round = 0; round < MAX_TOOL_CALLS_PER_TURN; round++) {
    const choice = nativeMode
      ? undefined
      : resolveToolChoice(effective.forceTool, round, fragile);

    let completion;
    try {
      completion = await callLm(choice, maxTokens);
    } catch (err) {
      if (nativeMode) throw err;
      const asAuto =
        typeof choice === "object" || choice === "required" ? "auto" : null;
      if (asAuto) {
        try {
          completion = await callLm("auto", maxTokens);
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    let choiceMsg = completion.choices[0];
    let msg = choiceMsg?.message;
    if (!msg) break;

    let finish = choiceMsg.finish_reason;
    let toolCalls = (msg.tool_calls || []) as ChatCompletionMessageToolCall[];

    if (
      !toolCalls.length &&
      finish === "length" &&
      maxTokens < 1600
    ) {
      maxTokens = Math.min(1600, maxTokens + 512);
      const truncHint =
        nativeMode && nativeFamily && effective.forceTool
          ? `/no_think Truncated output. Complete ONE tool call now.\n${buildPathARecoveryHint(
              nativeFamily,
              effective.forceTool,
              decisionHints,
              nativeProfile
            )}`
          : nativeMode
            ? `/no_think Output was truncated. Emit ONE complete tool call for ${effective.forceTool || "the required tool"} now.`
            : "/no_think Kısa düşün. HEMEN tek bir tool_call üret. Hedef = başka parti.";
      messages.push({
        role: "user",
        content: truncHint,
      });
      try {
        completion = await callLm(
          nativeMode
            ? undefined
            : resolveToolChoice(effective.forceTool, 0, fragile),
          maxTokens
        );
        choiceMsg = completion.choices[0];
        msg = choiceMsg?.message;
        if (!msg) break;
        finish = choiceMsg.finish_reason;
        toolCalls = (msg.tool_calls || []) as ChatCompletionMessageToolCall[];
      } catch {
        // devam
      }
    }

    messages.push(msg as ChatCompletionMessageParam);

    const textBlob = messageTextBlob(
      msg as { content?: unknown; reasoning_content?: string }
    );

    if (!toolCalls.length) {
      if (await tryParseAndApplyText(textBlob)) break;

      if (
        typeof msg.content === "string" &&
        msg.content &&
        !looksLikeToolNarration(msg.content) &&
        !fragile &&
        !nativeMode
      ) {
        const speech = cleanSpeechText(msg.content);
        if (speech) {
          appendAgentMemory(party.id, "assistant", speech.slice(0, 200));
          insertEvent(
            party.simulation_id,
            "party_speech",
            {
              partyId: party.id,
              partyName: party.name,
              partyColor: party.color,
              message: `${party.name}: ${speech}`,
              speech,
            },
            sim.month
          );
        }
      }

      if (
        effective.forceTool &&
        !toolsUsed.includes(effective.forceTool) &&
        round === 0
      ) {
        if (await recoveryForcedRound()) break;
      }
      break;
    }

    const parsedCalls = toolCalls
      .filter(
        (
          c
        ): c is Extract<ChatCompletionMessageToolCall, { type: "function" }> =>
          c.type === "function"
      )
      .map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          args = {};
        }
        return { name: c.function.name, args, call: c };
      });

    const plannedNames = new Set(
      selectParsedToolsToApply(
        parsedCalls.map(({ name, args }) => ({ name, args })),
        effective.forceTool,
        effective.phase
      ).map((p) => p.name)
    );

    const planned = parsedCalls.filter((p) => plannedNames.has(p.name));

    for (const item of planned) {
      const fnName = item.name;
      const args: Record<string, unknown> = { ...item.args };
      if (fnName === "voteOnBill" && !args.billId) {
        const bill = getActiveBill(party.simulation_id);
        if (bill) args.billId = bill.id;
      }
      if (fnName === "voteConfidence" && !args.motionId) {
        const c = getActiveConfidence(party.simulation_id);
        if (c) args.motionId = c.id;
      }
      if (fnName === "voteOnBill" && !args.speechText) {
        args.speechText = `${party.name} olarak oyumuzu meclis tutanaklarına geçiriyoruz.`;
      }
      if (fnName === "holdRally") {
        if (!args.cityId) args.cityId = preferredRallyCity(party.slug);
        if (!args.tone) args.tone = preferredRallyTone(party.slug);
        args.focusTopic = sanitizeRallyFocusTopic(
          args.focusTopic || defaultRallyFocusTopic(party.slug),
          party.slug
        );
      }
      if (
        (fnName === "negotiateCoalition" ||
          fnName === "proposeAlliance" ||
          fnName === "launchSmearCampaign" ||
          fnName === "breakAlliance") &&
        typeof args.targetPartyId === "string"
      ) {
        const raw = String(args.targetPartyId);
        const parties = getParties(party.simulation_id);
        if (!parties.some((p) => p.id === raw)) {
          const bySlug = parties.find(
            (p) => p.slug === raw || p.name === raw
          );
          if (bySlug) args.targetPartyId = bySlug.id;
        }
      }
      if (fnName === "breakAlliance" && typeof args.partyId === "string") {
        const raw = String(args.partyId);
        const parties = getParties(party.simulation_id);
        if (!parties.some((p) => p.id === raw)) {
          const bySlug = parties.find(
            (p) => p.slug === raw || p.name === raw
          );
          if (bySlug) args.partyId = bySlug.id;
        }
      }

      const resultJson = await applyToolCall(
        party,
        fnName,
        args,
        toolsUsed,
        toolsFailed
      );
      messages.push({
        role: "tool",
        tool_call_id: item.call.id,
        content: resultJson,
      });
    }

    if (effective.forceTool && toolsUsed.includes(effective.forceTool)) {
      break;
    }
    if (getSimulation(party.simulation_id)?.phase === "election") break;
  }

  if (effective.forceTool === "voteOnBill" && !toolsUsed.includes("voteOnBill")) {
    const bill = getActiveBill(party.simulation_id);
    if (bill) {
      const law = resolveLawForBill(bill);
      const vote = preferredVoteForParty(
        party.id,
        party.slug,
        law,
        bill.proposer_id === party.id,
        attitudeVoteBias(party.id, bill.proposer_id)
      );
      const group = law?.group ?? bill.law_group ?? bill.category ?? null;
      const speechText = buildAlignedBillSpeech({
        partyName: party.name,
        slug: party.slug,
        title: bill.title,
        group,
        vote,
        law,
      });

      await applyToolCall(
        party,
        "voteOnBill",
        {
          billId: bill.id,
          vote,
          speechText,
        },
        toolsUsed,
        toolsFailed,
        { lastResort: true }
      );
      insertEvent(
        party.simulation_id,
        "vote_fallback",
        {
          partyName: party.name,
          partyColor: party.color,
          message: `${party.name}: model tool kaçırdı — ideolojiye göre yedek oy (${vote})`,
        },
        sim.month
      );
    }
  }

  if (
    effective.forceTool === "voteConfidence" &&
    !toolsUsed.includes("voteConfidence")
  ) {
    const confidence = getActiveConfidence(party.simulation_id);
    if (confidence) {
      const gov = getParties(party.simulation_id).find((p) => p.is_government);
      let vote: "YES" | "NO" | "ABSTAIN" = "ABSTAIN";
      if (confidence.motion_type === "censure") {
        vote = party.is_government ? "NO" : "YES";
      } else {
        if (party.is_government) vote = "YES";
        else if (gov) {
          const bias = attitudeVoteBias(party.id, gov.id);
          vote = bias >= 0 ? "YES" : "NO";
        } else vote = "NO";
      }
      await applyToolCall(
        party,
        "voteConfidence",
        {
          motionId: confidence.id,
          vote,
          speechText: `${party.name} gensoru/güvenoyunda tutumunu netleştirdi: ${vote}`,
        },
        toolsUsed,
        toolsFailed,
        { lastResort: true }
      );
      insertEvent(
        party.simulation_id,
        "vote_fallback",
        {
          partyName: party.name,
          partyColor: party.color,
          message: `${party.name}: yedek gensoru/güven oyu (${vote})`,
        },
        sim.month
      );
    }
  }

  if (
    effective.forceTool === "respondNegotiation" &&
    !toolsUsed.includes("respondNegotiation")
  ) {
    // ensurePhaseActionFallback zaten respond'u last_resort ile dener
  }

  await ensurePhaseActionFallback(
    party,
    toolsUsed,
    effective.forceTool,
    toolsFailed
  );

  if (toolsUsed.length) {
    appendAgentMemory(
      party.id,
      "user",
      `Ay${sim.month} araç=${toolsUsed.join(",")}`
    );
  }

  return { toolsUsed, toolsFailed, ok: true };
}


export async function runPartyTurn(party: PartyRow): Promise<{
  ok: boolean;
  summary: string;
  toolsUsed: string[];
}> {
  const modelId = resolveModelId(party);
  const sim = getSimulation(party.simulation_id)!;
  const started = Date.now();

  if (!modelId) {
    insertEvent(
      party.simulation_id,
      "agent_skipped",
      {
        partyId: party.id,
        partyName: party.name,
        partyColor: party.color,
        message: `${party.name} pas: model atanmamış — yedek siyasi hamle uygulanıyor.`,
      },
      sim.month
    );
    const toolsUsed: string[] = [];
    const effective = resolveEffectivePhase(party);
    if (effective.forceTool === "voteOnBill") {
      const bill = getActiveBill(party.simulation_id);
      if (bill) {
        const law = resolveLawForBill(bill);
        const vote = preferredVoteForParty(
          party.id,
          party.slug,
          law,
          bill.proposer_id === party.id,
          attitudeVoteBias(party.id, bill.proposer_id)
        );
        await applyToolCall(
          party,
          "voteOnBill",
          {
            billId: bill.id,
            vote,
            speechText: buildAlignedBillSpeech({
              partyName: party.name,
              slug: party.slug,
              title: bill.title,
              group: law?.group ?? bill.law_group ?? bill.category,
              vote,
              law,
            }),
          },
          toolsUsed
        );
      }
    } else if (effective.forceTool === "breakAlliance") {
      const stress = shouldForceBreakAlliance(party.simulation_id, party.id);
      if (stress.partnerId) {
        await applyToolCall(
          party,
          "breakAlliance",
          {
            partyId: stress.partnerId,
            reason: `Koalisyon gerilimi sürdürülemez (stres ${stress.stress?.toFixed(0) ?? "?"}/100).`,
          },
          toolsUsed,
          undefined,
          { lastResort: true }
        );
      }
    } else {
      await ensurePhaseActionFallback(
        party,
        toolsUsed,
        effective.forceTool,
        []
      );
    }
    return {
      ok: false,
      summary: "Model yok (yedek hamle)",
      toolsUsed,
    };
  }

  const memProbe = getAgentMemory(party.id, 20);
  const memChars = memProbe.reduce((s, m) => s + m.content.length, 0);
  // Native hafıza açık — aşırı şişmede budama; her turda silme
  if (memChars > 2400 || memProbe.length > 10) {
    clearAgentMemory(party.id);
  }

  try {
    let result: { toolsUsed: string[]; toolsFailed: string[]; ok: boolean };
    const fragile = isFragileToolModel(modelId);
    try {
      result = await runChatLoop({
        party,
        modelId,
        useMemory: true,
        compactPrompt: fragile,
      });
    } catch (err) {
      if (!isContextOverflow(err)) throw err;
      clearAgentMemory(party.id);
      insertEvent(
        party.simulation_id,
        "context_trimmed",
        {
          partyName: party.name,
          partyColor: party.color,
          message: `${party.name}: context aşıldı — kısa bağlamla yeniden deneniyor.`,
        },
        sim.month
      );
      result = await runChatLoop({
        party,
        modelId,
        useMemory: false,
        compactPrompt: true,
      });
    }

    recordLatency({
      simulationId: party.simulation_id,
      partyId: party.id,
      month: sim.month,
      modelId,
      durationMs: Date.now() - started,
      toolCalls: result.toolsUsed.length,
      ok: true,
      error: result.toolsFailed.length
        ? `red:${result.toolsFailed.join(",")}`
        : undefined,
    });
    return {
      ok: true,
      summary: result.toolsUsed.length
        ? `Araçlar: ${result.toolsUsed.join(", ")}`
        : result.toolsFailed.length
          ? `Başarılı araç yok (red: ${result.toolsFailed.join(", ")})`
          : "Araç yok",
      toolsUsed: result.toolsUsed,
    };
  } catch (err) {
    const message = summarizeLmError(err);
    if (isContextOverflow(err)) clearAgentMemory(party.id);
    const toolsUsed: string[] = [];
    const effective = resolveEffectivePhase(party);
    await ensurePhaseActionFallback(
      party,
      toolsUsed,
      effective.forceTool,
      []
    );
    recordLatency({
      simulationId: party.simulation_id,
      partyId: party.id,
      month: sim.month,
      modelId,
      durationMs: Date.now() - started,
      toolCalls: toolsUsed.length,
      ok: false,
      error: message,
    });
    insertEvent(
      party.simulation_id,
      "agent_error",
      {
        partyId: party.id,
        partyName: party.name,
        partyColor: party.color,
        message: `${party.name} LM turu başarısız (${message})${
          toolsUsed.length ? ` — yedek: ${toolsUsed.join(",")}` : ""
        }`,
      },
      sim.month
    );
    return { ok: false, summary: message, toolsUsed };
  }
}

const PARALLEL_SAFE = new Set([
  "holdRally",
  "launchSmearCampaign",
  "issuePRStatement",
]);

export function isParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE.has(name);
}
