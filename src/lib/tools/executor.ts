import { getDb } from "../db/client";
import {
  createId,
  getAcceptedAlliancePartners,
  getActiveBill,
  getBill,
  getMetrics,
  getParties,
  getParty,
  getSimulation,
  getVotesForBill,
  insertEvent,
  updateMetrics,
  updateParty,
  updateSimulation,
  clampMetric,
} from "../db/repository";
import { applyMetricImpact } from "../sim/metrics";
import { resolveBillVote } from "../sim/parliament";
import { fallGovernment, refreshGovernmentPhase } from "../sim/coalitions";
import { runElection } from "../sim/elections";
import {
  canCallEarlyElection,
  partyExists,
} from "./validators";
import type { MetricKey, PRStance, RallyTone, RegimeType, ToolResult } from "../types";
import { MAJORITY_THRESHOLD, MAX_NEGOTIATION_ROUNDS, MINISTRY_DEFS, REGIME_LABELS } from "../types";
import {
  canSoftCounterOffer,
  collapseNegotiation,
  describeNegotiationPressure,
  isAtRoundLimit,
  isPastSoftPhase,
} from "../sim/negotiationPressure";
import { applyRegimeChange, isValidRegime, regimeAllowsElections, regimeAllowsParliament, getRegime } from "../sim/regime";
import { shareMinistriesForAlliance, reclaimPartnerMinistries, reclaimMinistriesToHolder } from "../sim/ministries";
import { hasMajority } from "../sim/parliament";
import {
  assertCanInitiateGovernmentTalks,
  canSealGovernmentCabinet,
  getMandatePartyId,
  isFormateur,
  isSealedGovernment,
  needsCabinetFormation,
  sealCabinet,
} from "../sim/mandate";
import {
  attitudeAllowsAlliance,
  attitudeAllowsNegotiation,
  mutualShift,
  attitudeVoteBias,
} from "../sim/attitudes";
import {
  buildAlignedBillSpeech,
  resolveIdeologicalVote,
  resolveLawForBill,
  speechMatchesBillTopic,
} from "../sim/voteIdeology";
import {
  canEnqueueBill,
  canUseCustomSlot,
  getCustomTemplate,
  getEnactedLawId,
  getLaw,
  getLawGroupStates,
  onCatalogLawPassed,
  onCustomLawPassed,
  recordCustomUsage,
  resolveBillPlacement,
  LAW_GROUP_LABELS,
} from "../sim/lawEngine";
import { formatDeltas, lawFitsIdeology, resolveCatalogLawId, suggestLawsForSlug } from "../sim/laws/catalog";

function getEnactedIdsForSim(simulationId: string): string[] {
  return getLawGroupStates(simulationId).map((s) => s.law_id);
}
import { describeBillImpact } from "../sim/billEffects";
import { logAlmanac } from "../sim/almanac";
import { applyRallyToRegion } from "../sim/regions";
import { appendSummaryFact, getIdeology, ideologyFromTool } from "../sim/ideology";
import { syncLegislativePhase } from "../sim/phase";
import { resolveRallyCity } from "../sim/cities";
import { sanitizePublicSpeech } from "../sim/speechSanitize";

type ExecCtx = {
  simulationId: string;
  actorPartyId: string;
};

function ok(message: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, message, data };
}
function fail(message: string, data?: Record<string, unknown>): ToolResult {
  return { ok: false, message, data };
}

function trackDecision(
  ctx: ExecCtx,
  tool: string,
  args: Record<string, unknown>,
  rationale: string
) {
  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  insertEvent(
    ctx.simulationId,
    "decision",
    {
      tool,
      args,
      rationale,
      partyId: actor.id,
      partyName: actor.name,
      partyColor: actor.color,
      message: `${actor.name} → ${tool}: ${rationale}`,
    },
    sim.month
  );
  appendSummaryFact(actor.id, `${tool}: ${rationale.slice(0, 120)}`, sim.month);
  ideologyFromTool(actor.id, tool, args);
}

function trackRejection(
  ctx: ExecCtx,
  tool: string,
  rationale: string
) {
  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  insertEvent(
    ctx.simulationId,
    "tool_rejected",
    {
      tool,
      partyId: actor.id,
      partyName: actor.name,
      partyColor: actor.color,
      message: `${actor.name} → ${tool} reddedildi: ${rationale}`,
    },
    sim.month
  );
}

export async function executePartyTool(
  ctx: ExecCtx,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  if (!regimeAllowsParliament(ctx.simulationId)) {
    const allowedWithoutParliament = new Set([
      "declareEmergency",
      "proposeRegimeChange",
      "seizePower",
      "issuePRStatement",
      "holdRally",
      "launchSmearCampaign",
    ]);
    if (!allowedWithoutParliament.has(name)) {
      const blocked = fail(
        "Meclis feshedildi; yalnızca rejim/güç araçları kullanılabilir."
      );
      trackRejection(ctx, name, blocked.message);
      return blocked;
    }
  }

  let result: ToolResult;
  switch (name) {
    case "proposeBill":
      // Eski serbest generate — bilinçli reddedilir
      result = fail(
        "Serbest proposeBill kapalı. Katalog için proposeLaw(lawId), nadir özgür slot için proposeCustomBill(templateId, title) kullanın."
      );
      break;
    case "proposeLaw":
      result = proposeLaw(ctx, args);
      break;
    case "proposeCustomBill":
      result = proposeCustomBill(ctx, args);
      break;
    case "voteOnBill":
      result = voteOnBill(ctx, args);
      break;
    case "callEarlyElection":
      result = callEarlyElection(ctx, args);
      break;
    case "proposeAlliance":
      result = proposeAlliance(ctx, args);
      break;
    case "negotiateCoalition":
      result = negotiateCoalition(ctx, args);
      break;
    case "respondNegotiation":
      result = respondNegotiation(ctx, args);
      break;
    case "breakAlliance":
      result = breakAlliance(ctx, args);
      break;
    case "holdRally":
      result = holdRally(ctx, args);
      break;
    case "launchSmearCampaign":
      result = launchSmearCampaign(ctx, args);
      break;
    case "issuePRStatement":
      result = issuePRStatement(ctx, args);
      break;
    case "moveConfidence":
      result = moveConfidence(ctx, args);
      break;
    case "voteConfidence":
      result = voteConfidence(ctx, args);
      break;
    case "proposeRegimeChange":
      result = proposeRegimeChange(ctx, args);
      break;
    case "declareEmergency":
      result = declareEmergency(ctx, args);
      break;
    case "seizePower":
      result = seizePower(ctx, args);
      break;
    default:
      result = fail(`Bilinmeyen araç: ${name}`);
  }
  if (result.ok) {
    trackDecision(ctx, name, args, result.message);
  } else {
    trackRejection(ctx, name, result.message);
  }
  return result;
}

