import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import { createLmClient } from "./lmStudio";
import { toolsForPhase, phaseHint, PARTY_TOOLS } from "./tools";
import { buildTurnUserPrompt } from "./prompts";
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
import { describeLawsForAgent, suggestLawsForSlug, getLawGroupStates } from "../sim/lawEngine";
import {
  buildAlignedBillSpeech,
  preferredVoteForLaw,
  resolveLawForBill,
} from "../sim/voteIdeology";
import { defaultCityForSlug } from "../sim/cities";
import {
  assertCanInitiateGovernmentTalks,
  describeMandateForAgent,
  getMandatePartyId,
  isFormateur,
  needsCabinetFormation,
} from "../sim/mandate";
import {
  describeNegotiationPressure,
  isPastSoftPhase,
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
  detectNativeToolFamily,
  nativeRecoveryUserHint,
  parseNativeToolCalls,
  type NativeToolFamily,
} from "./nativeToolFormats";

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

  // Aktif yolsuzluk krizi: önce PR, sonra koalisyona dönülür
  if (sim.pending_crisis === "corruption_scandal") {
    return {
      phase: "crisis",
      forceTool: "issuePRStatement",
      tools: stripLegislationTools(toolsForPhase("crisis")),
    };
  }

  // Kabine kurulumu — faz yanlışlıkla governing/crisis kalsa bile formateur zorlanır
  if (forming) {
    if (sim.phase !== "coalition_talks" && sim.phase !== "negotiation") {
      updateSimulation(party.simulation_id, { phase: "coalition_talks" });
    }
    const canStart = assertCanInitiateGovernmentTalks(
      party.simulation_id,
      party.id
    ).ok;
    let forceTool = "holdRally";
    if (canStart) {
      forceTool = "negotiateCoalition";
    } else {
      const pendingNeg = getDb()
        .prepare(
          `SELECT id FROM negotiations
           WHERE simulation_id = ? AND status = 'open' AND to_party_id = ?
           LIMIT 1`
        )
        .get(party.simulation_id, party.id);
      const pendingAlly = getAlliances(party.simulation_id).some(
        (a) => a.status === "pending" && a.to_party_id === party.id
      );
      forceTool = pendingNeg
        ? "respondNegotiation"
        : pendingAlly
          ? "proposeAlliance"
          : "holdRally";
    }
    return {
      phase: "coalition_talks",
      forceTool,
      tools: stripLegislationTools(toolsForPhase("coalition_talks")),
    };
  }

  // Faz öncelikli zorunlu araç — model boş dönerse bile tool_choice hedefi net olsun
  const phaseForce: Record<string, string> = {
    election: "holdRally",
    crisis: "issuePRStatement",
  };
  const force = phaseForce[sim.phase];

  return {
    phase: sim.phase,
    forceTool: force,
    tools: toolsForPhase(sim.phase),
  };
}