function proposeLaw(ctx: ExecCtx, args: Record<string, unknown>): ToolResult {
  if (needsCabinetFormation(ctx.simulationId)) {
    return fail(
      "Hükümet henüz kurulmadı (formateur görevi / azınlık). Önce koalisyon: negotiateCoalition veya respondNegotiation. Yasama kabine mühürlenince açılır."
    );
  }

  const rawId = String(args.lawId || "").trim();
  const actor = getParty(ctx.actorPartyId)!;
  const resolved = resolveCatalogLawId(rawId, actor.slug);
  const law = resolved.law;
  if (!law) {
    const enacted = new Set(getEnactedIdsForSim(ctx.simulationId));
    const alts = suggestLawsForSlug(actor.slug, 5, enacted)
      .map((l) => l.id)
      .join(", ");
    return fail(
      `Bilinmeyen lawId: ${rawId}. Gerçek katalog id kullanın (policing_t2, military_t2, economy_t3…). Öneri: ${alts || "labor_t4"}`
    );
  }

  const fit = lawFitsIdeology(law, actor.slug);
  if (!fit.ok) {
    const enacted = new Set(
      getEnactedIdsForSim(ctx.simulationId)
    );
    const alts = suggestLawsForSlug(actor.slug, 3, enacted)
      .map((l) => l.id)
      .join(", ");
    return fail(
      `${fit.reason} Örnek uyumlu id: ${alts || "welfare_t3, labor_t4"}`
    );
  }

  const current = getEnactedLawId(ctx.simulationId, law.group);
  if (current === law.id) {
    return fail(
      `“${law.title}” zaten yürürlükte (${LAW_GROUP_LABELS[law.group]}).`
    );
  }

  const simEarly = getSimulation(ctx.simulationId)!;
  const recentSame = getDb()
    .prepare(
      `SELECT id, status FROM bills
       WHERE simulation_id = ? AND law_id = ?
         AND (
           status IN ('voting', 'in_committee', 'proposed')
           OR (status = 'rejected' AND resolved_month IS NOT NULL AND resolved_month >= ?)
         )
       LIMIT 1`
    )
    .get(ctx.simulationId, law.id, simEarly.month - 8) as
    | { id: string; status: string }
    | undefined;
  if (recentSame) {
    const enacted = new Set(getEnactedIdsForSim(ctx.simulationId));
    enacted.add(law.id);
    const alts = suggestLawsForSlug(actor.slug, 3, enacted)
      .map((l) => `${l.id}`)
      .join(", ");
    return fail(
      `“${law.title}” (${law.id}) ${recentSame.status === "rejected" ? "yakın zamanda reddedildi" : "zaten meclis/komisyonda"}. Başka id: ${alts || "—"}`
    );
  }

  const queue = canEnqueueBill(ctx.simulationId, law.debateMonths);
  if (!queue.ok) return fail(queue.reason);

  const sim = simEarly;
  const { gains, losses } = formatDeltas(law.deltas);
  const primaryMetric =
    (Object.keys(law.deltas)[0] as MetricKey) || "economy";
  const primaryImpact = law.deltas[primaryMetric] ?? 0;
  const status = resolveBillPlacement(ctx.simulationId, law.debateMonths);
  const id = createId("bill");

  getDb()
    .prepare(
      `INSERT INTO bills (
        id, simulation_id, title, category, target_metric, impact_value,
        status, proposer_id, created_month, debate_months_required, debate_progress,
        is_regime_change, proposed_regime,
        law_id, law_group, is_custom, template_id, deltas_json, gains_text, losses_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
    )
    .run(
      id,
      ctx.simulationId,
      law.title,
      law.group,
      primaryMetric,
      primaryImpact,
      status,
      ctx.actorPartyId,
      sim.month,
      law.debateMonths,
      law.proposedRegime ? 1 : 0,
      law.proposedRegime ?? null,
      law.id,
      law.group,
      JSON.stringify(law.deltas),
      gains.join(" · "),
      losses.join(" · ")
    );

  if (status === "voting") {
    updateSimulation(ctx.simulationId, { phase: "voting" });
  }

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "proposeLaw",
      partyName: actor.name,
      partyColor: actor.color,
      billId: id,
      lawId: law.id,
      title: law.title,
      message: `${actor.name} katalog yasası: “${law.title}” [${LAW_GROUP_LABELS[law.group]}] → ${status === "voting" ? "genel kurul" : "komisyon"}${resolved.note ? ` · ${resolved.note}` : ""}`,
    },
    sim.month
  );
  logAlmanac({
    simulationId: ctx.simulationId,
    month: sim.month,
    kind: "bill",
    title: `Teklif: ${law.title}`,
    detail: `${law.summary} Getiri: ${gains.join(", ") || "—"} / Götürü: ${losses.join(", ") || "—"}`,
    actorPartyId: actor.id,
  });

  return ok(
    `Katalog yasası sunuldu: ${law.title} (${status})${resolved.note ? ` — ${resolved.note}` : ""}`,
    {
      billId: id,
      lawId: law.id,
      status,
      group: law.group,
    }
  );
}

function proposeCustomBill(
  ctx: ExecCtx, args: Record<string, unknown>
): ToolResult {
  if (needsCabinetFormation(ctx.simulationId)) {
    return fail(
      "Hükümet henüz kurulmadı. Özgür slot yasaması kabine mühürlenince açılır — önce koalisyon görüşmeleri."
    );
  }
  const templateId = String(args.templateId || "").trim();
  const title = String(args.title || "").trim();
  const rationale = String(args.rationale || "").trim();
  const tpl = getCustomTemplate(templateId);
  if (!tpl) {
    return fail(
      "Geçersiz templateId. Özgür slot şablonlarından birini seçin (cust_stimulus, cust_amnesty, ...)."
    );
  }
  if (title.length < 8) {
    return fail("Özgür slot için anlamlı title zorunlu (min 8 karakter).");
  }
  if (rationale.length < 12) {
    return fail(
      "Özgür slot için rationale zorunlu: neden katalog yetmediğini kısaca yazın."
    );
  }

  const sim = getSimulation(ctx.simulationId)!;
  const slot = canUseCustomSlot(
    ctx.simulationId,
    ctx.actorPartyId,
    sim.month,
    sim.term
  );
  if (!slot.ok) return fail(slot.reason);

  const queue = canEnqueueBill(ctx.simulationId, tpl.debateMonths);
  if (!queue.ok) return fail(queue.reason);

  const actor = getParty(ctx.actorPartyId)!;
  const { gains, losses } = formatDeltas(tpl.deltas);
  const primaryMetric =
    (Object.keys(tpl.deltas)[0] as MetricKey) || "economy";
  const primaryImpact = tpl.deltas[primaryMetric] ?? 0;
  const status = resolveBillPlacement(ctx.simulationId, tpl.debateMonths);
  const id = createId("bill");

  getDb()
    .prepare(
      `INSERT INTO bills (
        id, simulation_id, title, category, target_metric, impact_value,
        status, proposer_id, created_month, debate_months_required, debate_progress,
        is_regime_change, proposed_regime,
        law_id, law_group, is_custom, template_id, deltas_json, gains_text, losses_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 'custom', 1, ?, ?, ?, ?)`
    )
    .run(
      id,
      ctx.simulationId,
      title,
      tpl.category,
      primaryMetric,
      primaryImpact,
      status,
      ctx.actorPartyId,
      sim.month,
      tpl.debateMonths,
      tpl.proposedRegime ? 1 : 0,
      tpl.proposedRegime ?? null,
      templateId,
      JSON.stringify(tpl.deltas),
      gains.join(" · "),
      losses.join(" · ")
    );

  recordCustomUsage(
    ctx.simulationId,
    ctx.actorPartyId,
    sim.month,
    sim.term,
    templateId,
    id
  );

  if (status === "voting") {
    updateSimulation(ctx.simulationId, { phase: "voting" });
  }

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "proposeCustomBill",
      partyName: actor.name,
      partyColor: actor.color,
      billId: id,
      title,
      message: `${actor.name} ÖZGÜR SLOT: “${title}” (şablon ${templateId}) — ${rationale.slice(0, 80)}`,
    },
    sim.month
  );

  return ok(`Özgür slot yasası sunuldu: ${title} (${status})`, {
    billId: id,
    templateId,
    status,
  });
}

function voteOnBill(ctx: ExecCtx, args: Record<string, unknown>): ToolResult {
  const billId = String(args.billId || "");
  const voteRaw = String(args.vote || "").toUpperCase();
  const speechText = String(args.speechText || "").trim();
  if (!["YES", "NO", "ABSTAIN"].includes(voteRaw)) {
    return fail("vote YES|NO|ABSTAIN olmalı");
  }
  const vote = voteRaw as "YES" | "NO" | "ABSTAIN";

  let bill = billId ? getBill(billId) : null;
  if (!bill && billId) {
    // short / partial id fallback
    const row = getDb()
      .prepare(
        `SELECT * FROM bills WHERE simulation_id = ? AND (id = ? OR id LIKE ?)`
      )
      .get(ctx.simulationId, billId, `%${billId}%`) as ReturnType<
      typeof getBill
    >;
    bill = row ?? null;
  }
  if (!bill) bill = getActiveBill(ctx.simulationId);
  if (!bill || bill.simulation_id !== ctx.simulationId) {
    return fail("Geçerli yasa bulunamadı");
  }
  if (!["proposed", "voting"].includes(bill.status)) {
    return fail("Bu yasa oylanamaz (komisyonda veya kapalı)");
  }

  const existing = getVotesForBill(bill.id).find(
    (v) => v.party_id === ctx.actorPartyId
  );
  if (existing) return fail("Bu yasaya zaten oy verdiniz");

  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  const law = resolveLawForBill(bill);

  const resolved = resolveIdeologicalVote({
    slug: actor.slug,
    law,
    vote,
    isProposer: bill.proposer_id === ctx.actorPartyId,
    attitudeBias: attitudeVoteBias(ctx.actorPartyId, bill.proposer_id),
  });
  const effectiveVote = resolved.vote;
  const coerced = resolved.coerced;
  const coerceReason = resolved.reason;

  const group = law?.group ?? (bill as { law_group?: string | null }).law_group ?? bill.category ?? null;
  const alignedFallback = buildAlignedBillSpeech({
    partyName: actor.name,
    slug: actor.slug,
    title: bill.title,
    group,
    vote: effectiveVote,
    law,
  });
  let cleanSpeech = sanitizePublicSpeech(speechText, alignedFallback);
  if (!speechMatchesBillTopic(cleanSpeech, group, bill.title)) {
    cleanSpeech = alignedFallback;
  }

  getDb()
    .prepare(
      `INSERT INTO votes (id, bill_id, party_id, vote, speech_text)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      createId("vote"),
      bill.id,
      ctx.actorPartyId,
      effectiveVote,
      cleanSpeech
    );

  const seatWeight = actor.seats;
  if (effectiveVote === "YES") {
    getDb()
      .prepare(
        `UPDATE bills SET yes_votes = yes_votes + ?, status = 'voting' WHERE id = ?`
      )
      .run(seatWeight, bill.id);
  } else if (effectiveVote === "NO") {
    getDb()
      .prepare(
        `UPDATE bills SET no_votes = no_votes + ?, status = 'voting' WHERE id = ?`
      )
      .run(seatWeight, bill.id);
  } else {
    getDb()
      .prepare(
        `UPDATE bills SET abstain_votes = abstain_votes + ?, status = 'voting' WHERE id = ?`
      )
      .run(seatWeight, bill.id);
  }

  const voteLabel =
    effectiveVote === "YES"
      ? "Kabul"
      : effectiveVote === "NO"
        ? "Ret"
        : "Çekimser";
  const coerceNote =
    coerced && coerceReason
      ? ` (${vote} → ${effectiveVote}; ${coerceReason})`
      : "";
  insertEvent(
    ctx.simulationId,
    "vote_cast",
    {
      tool: "voteOnBill",
      partyId: actor.id,
      partyName: actor.name,
      partyColor: actor.color,
      billId: bill.id,
      billTitle: bill.title,
      vote: effectiveVote,
      coercedFrom: coerced ? vote : undefined,
      coerceReason: coerced ? coerceReason : undefined,
      speechText: cleanSpeech,
      seats: seatWeight,
      message: `${actor.name}, “${bill.title}” için ${voteLabel} oyu verdi${coerceNote} — “${cleanSpeech}”`,
    },
    sim.month
  );

  // Bakış açısı: teklif sahibine göre
  if (bill.proposer_id !== ctx.actorPartyId) {
    mutualShift(
      ctx.simulationId,
      ctx.actorPartyId,
      bill.proposer_id,
      effectiveVote === "YES" ? 6 : effectiveVote === "NO" ? -8 : -1,
      `“${bill.title}” oyu: ${effectiveVote}`
    );
  }

  bill = getBill(bill.id)!;
  const parties = getParties(ctx.simulationId);
  const votes = getVotesForBill(bill.id);
  if (votes.length >= parties.length) {
    finalizeBill(ctx.simulationId, bill.id, sim.month);
  }

  return ok(
    coerced
      ? `Oy kaydedildi: ${effectiveVote} (${coerceReason || "ideoloji düzeltmesi"})`
      : `Oy kaydedildi: ${effectiveVote}`,
    {
      billId: bill.id,
      vote: effectiveVote,
      speechText: cleanSpeech,
      coerced,
      coerceReason: coerced ? coerceReason : undefined,
    }
  );
}

export function finalizeBill(
  simulationId: string,
  billId: string,
  month: number
): void {
  const bill = getBill(billId)!;
  const result = resolveBillVote(bill.yes_votes, bill.no_votes);
  getDb()
    .prepare(`UPDATE bills SET status = ?, resolved_month = ? WHERE id = ?`)
    .run(result, month, bill.id);

  if (result === "passed") {
    if (bill.law_id) {
      const law = getLaw(bill.law_id);
      if (law) {
        onCatalogLawPassed(simulationId, law, bill.proposer_id, month);
      }
    } else if (bill.is_custom && bill.template_id) {
      onCustomLawPassed(
        simulationId,
        bill.template_id,
        bill.title,
        bill.proposer_id,
        month
      );
    } else {
      // Eski generative faturalar (geçiş)
      const impactView = describeBillImpact(bill);
      applyMetricImpact(
        simulationId,
        getMetrics(simulationId),
        bill.target_metric,
        bill.impact_value,
        `Yasa kabul: “${bill.title}” — ${impactView.summary}`
      );
      if (
        bill.is_regime_change &&
        bill.proposed_regime &&
        isValidRegime(bill.proposed_regime)
      ) {
        const sim = getSimulation(simulationId)!;
        applyRegimeChange(
          sim,
          bill.proposed_regime as RegimeType,
          bill.proposer_id,
          `Anayasa/rejim yasası kabul edildi: ${bill.title}`
        );
      }
    }
    updateParty(bill.proposer_id, {
      poll_share: clampMetric(
        (getParty(bill.proposer_id)?.poll_share ?? 20) + 1.2,
        5,
        70
      ),
    });
  } else {
    updateParty(bill.proposer_id, {
      poll_share: clampMetric(
        (getParty(bill.proposer_id)?.poll_share ?? 20) - 0.8,
        5,
        70
      ),
    });
    logAlmanac({
      simulationId,
      month,
      kind: "policy",
      title: `Yasa reddedildi: “${bill.title}”`,
      detail: "Metrikler değişmedi; teklif sahibi anket kaybı yaşadı.",
      deltas: {},
      actorPartyId: bill.proposer_id,
    });
  }

  insertEvent(
    simulationId,
    "vote_result",
    {
      billId: bill.id,
      billTitle: bill.title,
      result,
      yes: bill.yes_votes,
      no: bill.no_votes,
      abstain: bill.abstain_votes,
      message:
        result === "passed"
          ? `“${bill.title}” kabul edildi (Kabul ${bill.yes_votes} / Ret ${bill.no_votes})`
          : `“${bill.title}” reddedildi (Kabul ${bill.yes_votes} / Ret ${bill.no_votes})`,
    },
    month
  );
  syncLegislativePhase(simulationId);
}

function callEarlyElection(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  if (!regimeAllowsElections(ctx.simulationId)) {
    return fail("Mevcut rejim seçimleri askıya aldı.");
  }
  const rationale = String(args.rationale || "").trim();
  const check = canCallEarlyElection(ctx.simulationId, ctx.actorPartyId);
  if (!check.ok) return fail(check.reason);

  const sim = getSimulation(ctx.simulationId)!;
  const actor = getParty(ctx.actorPartyId)!;
  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "callEarlyElection",
      partyId: actor.id,
      partyName: actor.name,
      partyColor: actor.color,
      rationale,
      message: `${actor.name} erken seçim istedi: ${rationale}`,
    },
    sim.month
  );
  updateSimulation(ctx.simulationId, { phase: "election", status: "election" });
  runElection(sim, `Erken seçim — ${actor.name}`);
  return ok("Erken seçim gerçekleşti");
}

function parseMinistryKeysFromText(text: string): string[] {
  const keys = [
    "interior",
    "finance",
    "justice",
    "defense",
    "education",
    "media",
    "religious",
    "labor",
  ];
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const k of keys) {
    if (lower.includes(k)) found.push(k);
  }
  // Turkish hints
  if (/içişleri|icisleri/i.test(text)) found.push("interior");
  if (/maliye|hazine/i.test(text)) found.push("finance");
  if (/adalet/i.test(text)) found.push("justice");
  if (/savunma|milli savunma/i.test(text)) found.push("defense");
  if (/eğitim|egitim/i.test(text)) found.push("education");
  if (/medya|iletişim|iletisim/i.test(text)) found.push("media");
  if (/din|diyanet/i.test(text)) found.push("religious");
  if (/çalışma|calisma|sosyal/i.test(text)) found.push("labor");
  return [...new Set(found)];
}

function ministryTitle(key: string): string {
  return MINISTRY_DEFS.find((m) => m.key === key)?.title || key;
}