function stripLegislationTools(tools: ChatCompletionTool[]): ChatCompletionTool[] {
  const ban = new Set(["proposeLaw", "proposeCustomBill", "proposeBill"]);
  return tools.filter(
    (t) => !(t.type === "function" && ban.has(t.function.name))
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

async function applyToolCall(
  party: PartyRow,
  fnName: string,
  args: Record<string, unknown>,
  toolsUsed: string[],
  toolsFailed?: string[]
): Promise<string> {
  const result = await executePartyTool(
    { simulationId: party.simulation_id, actorPartyId: party.id },
    fnName,
    args
  );
  if (result.ok) {
    toolsUsed.push(fnName);
  } else {
    toolsFailed?.push(fnName);
  }
  appendAgentMemory(
    party.id,
    "assistant",
    `${fnName}: ${result.message.slice(0, 120)}`
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
  forceTool?: string
): Promise<void> {
  // Zorunlu oy araçları üst katmanda hallolur
  if (forceTool === "voteOnBill" || forceTool === "voteConfidence") {
    return;
  }
  // forceTool varsa yalnızca o başarılıysa çık; miting yedeği müzakereyi iptal etmesin
  if (forceTool && toolsUsed.includes(forceTool)) return;
  if (!forceTool && toolsUsed.length > 0) return;

  const sim = getSimulation(party.simulation_id)!;
  const parties = getParties(party.simulation_id);
  const phase = sim.phase;

  const tryAction = async (
    fnName: string,
    args: Record<string, unknown>
  ): Promise<boolean> => {
    const before = toolsUsed.length;
    await applyToolCall(party, fnName, args, toolsUsed);
    return toolsUsed.length > before;
  };

  let done = false;

  // 1) Kriz: PR / rejim öncelikli
  if (phase === "crisis" || sim.pending_crisis === "corruption_scandal") {
    if (sim.pending_crisis === "corruption_scandal") {
      done = await tryAction("issuePRStatement", {
        stance: "reform",
        statementText: `${party.name} skandal hakkında reform sözü verdi.`,
      });
    }
    if (!done) {
      done = await tryAction("issuePRStatement", {
        stance: "deny",
        statementText: `${party.name} kriz yönetiminde kamuoyuna seslendi.`,
      });
    }
  }

  // 2) Pending ittifak kabul (bakış izin veriyorsa)
  if (!done) {
    const pending = getAlliances(party.simulation_id).filter(
      (a) => a.status === "pending" && a.to_party_id === party.id
    );
    for (const a of pending) {
      const from = parties.find((p) => p.id === a.from_party_id);
      if (!from) continue;
      const bias = attitudeVoteBias(party.id, a.from_party_id);
      if (bias < -5) continue;
      done = await tryAction("proposeAlliance", {
        targetPartyId: a.from_party_id,
        concessionsOffer: a.concessions || "Karşılıklı destek ve bakanlık paylaşımı",
        acceptExistingId: a.id,
      });
      if (done) break;
    }
  }

  // 3) Koalisyon / müzakere — yalnızca formateur başlatır
  if (
    !done &&
    (needsCabinetFormation(party.simulation_id) ||
      phase === "coalition_talks" ||
      phase === "negotiation")
  ) {
    const others = parties.filter((p) => p.id !== party.id);
    let best = others[0];
    let bestScore = -999;
    for (const o of others) {
      const bias = attitudeVoteBias(party.id, o.id);
      if (bias > bestScore) {
        bestScore = bias;
        best = o;
      }
    }
    if (best) {
      const openNeg = getDb()
        .prepare(
          `SELECT id, from_party_id, to_party_id, round FROM negotiations
           WHERE simulation_id = ? AND status = 'open'
           AND to_party_id = ? LIMIT 1`
        )
        .get(party.simulation_id, party.id) as
        | {
            id: string;
            from_party_id: string;
            to_party_id: string;
            round: number;
          }
        | undefined;

      if (
        openNeg &&
        openNeg.from_party_id !== openNeg.to_party_id &&
        openNeg.from_party_id !== party.id
      ) {
        const toward = attitudeVoteBias(party.id, openNeg.from_party_id);
        const allowSeal = toward >= -5;
        const decisionRound = isPastSoftPhase(openNeg.round);
        // Tur1: soft karşı teklif; tur≥2: bakış uygunsa accept, değilse false→çöküş
        const accept = decisionRound ? allowSeal : false;
        done = await tryAction("respondNegotiation", {
          negotiationId: openNeg.id,
          accept,
          counterMessage: accept
            ? `${party.name}, koalisyon teklifini kabul ediyor — ortak hükümet.`
            : decisionRound
              ? `${party.name}, bakış yetersiz; masa dağılabilir.`
              : `${party.name}, karşı teklif: bakanlık dengesini istiyor.`,
          ministriesRequested:
            party.slug === "left"
              ? ["labor", "education"]
              : party.slug === "right"
                ? ["interior", "defense"]
                : ["finance", "justice"],
        });
      } else if (
        assertCanInitiateGovernmentTalks(party.simulation_id, party.id).ok
      ) {
        if (openNeg && openNeg.from_party_id === openNeg.to_party_id) {
          getDb()
            .prepare(`UPDATE negotiations SET status = 'failed' WHERE id = ?`)
            .run(openNeg.id);
        }
        // Formateur: en yakın ortağa bakanlık teklif ederek masayı aç
        const offered =
          best.slug === "left"
            ? ["labor", "education"]
            : best.slug === "center"
              ? ["finance", "justice"]
              : ["interior", "defense"];
        done = await tryAction("negotiateCoalition", {
          targetPartyId: best.id,
          ministriesOffered: offered,
          constitutionalConcessions: "Ortak program, 301 sandalye hedefi, bakanlık paylaşımı",
          message: `${party.name}, ${best.name} ile hükümet kurmak için koalisyon görüşmesi açıyor.`,
        });
      }
    }
  }

  // 4) Yasama: yalnızca mühürlü iktidarda (koalisyon/formateur sürecinde ASLA)
  if (
    !done &&
    phase !== "voting" &&
    phase !== "confidence" &&
    phase === "governing" &&
    !needsCabinetFormation(party.simulation_id)
  ) {
    const enacted = new Set(
      getLawGroupStates(party.simulation_id).map((s) => s.law_id)
    );
    const blocked = getDb()
      .prepare(
        `SELECT law_id FROM bills
         WHERE simulation_id = ? AND law_id IS NOT NULL
           AND (
             status IN ('voting','in_committee','proposed')
             OR (status = 'rejected' AND resolved_month >= ?)
           )`
      )
      .all(party.simulation_id, sim.month - 8) as Array<{ law_id: string }>;
    for (const b of blocked) {
      if (b.law_id) enacted.add(b.law_id);
    }
    const pick = suggestLawsForSlug(party.slug, 1, enacted)[0];
    if (pick) {
      done = await tryAction("proposeLaw", { lawId: pick.id });
    }
  }

  // 5) Genel: miting / PR — oylama fazında ve zorunlu müzakerede yasak
  if (
    !done &&
    phase !== "voting" &&
    phase !== "confidence" &&
    forceTool !== "negotiateCoalition" &&
    forceTool !== "respondNegotiation"
  ) {
    done = await tryAction("holdRally", {
      cityId: preferredRallyCity(party.slug),
      tone: preferredRallyTone(party.slug),
      focusTopic:
        party.slug === "left"
          ? "emek ve sosyal adalet"
          : party.slug === "right"
            ? "güvenlik ve milli değerler"
            : "istikrar ve reform",
    });
  }

  if (!done) {
    done = await tryAction("issuePRStatement", {
      stance: "reform",
      statementText: `${party.name} kamuoyuna aylık siyasi duruşunu açıkladı.`,
    });
  }

  if (done) {
    insertEvent(
      party.simulation_id,
      "action_fallback",
      {
        partyName: party.name,
        partyColor: party.color,
        tool: toolsUsed[toolsUsed.length - 1],
        message: `${party.name}: sistem hamlesi (${toolsUsed[toolsUsed.length - 1]}) — model native tool kaçırdı`,
      },
      sim.month
    );
  }
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
    const preferred = preferredVoteForLaw(
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
    `Sen=${party.slug} id=${party.id}`,
    ideo ? describeIdeology(ideo) : "",
    `Özet:${summary.slice(0, 200) || "-"}`,
    `Partiler: ${partyLines}`,
    `Bakanlık: ${mins}`,
    `İttifak: ${describeAlliances(party.simulation_id).slice(0, 120)}`,
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
ARAÇ: Yalnızca native tool_calls. Metin strateji/TOOL yazma. Türkçe argüman.
YASAMA: Hükümet kurulmadan proposeLaw YASAK. Kabine mühürlenince: proposeLaw(lawId) — ideolojine ters kanun YASAK (Merkez bias≥1). Kendi teklifine Ret YASAK. Oylamada bias≥1 → Ret yasak; bias≤-1 → Kabul yasak. speechText yasa konusuna değinmeli.
KOALİSYON: Tur1 soft OK; tur≥2 accept:true (bakış uygunsa) — soft devam masa+anket cezası.`;

/** Phi-4 Reasoning / Mistral-7B gibi modeller native tool’u sık kaçırır */
function isFragileToolModel(modelId: string): boolean {
  return /phi|reasoning|think|mini|7b|8b|9b|small|tiny|mistral-?7|qwen2\.5-?(3|7|14)|gemma-?2?-?(2|9)|llama-?3\.2?-?(1|3)|deepseek-r1|r1-distill/i.test(
    modelId
  );
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
  // Koalisyon zorunluluğunda yalnız müzakere araçları — miting kaçışı yok
  if (
    forceTool === "negotiateCoalition" ||
    forceTool === "respondNegotiation"
  ) {
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
  const nativeFamily: NativeToolFamily | null = detectNativeToolFamily(modelId);
  const nativeMode = nativeFamily !== null;
  const memory =
    useMemory && !fragile && !nativeMode ? getAgentMemory(party.id, 2) : [];
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

  // Phi / Qwen / Mistral: native chat tool formatı (OpenAI tools API değil)
  const systemContent = nativeFamily
    ? buildNativeSystemPrompt(nativeFamily, {
        partyName: party.name,
        ideologyPrompt: party.system_prompt,
        tools,
        forceTool: effective.forceTool,
        compact: fragile || compactPrompt,
      })
    : fragile || compactPrompt
      ? `/no_think\n${party.name}. SADECE native function/tool_call. Metin yazma. Reasoning yazma. Türkçe argüman.`
      : `/no_think\n${party.system_prompt.slice(0, 380)}\n${TOOL_DISCIPLINE}`;

  const userPrompt = [
    fragile || nativeMode
      ? buildTurnUserPrompt(context, phaseHint(effective.phase)).slice(0, 900)
      : buildTurnUserPrompt(context, phaseHint(effective.phase)),
    nativeFamily
      ? buildNativeUserSuffix(nativeFamily, effective.forceTool)
      : effective.forceTool
        ? `\nZORUNLU: şimdi yalnızca ${effective.forceTool} tool_call. Başka metin yok.`
        : "\nEn az bir tool_call yap. Hedef parti = başka parti id.",
  ]
    .join("")
    .slice(0, fragile || nativeMode ? 1400 : MAX_CONTEXT_CHARS + 400);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...memory.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content.slice(0, 100),
    })),
    { role: "user", content: userPrompt },
  ];

  const toolsUsed: string[] = [];
  const toolsFailed: string[] = [];
  let maxTokens = nativeMode ? 1024 : fragile ? 768 : 2400;
  let activeTools = tools;

  const callLm = async (
    choice: ChatCompletionToolChoiceOption | undefined,
    tokens: number,
    toolSet: ChatCompletionTool[] | undefined = activeTools
  ) => {
    if (nativeMode) {
      return client.chat.completions.create({
        model: modelId,
        messages,
        temperature: 0.15,
        max_tokens: tokens,
      });
    }
    return client.chat.completions.create({
      model: modelId,
      messages,
      tools: toolSet,
      tool_choice: choice ?? "auto",
      temperature: fragile ? 0.1 : 0.25,
      max_tokens: tokens,
    });
  };

  const tryParseAndApplyText = async (textBlob: string): Promise<boolean> => {
    if (!textBlob.trim()) return false;
    let parsed = parseTextToolCalls(textBlob);
    if (nativeFamily) {
      const nativeParsed = parseNativeToolCalls(nativeFamily, textBlob);
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
        focusTopic:
          party.slug === "left"
            ? "emek ve sosyal adalet"
            : party.slug === "right"
              ? "güvenlik ve milli değerler"
              : "istikrar ve reform",
        partyName: party.name,
      });
      if (synth) parsed = [synth];
    }
    if (!parsed.length) return false;
    for (const p of parsed.slice(0, 2)) {
      const args = { ...p.args };
      if (p.name === "holdRally") {
        if (!args.cityId) args.cityId = preferredRallyCity(party.slug);
        if (!args.tone) args.tone = preferredRallyTone(party.slug);
        if (!args.focusTopic) {
          args.focusTopic =
            party.slug === "left"
              ? "emek ve sosyal adalet"
              : party.slug === "right"
                ? "güvenlik ve milli değerler"
                : "istikrar ve reform";
        }
      }
      await applyToolCall(party, p.name, args, toolsUsed, toolsFailed);
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
    const recoveryExampleArgs =
      effective.forceTool === "holdRally"
        ? {
            cityId: preferredRallyCity(party.slug),
            tone: preferredRallyTone(party.slug),
            focusTopic: "kampanya",
          }
        : effective.forceTool === "voteOnBill"
          ? { vote: "ABSTAIN", speechText: "Kürsüden oyumuzu açıklıyoruz." }
          : {};
    const recoveryMsgs: ChatCompletionMessageParam[] = nativeFamily
      ? [
          {
            role: "system",
            content: buildNativeSystemPrompt(nativeFamily, {
              partyName: party.name,
              tools: forcedToolDef,
              forceTool: effective.forceTool,
              compact: true,
            }),
          },
          {
            role: "user",
            content: nativeRecoveryUserHint(
              nativeFamily,
              effective.forceTool,
              recoveryExampleArgs
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
      !fragile &&
      !nativeMode &&
      maxTokens < 4000
    ) {
      maxTokens = 4000;
      messages.push({
        role: "user",
        content:
          "/no_think Kısa düşün. HEMEN tek bir tool_call üret. Hedef = başka parti.",
      });
      try {
        completion = await callLm(
          resolveToolChoice(effective.forceTool, 0, false),
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

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const fnName = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
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
        if (!args.focusTopic) {
          args.focusTopic =
            party.slug === "left"
              ? "emek ve sosyal adalet"
              : party.slug === "right"
                ? "güvenlik ve milli değerler"
                : "istikrar ve reform";
        }
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
        tool_call_id: call.id,
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
      const vote = preferredVoteForLaw(
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
        toolsFailed
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
        toolsFailed
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

  await ensurePhaseActionFallback(party, toolsUsed, effective.forceTool);

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
        const vote = preferredVoteForLaw(
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
    } else {
      await ensurePhaseActionFallback(party, toolsUsed, effective.forceTool);
    }
    return {
      ok: false,
      summary: "Model yok (yedek hamle)",
      toolsUsed,
    };
  }

  const memProbe = getAgentMemory(party.id, 20);
  const memChars = memProbe.reduce((s, m) => s + m.content.length, 0);
  if (memChars > 1200 || memProbe.length > 6) {
    clearAgentMemory(party.id);
  }

  try {
    let result: { toolsUsed: string[]; toolsFailed: string[]; ok: boolean };
    const fragile = isFragileToolModel(modelId);
    try {
      result = await runChatLoop({
        party,
        modelId,
        useMemory: !fragile,
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
    const message = err instanceof Error ? err.message : String(err);
    if (isContextOverflow(err)) clearAgentMemory(party.id);
    const toolsUsed: string[] = [];
    const effective = resolveEffectivePhase(party);
    await ensurePhaseActionFallback(party, toolsUsed, effective.forceTool);
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
        message: `${party.name} LM turu başarısız (${message.slice(0, 80)})${
          toolsUsed.length ? ` — yedek: ${toolsUsed.join(",")}` : ""
        }`,
        error: message,
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