function sealAllianceWithMinistries(
  simulationId: string,
  partyA: string,
  partyB: string,
  concessions: string,
  month: number
): string[] {
  const parties = getParties(simulationId);
  const a = parties.find((p) => p.id === partyA)!;
  const b = parties.find((p) => p.id === partyB)!;
  const leadId =
    getMandatePartyId(simulationId) ??
    parties.find((p) => p.is_government === 1)?.id ??
    null;
  const involvesLead =
    !!leadId && (leadId === a.id || leadId === b.id);
  const lead = leadId ? parties.find((p) => p.id === leadId) : null;

  mutualShift(
    simulationId,
    partyA,
    partyB,
    35,
    `İttifak: ${concessions.slice(0, 80)}`
  );

  const explicit = parseMinistryKeysFromText(concessions);
  const blocSeats = a.seats + b.seats;

  // Formateur/iktidar + ortak + 301 → mühür + bakanlık
  if (
    involvesLead &&
    lead &&
    hasMajority(blocSeats) &&
    canSealGovernmentCabinet(simulationId, partyA, partyB)
  ) {
    const partner = leadId === a.id ? b : a;

    // Zaten mühürlü kabine — yeniden "hükümet kuruldu" spam'i yok
    if (isSealedGovernment(simulationId)) {
      const given = shareMinistriesForAlliance(
        simulationId,
        leadId!,
        partner.id,
        explicit.length ? explicit : undefined,
        2
      );
      const givenTitles = given.map(ministryTitle);
      insertEvent(
        simulationId,
        "alliance_reinforced",
        {
          message: `Koalisyon yenilendi (${a.name}–${b.name}). Bakanlık ayarı: ${givenTitles.join(", ") || "değişmedi"}.`,
          partyName: lead!.name,
          partyColor: lead!.color,
          ministries: given,
        },
        month
      );
      logAlmanac({
        simulationId,
        month,
        kind: "coalition",
        title: "Koalisyon yenilendi",
        detail: `${lead!.name}+${partner.name}: mevcut mühür korundu. ${concessions.slice(0, 100)}`,
        actorPartyId: leadId!,
      });
      return given;
    }

    sealCabinet(simulationId, leadId, {
      announce: true,
      seats: blocSeats,
      partners: [partner.id],
    });
    const given = shareMinistriesForAlliance(
      simulationId,
      leadId,
      partner.id,
      explicit.length ? explicit : undefined,
      2
    );
    const givenTitles = given.map(ministryTitle);
    insertEvent(
      simulationId,
      "ministries_shared",
      {
        message: `Kabine mühürlendi. ${partner.name} bakanlık aldı: ${givenTitles.join(", ") || "—"}. İktidar: ${lead.name}.`,
        partyName: partner.name,
        partyColor: partner.color,
        ministries: given,
        ministryTitles: givenTitles,
        government: lead.name,
      },
      month
    );
    logAlmanac({
      simulationId,
      month,
      kind: "coalition",
      title: "Koalisyon hükümeti mühürlendi",
      detail: `${lead.name}+${partner.name} = ${blocSeats}. Bakanlıklar: ${givenTitles.join(", ") || "—"}. Taviz: ${concessions.slice(0, 100)}`,
      actorPartyId: leadId,
    });
    return given;
  }

  // Formateur ile ittifak ama 301 yok → siyasi ittifak, bakanlık YOK
  if (involvesLead && lead && !hasMajority(blocSeats)) {
    logAlmanac({
      simulationId,
      month,
      kind: "coalition",
      title: "Siyasi ittifak (kabine mühürlenmedi)",
      detail: `${lead.name}–${a.id === leadId ? b.name : a.name}: ${blocSeats}/301. Bakanlık yok; ek ortak veya sandalye gerekir.`,
      actorPartyId: leadId,
    });
    insertEvent(
      simulationId,
      "alliance_soft",
      {
        message: `${a.name}–${b.name} siyasi ittifak (${blocSeats}/301). Kabine mühürlenmedi — bakanlık paylaşılmadı.`,
        partyName: lead.name,
        partyColor: lead.color,
      },
      month
    );
    return [];
  }

  // Muhalefet bloğu: birlikte çoğunluk + formateur bu blokta
  if (
    hasMajority(blocSeats) &&
    canSealGovernmentCabinet(simulationId, partyA, partyB)
  ) {
    const newGov = a.seats >= b.seats ? a : b;
    const partner = newGov.id === a.id ? b : a;
    sealCabinet(simulationId, newGov.id, {
      announce: true,
      seats: blocSeats,
      partners: [partner.id],
    });
    const given = shareMinistriesForAlliance(
      simulationId,
      newGov.id,
      partner.id,
      explicit.length ? explicit : undefined,
      2
    );
    const givenTitles = given.map(ministryTitle);
    insertEvent(
      simulationId,
      "ministries_shared",
      {
        message: `${partner.name} bakanlık aldı: ${givenTitles.join(", ") || "—"}. Yeni iktidar: ${newGov.name}.`,
        partyName: partner.name,
        partyColor: partner.color,
        ministries: given,
        ministryTitles: givenTitles,
        government: newGov.name,
      },
      month
    );
    logAlmanac({
      simulationId,
      month,
      kind: "coalition",
      title: "Koalisyon hükümeti kuruldu",
      detail: `${newGov.name}+${partner.name} = ${blocSeats}. Taviz: ${concessions.slice(0, 120)}`,
      actorPartyId: newGov.id,
    });
    return given;
  }

  if (
    hasMajority(blocSeats) &&
    !canSealGovernmentCabinet(simulationId, partyA, partyB)
  ) {
    logAlmanac({
      simulationId,
      month,
      kind: "coalition",
      title: "Kabinesiz siyasi ittifak",
      detail: `${a.name}–${b.name} (${blocSeats} sandalye) formateur dışı; hükümet kurma görevi başka partide.`,
      actorPartyId: a.id,
    });
    return [];
  }

  logAlmanac({
    simulationId,
    month,
    kind: "coalition",
    title: "Siyasi ittifak (kabinesiz)",
    detail: `${a.name}–${b.name}: ${concessions.slice(0, 120)}. Sandalye ${blocSeats}/301; bakanlık paylaşılmadı.`,
    actorPartyId: a.id,
  });
  return [];
}

function proposeAlliance(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const concessionsOffer = String(args.concessionsOffer || "").trim();
  const acceptExistingId = args.acceptExistingId
    ? String(args.acceptExistingId)
    : "";
  if (!concessionsOffer) return fail("concessionsOffer zorunlu");

  const sim = getSimulation(ctx.simulationId)!;
  const actor = getParty(ctx.actorPartyId)!;
  const db = getDb();

  if (acceptExistingId) {
    const row = db
      .prepare(`SELECT * FROM alliances WHERE id = ? AND simulation_id = ?`)
      .get(acceptExistingId, ctx.simulationId) as
      | { id: string; to_party_id: string; from_party_id: string }
      | undefined;
    if (!row || row.to_party_id !== ctx.actorPartyId) {
      return fail("Kabul edilecek teklif yok");
    }
    const acceptGate = attitudeAllowsAlliance(
      ctx.actorPartyId,
      row.from_party_id
    );
    if (!acceptGate.ok) return fail(acceptGate.reason);

    db.prepare(
      `UPDATE alliances SET status = 'accepted', concessions = ? WHERE id = ?`
    ).run(concessionsOffer, acceptExistingId);
    const mins = sealAllianceWithMinistries(
      ctx.simulationId,
      row.from_party_id,
      row.to_party_id,
      concessionsOffer,
      sim.month
    );
    const fromP = getParty(row.from_party_id);
    const seatHint = (fromP?.seats ?? 0) + actor.seats;
    insertEvent(
      ctx.simulationId,
      "alliance_accepted",
      {
        message:
          mins.length > 0
            ? `${actor.name}, ittifakı kabul etti: ${concessionsOffer}. Bakanlıklar: ${mins.join(", ")}.`
            : `${actor.name}, siyasi ittifakı kabul etti (kabinesiz; birlikte ${seatHint}/600). Taviz: ${concessionsOffer}`,
        partyName: actor.name,
        partyColor: actor.color,
      },
      sim.month
    );
    refreshGovernmentPhase(getSimulation(ctx.simulationId)!);
    return ok(
      mins.length > 0
        ? "İttifak kabul edildi; bakanlıklar paylaşıldı"
        : "Siyasi ittifak kabul edildi (bakanlık paylaşımı yok)",
      { ministries: mins }
    );
  }

  const targetPartyId =
    resolveOtherPartyId(
      ctx.simulationId,
      ctx.actorPartyId,
      String(args.targetPartyId || "")
    ) || "";
  if (!targetPartyId || !partyExists(targetPartyId)) {
    return fail("Hedef parti yok");
  }
  if (targetPartyId === ctx.actorPartyId) return fail("Kendine ittifak olmaz");

  const gate = attitudeAllowsAlliance(ctx.actorPartyId, targetPartyId);
  if (!gate.ok) {
    return fail(gate.reason);
  }

  const target = getParty(targetPartyId)!;

  const pending = db
    .prepare(
      `SELECT * FROM alliances WHERE simulation_id = ? AND status = 'pending'
       AND from_party_id = ? AND to_party_id = ?`
    )
    .get(ctx.simulationId, targetPartyId, ctx.actorPartyId) as
    | { id: string; from_party_id: string; to_party_id: string }
    | undefined;

  if (pending) {
    const acceptGate = attitudeAllowsAlliance(
      ctx.actorPartyId,
      pending.from_party_id
    );
    if (!acceptGate.ok) return fail(acceptGate.reason);

    db.prepare(
      `UPDATE alliances SET status = 'accepted', concessions = ? WHERE id = ?`
    ).run(concessionsOffer, pending.id);
    const mins = sealAllianceWithMinistries(
      ctx.simulationId,
      pending.from_party_id,
      pending.to_party_id,
      concessionsOffer,
      sim.month
    );
    refreshGovernmentPhase(getSimulation(ctx.simulationId)!);
    insertEvent(
      ctx.simulationId,
      "alliance_accepted",
      {
        message:
          mins.length > 0
            ? `${actor.name} gelen ittifakı kabul etti. Bakanlık: ${mins.join(", ")}.`
            : `${actor.name} gelen siyasi ittifakı kabul etti (kabinesiz).`,
        partyName: actor.name,
        partyColor: actor.color,
      },
      sim.month
    );
    return ok(
      mins.length > 0
        ? "Gelen ittifak kabul edildi; bakanlıklar paylaşıldı"
        : "Gelen siyasi ittifak kabul edildi (kabinesiz)",
      { ministries: mins }
    );
  }

  // Çift teklif engeli: aynı yönde bekleyen/kabul edilmiş ittifak
  const existingLink = db
    .prepare(
      `SELECT id, status FROM alliances
       WHERE simulation_id = ?
         AND ((from_party_id = ? AND to_party_id = ?) OR (from_party_id = ? AND to_party_id = ?))
         AND status IN ('pending', 'accepted')
       LIMIT 1`
    )
    .get(
      ctx.simulationId,
      ctx.actorPartyId,
      targetPartyId,
      targetPartyId,
      ctx.actorPartyId
    ) as { id: string; status: string } | undefined;

  if (existingLink?.status === "accepted") {
    return fail("Bu partiyle zaten kabul edilmiş ittifak var.");
  }
  if (existingLink?.status === "pending") {
    return fail(
      "Bu hat üzerinde zaten bekleyen ittifak teklifi var. respond/accept ile ilerleyin."
    );
  }

  const initiateGate = assertCanInitiateGovernmentTalks(
    ctx.simulationId,
    ctx.actorPartyId
  );
  if (!initiateGate.ok) return fail(initiateGate.reason);

  const id = createId("ally");
  db.prepare(
    `INSERT INTO alliances (
      id, simulation_id, from_party_id, to_party_id, concessions, status, created_month
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    id,
    ctx.simulationId,
    ctx.actorPartyId,
    targetPartyId,
    concessionsOffer,
    sim.month
  );

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "proposeAlliance",
      partyName: actor.name,
      partyColor: actor.color,
      message: `${actor.name} → ${target.name} ittifak teklifi (bakış ${gate.score.toFixed(0)}): ${concessionsOffer}`,
    },
    sim.month
  );
  return ok("İttifak teklifi gönderildi", { allianceId: id });
}

function sanitizeMinistryKeys(keys: unknown): string[] {
  const allowed = new Set<string>(MINISTRY_DEFS.map((m) => m.key));
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.map((k) => String(k)).filter((k) => allowed.has(k)))];
}

/** Model kendi id/slug'ını hedef yazarsa düzelt; self/geçersizde null */
function resolveOtherPartyId(
  simulationId: string,
  actorPartyId: string,
  rawTarget: string
): string | null {
  const parties = getParties(simulationId);
  const others = parties.filter((p) => p.id !== actorPartyId);
  if (!others.length) return null;

  const raw = String(rawTarget || "").trim();
  if (!raw) return null;

  const hit =
    parties.find((p) => p.id === raw) ||
    parties.find((p) => p.slug === raw) ||
    parties.find((p) => p.name === raw);

  if (!hit || hit.id === actorPartyId) return null;
  return hit.id;
}

function negotiateCoalition(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const message = String(args.message || "").trim();
  const ministriesOffered = sanitizeMinistryKeys(args.ministriesOffered);
  const constitutionalConcessions = String(
    args.constitutionalConcessions || ""
  );
  const accept = Boolean(args.accept);
  const negotiationId = args.negotiationId
    ? String(args.negotiationId)
    : "";

  let targetPartyId = resolveOtherPartyId(
    ctx.simulationId,
    ctx.actorPartyId,
    String(args.targetPartyId || "")
  );

  // Karşı teklif: karşı tarafı müzakere kaydından al (modele güvenme)
  if (negotiationId) {
    const negRow = getDb()
      .prepare(`SELECT from_party_id, to_party_id FROM negotiations WHERE id = ?`)
      .get(negotiationId) as
      | { from_party_id: string; to_party_id: string }
      | undefined;
    if (negRow) {
      const other =
        negRow.from_party_id === ctx.actorPartyId
          ? negRow.to_party_id
          : negRow.from_party_id;
      if (other && other !== ctx.actorPartyId) {
        targetPartyId = other;
      }
    }
  }

  if (!targetPartyId || !message) {
    return fail("targetPartyId ve message zorunlu (kendine müzakere olmaz)");
  }
  if (targetPartyId === ctx.actorPartyId) {
    return fail("Kendine koalisyon müzakeresi açılamaz");
  }
  if (!partyExists(targetPartyId)) {
    return fail("Hedef parti yok");
  }

  // Yeni müzakere başlatma: yalnızca formateur (yanıt serbest)
  if (!negotiationId) {
    const mandateGate = assertCanInitiateGovernmentTalks(
      ctx.simulationId,
      ctx.actorPartyId
    );
    if (!mandateGate.ok) return fail(mandateGate.reason);
  }

  // Müzakere: yumuşak attitude (yalnızca aşırı düşmanlık engeller)
  const negGate = attitudeAllowsNegotiation(ctx.actorPartyId, targetPartyId);
  if (!negGate.ok) return fail(negGate.reason);

  const sim = getSimulation(ctx.simulationId)!;
  const actor = getParty(ctx.actorPartyId)!;
  const target = getParty(targetPartyId)!;
  const offer = {
    ministriesOffered,
    constitutionalConcessions,
    message,
  };

  if (negotiationId && accept) {
    const neg = getDb()
      .prepare(`SELECT * FROM negotiations WHERE id = ?`)
      .get(negotiationId) as
      | {
          id: string;
          to_party_id: string;
          from_party_id: string;
          offer_json: string;
          round: number;
        }
      | undefined;
    if (!neg || neg.to_party_id !== ctx.actorPartyId) {
      return fail("Müzakere bulunamadı");
    }
    if (neg.from_party_id === neg.to_party_id) {
      getDb()
        .prepare(`UPDATE negotiations SET status = 'failed' WHERE id = ?`)
        .run(negotiationId);
      return fail("Geçersiz (kendine) müzakere iptal edildi");
    }

    // Mühür = ittifak kapısı (yumuşak müzakere kabulü yetmez)
    const sealGate = attitudeAllowsAlliance(
      ctx.actorPartyId,
      neg.from_party_id
    );
    if (!sealGate.ok) {
      mutualShift(
        ctx.simulationId,
        ctx.actorPartyId,
        neg.from_party_id,
        10,
        `Yumuşama (mühür reddi): ${message.slice(0, 50)}`
      );
      return fail(
        `Kabul/mühür için bakış yetersiz (${sealGate.reason}). Soft müzakere devam edebilir — accept:false ile karşı teklif veya taviz verin.`
      );
    }

    getDb()
      .prepare(
        `UPDATE negotiations SET status = 'accepted', updated_month = ? WHERE id = ?`
      )
      .run(sim.month, negotiationId);

    const parsed = JSON.parse(neg.offer_json) as {
      ministriesOffered?: string[];
    };
    const ministries = sanitizeMinistryKeys(
      parsed.ministriesOffered || ministriesOffered
    );
    const concessionText = `${message} | bakanlık: ${ministries.join(",")}`;

    getDb()
      .prepare(
        `INSERT INTO alliances (
          id, simulation_id, from_party_id, to_party_id, concessions, status, created_month
        ) VALUES (?, ?, ?, ?, ?, 'accepted', ?)`
      )
      .run(
        createId("ally"),
        ctx.simulationId,
        neg.from_party_id,
        neg.to_party_id,
        concessionText,
        sim.month
      );

    const given = sealAllianceWithMinistries(
      ctx.simulationId,
      neg.from_party_id,
      neg.to_party_id,
      concessionText,
      sim.month
    );

    refreshGovernmentPhase(getSimulation(ctx.simulationId)!);
    insertEvent(
      ctx.simulationId,
      "negotiation_accepted",
      {
        message: `${actor.name} koalisyon müzakeresini kabul etti. ${
          given.length
            ? `Bakanlıklar: ${given.map((k) => MINISTRY_DEFS.find((m) => m.key === k)?.title || k).join(", ")}`
            : "Kabine henüz mühürlenmedi (301 yok) — siyasi ittifak."
        }`,
        partyName: actor.name,
        partyColor: actor.color,
      },
      sim.month
    );
    return ok(
      given.length
        ? "Koalisyon kabul edildi; kabine mühürlendi / bakanlıklar paylaşıldı"
        : "Koalisyon kabul edildi (siyasi ittifak); 301 için ek ortak gerekir",
      { ministries: given }
    );
  }

  if (negotiationId) {
    const neg = getDb()
      .prepare(`SELECT * FROM negotiations WHERE id = ?`)
      .get(negotiationId) as
      | {
          id: string;
          round: number;
          from_party_id: string;
          to_party_id: string;
        }
      | undefined;
    if (!neg) return fail("Müzakere yok");

    const otherId =
      neg.from_party_id === ctx.actorPartyId
        ? neg.to_party_id
        : neg.from_party_id;

    if (isAtRoundLimit(neg.round)) {
      collapseNegotiation({
        simulationId: ctx.simulationId,
        negotiationId: neg.id,
        partyA: neg.from_party_id,
        partyB: neg.to_party_id,
        reason: `Tur limiti (${MAX_NEGOTIATION_ROUNDS}) doldu — uzlaşma yok.`,
        kind: "round_limit",
      });
      return fail(
        `Müzakere tur limiti doldu — masa dağıldı (anket/bakış cezası). Yeni negotiateCoalition ile farklı teklif açın.`
      );
    }

    // Tur ≥2 soft devam = karar turunda kaçış → çöküş
    if (!accept && isPastSoftPhase(neg.round)) {
      collapseNegotiation({
        simulationId: ctx.simulationId,
        negotiationId: neg.id,
        partyA: neg.from_party_id,
        partyB: neg.to_party_id,
        reason: `Karar turunda (${neg.round}) accept:true gelmedi — masa dağıldı.`,
        kind: "decision_timeout",
      });
      return fail(
        `KARAR TURU: soft karşı teklif yasak. accept:true ile mühürleyin veya masa dağılır (dağldı). ${describeNegotiationPressure(neg.round)}`
      );
    }

    if (!accept && !canSoftCounterOffer(neg.round)) {
      collapseNegotiation({
        simulationId: ctx.simulationId,
        negotiationId: neg.id,
        partyA: neg.from_party_id,
        partyB: neg.to_party_id,
        reason: "Soft müzakere hakkı tükendi.",
        kind: "decision_timeout",
      });
      return fail("Soft tur hakkı bitti — müzakere çöktü.");
    }

    getDb()
      .prepare(
        `UPDATE negotiations SET
          round = round + 1, offer_json = ?, updated_month = ?,
          from_party_id = ?, to_party_id = ?, status = 'open'
         WHERE id = ?`
      )
      .run(
        JSON.stringify(offer),
        sim.month,
        ctx.actorPartyId,
        targetPartyId,
        negotiationId
      );

    const newRound = neg.round + 1;
    updateSimulation(ctx.simulationId, { phase: "negotiation" });
    mutualShift(
      ctx.simulationId,
      ctx.actorPartyId,
      targetPartyId,
      8,
      `Koalisyon müzakeresi: ${message.slice(0, 60)}`
    );
    insertEvent(
      ctx.simulationId,
      "negotiation_offer",
      {
        message: `${actor.name} → ${target.name} müzakere r${newRound}: ${message} | bakanlıklar: ${ministriesOffered.join(", ") || "—"} · ${describeNegotiationPressure(newRound)}`,
        partyName: actor.name,
        partyColor: actor.color,
        offer,
        round: newRound,
      },
      sim.month
    );
    return ok(
      newRound >= 2
        ? `Karşı teklif kaydı (r${newRound}). SONRAKİ hamle: accept:true veya masa dağılır.`
        : `Müzakere teklifi gönderildi (r${newRound}, bakış yumuşadı). ${describeNegotiationPressure(newRound)}`,
      { round: newRound, otherId }
    );
  } else {
    // Aynı çift için zaten açık müzakere varsa yenisini açma
    const existing = getDb()
      .prepare(
        `SELECT id, round, from_party_id, to_party_id FROM negotiations
         WHERE simulation_id = ? AND status = 'open'
         AND ((from_party_id = ? AND to_party_id = ?) OR (from_party_id = ? AND to_party_id = ?))
         LIMIT 1`
      )
      .get(
        ctx.simulationId,
        ctx.actorPartyId,
        targetPartyId,
        targetPartyId,
        ctx.actorPartyId
      ) as
      | {
          id: string;
          round: number;
          from_party_id: string;
          to_party_id: string;
        }
      | undefined;
    if (existing) {
      // Mevcut masaya soft ekleme — aynı karar kuralları
      if (isAtRoundLimit(existing.round)) {
        collapseNegotiation({
          simulationId: ctx.simulationId,
          negotiationId: existing.id,
          partyA: existing.from_party_id,
          partyB: existing.to_party_id,
          reason: `Tur limiti (${MAX_NEGOTIATION_ROUNDS}) doldu.`,
          kind: "round_limit",
        });
        return fail("Açık müzakere tur limiti doldu — masa dağıldı.");
      }
      if (isPastSoftPhase(existing.round)) {
        collapseNegotiation({
          simulationId: ctx.simulationId,
          negotiationId: existing.id,
          partyA: existing.from_party_id,
          partyB: existing.to_party_id,
          reason: "Karar turunda yeni soft teklif — masa dağıldı.",
          kind: "decision_timeout",
        });
        return fail(
          "Açık müzakere karar turunda: accept:true kullanın (respondNegotiation). Soft devam masa dağıtır."
        );
      }
      getDb()
        .prepare(
          `UPDATE negotiations SET
            round = round + 1, offer_json = ?, updated_month = ?,
            from_party_id = ?, to_party_id = ?, status = 'open'
           WHERE id = ?`
        )
        .run(
          JSON.stringify(offer),
          sim.month,
          ctx.actorPartyId,
          targetPartyId,
          existing.id
        );
    } else {
      getDb()
        .prepare(
          `INSERT INTO negotiations (
            id, simulation_id, from_party_id, to_party_id, round, offer_json,
            status, created_month, updated_month
          ) VALUES (?, ?, ?, ?, 1, ?, 'open', ?, ?)`
        )
        .run(
          createId("neg"),
          ctx.simulationId,
          ctx.actorPartyId,
          targetPartyId,
          JSON.stringify(offer),
          sim.month,
          sim.month
        );
    }
  }

  updateSimulation(ctx.simulationId, { phase: "negotiation" });
  mutualShift(
    ctx.simulationId,
    ctx.actorPartyId,
    targetPartyId,
    8,
    `Koalisyon müzakeresi: ${message.slice(0, 60)}`
  );
  insertEvent(
    ctx.simulationId,
    "negotiation_offer",
    {
      message: `${actor.name} → ${target.name} müzakere: ${message} | bakanlıklar: ${ministriesOffered.join(", ") || "—"} · ${describeNegotiationPressure(1)}`,
      partyName: actor.name,
      partyColor: actor.color,
      offer,
      round: 1,
    },
    sim.month
  );
  return ok(
    `Müzakere teklifi gönderildi (bakış açısı biraz yumuşadı). ${describeNegotiationPressure(1)}`
  );
}

function respondNegotiation(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const negotiationId = String(args.negotiationId || "");
  const neg = getDb()
    .prepare(`SELECT * FROM negotiations WHERE id = ?`)
    .get(negotiationId) as
    | { from_party_id: string; to_party_id: string }
    | undefined;
  if (!neg) return fail("Müzakere yok");
  if (neg.from_party_id === neg.to_party_id) {
    getDb()
      .prepare(`UPDATE negotiations SET status = 'failed' WHERE id = ?`)
      .run(negotiationId);
    return fail("Geçersiz kendine müzakere kapatıldı");
  }
  const counterparty =
    neg.from_party_id === ctx.actorPartyId
      ? neg.to_party_id
      : neg.from_party_id;
  if (!counterparty || counterparty === ctx.actorPartyId) {
    return fail("Karşı taraf çözülemedi");
  }

  return negotiateCoalition(ctx, {
    ...args,
    negotiationId,
    targetPartyId: counterparty,
    message: String(args.counterMessage || args.message || ""),
    ministriesOffered: sanitizeMinistryKeys(
      args.ministriesRequested || args.ministriesOffered
    ),
  });
}

function breakAlliance(ctx: ExecCtx, args: Record<string, unknown>): ToolResult {
  const partyId = String(args.partyId || "");
  const reason = String(args.reason || "").trim();
  if (!partyExists(partyId)) return fail("Parti yok");
  const sim = getSimulation(ctx.simulationId)!;
  const actor = getParty(ctx.actorPartyId)!;
  const other = getParty(partyId)!;

  const result = getDb()
    .prepare(
      `UPDATE alliances SET status = 'broken'
       WHERE simulation_id = ? AND status = 'accepted'
       AND ((from_party_id = ? AND to_party_id = ?)
         OR (from_party_id = ? AND to_party_id = ?))`
    )
    .run(ctx.simulationId, ctx.actorPartyId, partyId, partyId, ctx.actorPartyId);

  if (result.changes === 0) return fail("Aktif ittifak yok");

  mutualShift(ctx.simulationId, ctx.actorPartyId, partyId, -40, reason);

  const gov = getParties(ctx.simulationId).find((p) => p.is_government);
  if (gov) {
    const reclaimed = [
      ...reclaimPartnerMinistries(ctx.simulationId, gov.id, partyId),
      ...reclaimPartnerMinistries(ctx.simulationId, gov.id, ctx.actorPartyId),
    ];
    // Actor muhalefetteyse kendi bakanlıklarını da iade et
    if (!actor.is_government) {
      reclaimPartnerMinistries(ctx.simulationId, gov.id, ctx.actorPartyId);
    }
    if (reclaimed.length) {
      insertEvent(
        ctx.simulationId,
        "ministries_shared",
        {
          message: `İttifak bozuldu — bakanlıklar ${gov.name}’e iade edildi.`,
          partyName: gov.name,
          partyColor: gov.color,
        },
        sim.month
      );
    }
  }

  insertEvent(
    ctx.simulationId,
    "alliance_broken",
    {
      message: `${actor.name}, ${other.name} ile ittifakı bozdu: ${reason}`,
      partyName: actor.name,
      partyColor: actor.color,
    },
    sim.month
  );
  logAlmanac({
    simulationId: ctx.simulationId,
    month: sim.month,
    kind: "coalition",
    title: "İttifak bozuldu",
    detail: `${actor.name} ↔ ${other.name}: ${reason}`,
  });
  refreshGovernmentPhase(getSimulation(ctx.simulationId)!);
  return ok("İttifak bozuldu");
}

function holdRally(ctx: ExecCtx, args: Record<string, unknown>): ToolResult {
  const focusTopic = String(args.focusTopic || "").trim();
  const tone = String(args.tone || "MODERATE").toUpperCase() as RallyTone;
  if (!focusTopic) return fail("focusTopic zorunlu");

  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;

  // Ayda en fazla 1 miting — spam önleme
  const ralliesThisMonth = getDb()
    .prepare(
      `SELECT COUNT(*) as c FROM events
       WHERE simulation_id = ? AND month = ? AND type = 'tool_executed'
         AND payload LIKE '%"tool":"holdRally"%'
         AND payload LIKE ?`
    )
    .get(ctx.simulationId, sim.month, `%"partyId":"${actor.id}"%`) as {
    c: number;
  };
  if ((ralliesThisMonth?.c ?? 0) >= 1) {
    const hint = needsCabinetFormation(ctx.simulationId)
      ? "Bu ay zaten miting yaptınız. Formateur ise negotiateCoalition; gelen teklife respondNegotiation."
      : "Bu ay zaten miting yaptınız. proposeLaw veya başka bir araç kullanın.";
    return fail(hint);
  }

  const city = resolveRallyCity(String(args.cityId || ""), actor.slug);
  const topic = sanitizePublicSpeech(
    focusTopic,
    actor.slug === "left"
      ? "Emek, eşitlik ve sosyal refah"
      : actor.slug === "right"
        ? "Güvenlik, istikrar ve milli değerler"
        : "İstikrar, reform ve ekonomik denge"
  );
  const ideo = getIdeology(actor.id);
  const media = ideo?.media_power ?? 40;

  const toneBoost =
    (tone === "POPULIST" ? 2.2 : tone === "RADICAL" ? 1.4 : 1.6) *
    (0.7 + media / 100);

  applyRallyToRegion(ctx.simulationId, city, actor.id, toneBoost, sim.month);
  updateParty(actor.id, {
    poll_share: clampMetric(actor.poll_share + toneBoost * 0.5, 5, 70),
  });

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "holdRally",
      partyId: actor.id,
      partyName: actor.name,
      partyColor: actor.color,
      city,
      focusTopic: topic,
      tone,
      message: `${actor.name} ${city}'da miting (${tone}): ${topic}`,
    },
    sim.month
  );
  return ok(`Miting: ${city}`);
}

function launchSmearCampaign(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const targetPartyId = String(args.targetPartyId || "");
  const scandalType = String(args.scandalType || "corruption");
  if (!partyExists(targetPartyId) || targetPartyId === ctx.actorPartyId) {
    return fail("Geçersiz hedef");
  }
  const actor = getParty(ctx.actorPartyId)!;
  const target = getParty(targetPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  const media = getIdeology(actor.id)?.media_power ?? 40;
  const hit = 1.5 + media / 40;

  updateParty(target.id, {
    poll_share: clampMetric(target.poll_share - hit, 5, 70),
  });
  updateParty(actor.id, {
    poll_share: clampMetric(actor.poll_share + hit * 0.3, 5, 70),
  });

  mutualShift(
    ctx.simulationId,
    ctx.actorPartyId,
    targetPartyId,
    -28,
    `Karalama: ${scandalType}`
  );

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "launchSmearCampaign",
      partyName: actor.name,
      partyColor: actor.color,
      message: `${actor.name}, ${target.name} hakkında ${scandalType} dosyası açtı.`,
    },
    sim.month
  );
  return ok("Karalama başlatıldı");
}

function issuePRStatement(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const stance = String(args.stance || "deny") as PRStance;
  const statementText = String(args.statementText || "").trim();
  if (!["resign", "deny", "reform"].includes(stance) || !statementText) {
    return fail("stance ve statementText zorunlu");
  }
  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  const metrics = getMetrics(ctx.simulationId);

  if (stance === "deny") {
    updateParty(actor.id, {
      poll_share: clampMetric(actor.poll_share - 1.2, 5, 70),
    });
  } else if (stance === "resign") {
    updateParty(actor.id, {
      poll_share: clampMetric(actor.poll_share - 3, 5, 70),
    });
    updateMetrics(ctx.simulationId, {
      freedom: clampMetric(metrics.freedom + 2),
    });
  } else {
    updateParty(actor.id, {
      poll_share: clampMetric(actor.poll_share + 0.5, 5, 70),
    });
    updateMetrics(ctx.simulationId, {
      freedom: clampMetric(metrics.freedom + 3),
    });
  }

  if (sim.pending_crisis === "corruption_scandal") {
    const canClear =
      isFormateur(ctx.simulationId, ctx.actorPartyId) ||
      (actor.is_government === 1 && isSealedGovernment(ctx.simulationId));
    if (canClear) {
      updateSimulation(ctx.simulationId, {
        pending_crisis: null,
      });
      const fresh = getSimulation(ctx.simulationId);
      if (fresh) refreshGovernmentPhase(fresh);
    }
  }

  insertEvent(
    ctx.simulationId,
    "tool_executed",
    {
      tool: "issuePRStatement",
      partyName: actor.name,
      partyColor: actor.color,
      stance,
      statementText,
      message: `${actor.name} PR (${stance}): ${statementText}`,
    },
    sim.month
  );
  return ok(`PR: ${stance}`);
}

function moveConfidence(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const motionType = String(args.motionType || "censure");
  const rationale = String(args.rationale || "").trim();
  if (!rationale) return fail("rationale zorunlu");

  const existing = getDb()
    .prepare(
      `SELECT id FROM confidence_motions WHERE simulation_id = ? AND status = 'voting'`
    )
    .get(ctx.simulationId);
  if (existing) return fail("Zaten aktif gensoru/güvenoyu var");

  const sim = getSimulation(ctx.simulationId)!;
  const actor = getParty(ctx.actorPartyId)!;
  const gov = getParties(ctx.simulationId).find((p) => p.is_government);
  const id = createId("conf");

  getDb()
    .prepare(
      `INSERT INTO confidence_motions (
        id, simulation_id, motion_type, initiator_id, target_party_id,
        status, created_month
      ) VALUES (?, ?, ?, ?, ?, 'voting', ?)`
    )
    .run(
      id,
      ctx.simulationId,
      motionType,
      ctx.actorPartyId,
      gov?.id ?? null,
      sim.month
    );

  updateSimulation(ctx.simulationId, { phase: "confidence" });
  insertEvent(
    ctx.simulationId,
    "confidence_motion",
    {
      message: `${actor.name} ${motionType} verdi: ${rationale}`,
      partyName: actor.name,
      partyColor: actor.color,
      motionId: id,
    },
    sim.month
  );
  return ok(`${motionType} başlatıldı`, { motionId: id });
}

function voteConfidence(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const motionId = String(args.motionId || "");
  const vote = String(args.vote || "").toUpperCase();
  const speechText = String(args.speechText || "");
  if (!["YES", "NO", "ABSTAIN"].includes(vote)) return fail("Geçersiz oy");

  const motion = getDb()
    .prepare(
      `SELECT * FROM confidence_motions WHERE id = ? AND simulation_id = ? AND status = 'voting'`
    )
    .get(motionId, ctx.simulationId) as
    | {
        id: string;
        motion_type: string;
        yes_votes: number;
        no_votes: number;
      }
    | undefined;

  let resolvedMotion = motion;
  if (!resolvedMotion) {
    resolvedMotion = getDb()
      .prepare(
        `SELECT * FROM confidence_motions WHERE simulation_id = ? AND status = 'voting'`
      )
      .get(ctx.simulationId) as typeof motion;
    if (!resolvedMotion) return fail("Aktif gensoru yok");
  }

  const actor = getParty(ctx.actorPartyId)!;
  const sim = getSimulation(ctx.simulationId)!;
  const cleanSpeech = sanitizePublicSpeech(
    speechText,
    `${actor.name} gensoru/güvenoyunda tutumunu kayda geçirdi.`
  );

  const existed = getDb()
    .prepare(
      `SELECT id FROM confidence_votes WHERE motion_id = ? AND party_id = ?`
    )
    .get(resolvedMotion.id, ctx.actorPartyId);
  if (existed) return fail("Zaten oy verdiniz");

  getDb()
    .prepare(
      `INSERT INTO confidence_votes (id, motion_id, party_id, vote, speech_text)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(createId("cv"), resolvedMotion.id, ctx.actorPartyId, vote, cleanSpeech);

  if (vote === "YES") {
    getDb()
      .prepare(
        `UPDATE confidence_motions SET yes_votes = yes_votes + ? WHERE id = ?`
      )
      .run(actor.seats, resolvedMotion.id);
  } else if (vote === "NO") {
    getDb()
      .prepare(
        `UPDATE confidence_motions SET no_votes = no_votes + ? WHERE id = ?`
      )
      .run(actor.seats, resolvedMotion.id);
  }

  insertEvent(
    ctx.simulationId,
    "vote_cast",
    {
      message: `${actor.name} gensoruya ${vote === "YES" ? "Kabul" : vote === "NO" ? "Ret" : "Çekimser"}: ${cleanSpeech}`,
      partyName: actor.name,
      partyColor: actor.color,
      speechText: cleanSpeech,
      tool: "voteConfidence",
    },
    sim.month
  );

  const parties = getParties(ctx.simulationId);
  const votes = getDb()
    .prepare(`SELECT party_id FROM confidence_votes WHERE motion_id = ?`)
    .all(resolvedMotion.id) as Array<{ party_id: string }>;

  if (votes.length >= parties.length) {
    const m = getDb()
      .prepare(`SELECT * FROM confidence_motions WHERE id = ?`)
      .get(resolvedMotion.id) as {
      yes_votes: number;
      no_votes: number;
      motion_type: string;
    };
    const passed = m.yes_votes >= MAJORITY_THRESHOLD;
    getDb()
      .prepare(
        `UPDATE confidence_motions SET status = ?, resolved_month = ? WHERE id = ?`
      )
      .run(passed ? "passed" : "failed", sim.month, resolvedMotion.id);

    if (passed && m.motion_type === "censure") {
      fallGovernment(
        getSimulation(ctx.simulationId)!,
        "Gensoru kabul edildi. Hükümet düştü."
      );
    } else if (passed && m.motion_type === "confidence") {
      const fresh = getSimulation(ctx.simulationId)!;
      if (needsCabinetFormation(ctx.simulationId)) {
        refreshGovernmentPhase(fresh);
        insertEvent(
          ctx.simulationId,
          "confidence_passed",
          {
            message: needsCabinetFormation(ctx.simulationId)
              ? "Güvenoyu alındı ama kabine henüz 301 ile mühürlenmedi — koalisyon sürüyor."
              : "Güvenoyu alındı. Hükümet ayakta.",
          },
          sim.month
        );
      } else {
        refreshGovernmentPhase(fresh);
        insertEvent(
          ctx.simulationId,
          "confidence_passed",
          { message: "Güvenoyu alındı. Hükümet ayakta." },
          sim.month
        );
      }
    } else if (!passed && m.motion_type === "confidence") {
      fallGovernment(
        getSimulation(ctx.simulationId)!,
        "Güvenoyu alınamadı. Hükümet düştü."
      );
    } else {
      // Gensoru reddedildi — hükümet ayakta
      refreshGovernmentPhase(getSimulation(ctx.simulationId)!);
      insertEvent(
        ctx.simulationId,
        "confidence_failed",
        { message: "Gensoru reddedildi. Hükümet ayakta." },
        sim.month
      );
    }
    syncLegislativePhase(ctx.simulationId);
  }

  return ok(`Gensoru oyu: ${vote}`);
}

function canForceRegime(
  ctx: ExecCtx,
  method: string
): { ok: boolean; reason: string } {
  const actor = getParty(ctx.actorPartyId)!;
  const partners = getAcceptedAlliancePartners(
    ctx.simulationId,
    ctx.actorPartyId
  );
  const parties = getParties(ctx.simulationId);
  const bloc =
    actor.seats +
    partners.reduce(
      (s, id) => s + (parties.find((p) => p.id === id)?.seats ?? 0),
      0
    );
  const metrics = getMetrics(ctx.simulationId);
  const ideo = getIdeology(actor.id);
  const sim = getSimulation(ctx.simulationId)!;
  const crisis = !!sim.pending_crisis;

  if (method === "parliamentary_vote" && bloc >= MAJORITY_THRESHOLD) {
    return { ok: true, reason: "Meclis çoğunluğu" };
  }
  if (
    method === "emergency_decree" &&
    isSealedGovernment(ctx.simulationId) &&
    actor.is_government &&
    (metrics.fear >= 55 || crisis)
  ) {
    return { ok: true, reason: "OHAL / korku zemini (mühürlü iktidar)" };
  }
  if (
    (method === "revolution" || method === "palace_coup") &&
    ((ideo?.radicalism ?? 0) >= 45 || metrics.fear >= 65 || crisis) &&
    (bloc >= 150 || (ideo?.radicalism ?? 0) >= 60)
  ) {
    return { ok: true, reason: "Devrimci/darbe koşulları" };
  }
  if (bloc >= MAJORITY_THRESHOLD) return { ok: true, reason: "Çoğunluk" };
  return {
    ok: false,
    reason: `Yetersiz güç (blok ${bloc}, korku ${metrics.fear.toFixed(0)}, radikalizm ${(ideo?.radicalism ?? 0).toFixed(0)})`,
  };
}

function proposeRegimeChange(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const regimeType = String(args.regimeType || "");
  const method = String(args.method || "parliamentary_vote");
  const manifesto = String(args.manifesto || "").trim();
  if (!isValidRegime(regimeType)) return fail("Geçersiz rejim tipi");
  if (!manifesto) return fail("manifesto zorunlu");

  const gate = canForceRegime(ctx, method);
  if (!gate.ok) return fail(gate.reason);

  const sim = getSimulation(ctx.simulationId)!;
  applyRegimeChange(sim, regimeType as RegimeType, ctx.actorPartyId, manifesto, {
    state_religion: args.stateReligion ? String(args.stateReligion) : undefined,
    ruling_doctrine: args.rulingDoctrine
      ? String(args.rulingDoctrine)
      : undefined,
    monarch_title: args.monarchTitle ? String(args.monarchTitle) : undefined,
  });

  return ok(
    `Rejim değişti: ${REGIME_LABELS[regimeType as RegimeType]} (${gate.reason})`
  );
}

function declareEmergency(
  ctx: ExecCtx,
  args: Record<string, unknown>
): ToolResult {
  const actor = getParty(ctx.actorPartyId)!;
  if (!isSealedGovernment(ctx.simulationId) || !actor.is_government) {
    return fail(
      "OHAL yalnız mühürlü iktidar için. Formateur görevi yetmez — önce 301’lik kabine."
    );
  }
  const rationale = String(args.rationale || "").trim();
  if (!rationale) return fail("rationale zorunlu");

  const sim = getSimulation(ctx.simulationId)!;
  const metrics = getMetrics(ctx.simulationId);
  updateMetrics(ctx.simulationId, {
    freedom: clampMetric(metrics.freedom - 12),
    fear: clampMetric(metrics.fear + 10),
    security: clampMetric(metrics.security + 8),
  });

  const regime = getRegime(ctx.simulationId);
  getDb()
    .prepare(
      `UPDATE regime_state SET
        constitution_strength = ?,
        civil_liberties = ?,
        press_freedom = ?
       WHERE simulation_id = ?`
    )
    .run(
      clampMetric(regime.constitution_strength - 15),
      clampMetric(regime.civil_liberties - 18),
      clampMetric(regime.press_freedom - 20),
      ctx.simulationId
    );

  updateSimulation(ctx.simulationId, { phase: "crisis" });
  insertEvent(
    ctx.simulationId,
    "emergency_declared",
    {
      message: `${actor.name} OHAL ilan etti: ${rationale}`,
      partyName: actor.name,
      partyColor: actor.color,
    },
    sim.month
  );
  return ok("Olağanüstü hâl ilan edildi — rejim kırılması kolaylaştı");
}

function seizePower(ctx: ExecCtx, args: Record<string, unknown>): ToolResult {
  const regimeType = String(args.regimeType || "military_junta");
  const manifesto = String(args.manifesto || "").trim();
  if (!isValidRegime(regimeType)) return fail("Geçersiz rejim");
  if (!manifesto) return fail("manifesto zorunlu");

  const gate = canForceRegime(ctx, "palace_coup");
  if (!gate.ok) return fail(`Darbeye uygun değil: ${gate.reason}`);

  const sim = getSimulation(ctx.simulationId)!;
  const metrics = getMetrics(ctx.simulationId);
  updateMetrics(ctx.simulationId, {
    fear: clampMetric(metrics.fear + 25),
    freedom: clampMetric(metrics.freedom - 30),
    security: clampMetric(metrics.security + 15),
  });

  applyRegimeChange(sim, regimeType as RegimeType, ctx.actorPartyId, manifesto);
  return ok(`Güç ele geçirildi → ${REGIME_LABELS[regimeType as RegimeType]}`);
}

export function getAcceptedPartnersCached(
  simulationId: string,
  partyId: string
): string[] {
  return getAcceptedAlliancePartners(simulationId, partyId);
}

export function advanceCommitteeBills(simulationId: string, month: number): void {
  // Kabine kurulurken komisyondan genel kurula indirme — koalisyonu kesmesin
  if (needsCabinetFormation(simulationId)) return;

  // Genel kurul doluysa komisyondan indirme
  const floorBusy = getDb()
    .prepare(
      `SELECT id FROM bills WHERE simulation_id = ? AND status = 'voting' LIMIT 1`
    )
    .get(simulationId);
  if (floorBusy) return;

  const bills = getDb()
    .prepare(
      `SELECT * FROM bills WHERE simulation_id = ? AND status = 'in_committee'
       ORDER BY created_month ASC, rowid ASC`
    )
    .all(simulationId) as Array<{
    id: string;
    title: string;
    debate_progress: number;
    debate_months_required: number;
  }>;

  for (const b of bills) {
    const progress = (b.debate_progress || 0) + 1;
    if (progress >= (b.debate_months_required || 1)) {
      // Tek yasa genel kurula
      getDb()
        .prepare(
          `UPDATE bills SET debate_progress = ?, status = 'voting' WHERE id = ?`
        )
        .run(progress, b.id);
      updateSimulation(simulationId, { phase: "voting" });
      insertEvent(
        simulationId,
        "bill_to_floor",
        {
          message: `"${b.title}" komisyondan genel kurula indi.`,
          billId: b.id,
        },
        month
      );
      syncLegislativePhase(simulationId);
      break;
    }
    getDb()
      .prepare(`UPDATE bills SET debate_progress = ? WHERE id = ?`)
      .run(progress, b.id);
  }
  syncLegislativePhase(simulationId);
}
