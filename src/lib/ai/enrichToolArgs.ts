import { getDb } from "../db/client";
import { getActiveBill, getParties } from "../db/repository";
import { attitudeVoteBias } from "../sim/attitudes";
import { lastResortShouldAccept } from "../sim/negotiationPressure";
import { shouldForceBreakAlliance } from "../sim/coalitionStress";
import { suggestLawsForParty } from "../sim/lawSuggestions";
import {
  defaultRallyFocusTopic,
  sanitizeRallyFocusTopic,
} from "../sim/rallyFocus";
import { isGovernmentBlocMember } from "../sim/resignation";
import { preferredVoteForParty, resolveLawForBill } from "../sim/voteIdeology";
import {
  partnerMinistryQuota,
  preferredMinistriesForSlug,
} from "../sim/ministries";
import type { PartyRow } from "../types";
import { canonicalizeToolName } from "./toolAliases";

const SLUG_ALIASES: Record<string, string> = {
  left: "left",
  sol: "left",
  "sol parti": "left",
  socialist: "left",
  center: "center",
  merkez: "center",
  "merkez parti": "center",
  centrist: "center",
  right: "right",
  sag: "right",
  sağ: "right",
  "sag parti": "right",
  "sağ parti": "right",
  conservative: "right",
};

function normalizeKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9_\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Modelin yazdığı parti id/slug/ad → başka parti id */
export function resolvePartyRef(
  simulationId: string,
  actorPartyId: string,
  rawTarget: unknown
): string | null {
  const parties = getParties(simulationId);
  const others = parties.filter((p) => p.id !== actorPartyId);
  if (!others.length) return null;

  const raw = String(rawTarget ?? "").trim();
  if (!raw) return null;

  const key = normalizeKey(raw);

  const byId = parties.find((p) => p.id === raw || p.id.endsWith(raw));
  if (byId && byId.id !== actorPartyId) return byId.id;

  const bySlug = parties.find(
    (p) => normalizeKey(p.slug) === key || p.slug === raw
  );
  if (bySlug && bySlug.id !== actorPartyId) return bySlug.id;

  const byName = parties.find((p) => {
    const n = normalizeKey(p.name);
    return n === key || n.includes(key) || key.includes(n);
  });
  if (byName && byName.id !== actorPartyId) return byName.id;

  const aliasSlug = SLUG_ALIASES[key];
  if (aliasSlug) {
    const hit = parties.find((p) => p.slug === aliasSlug);
    if (hit && hit.id !== actorPartyId) return hit.id;
  }

  // Kısa id parçası
  if (raw.length >= 6) {
    const partial = others.find(
      (p) => p.id.includes(raw) || raw.includes(p.id.slice(-8))
    );
    if (partial) return partial.id;
  }

  return null;
}

/** Bakışa göre en uygun ortak */
export function pickBestPartner(
  simulationId: string,
  actorPartyId: string
): PartyRow | null {
  const others = getParties(simulationId).filter((p) => p.id !== actorPartyId);
  if (!others.length) return null;
  let best = others[0];
  let bestScore = -999;
  for (const o of others) {
    const bias = attitudeVoteBias(actorPartyId, o.id);
    if (bias > bestScore) {
      bestScore = bias;
      best = o;
    }
  }
  return best;
}

/**
 * Model çıktılarındaki oy varyantlarını YES|NO|ABSTAIN'e çevir.
 * Türkçe kürsü dili + JSON tip kaçakları.
 */
export function normalizeVoteValue(raw: unknown): "YES" | "NO" | "ABSTAIN" | null {
  if (raw === true || raw === 1) return "YES";
  if (raw === false || raw === 0) return "NO";
  if (raw == null) return null;

  const s = String(raw).trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === "YES" || u === "Y" || u === "AYE" || u === "FOR" || u === "SUPPORT") {
    return "YES";
  }
  if (u === "NO" || u === "N" || u === "NAY" || u === "AGAINST" || u === "OPPOSE") {
    return "NO";
  }
  if (
    u === "ABSTAIN" ||
    u === "A" ||
    u === "ABS" ||
    u === "NEUTRAL" ||
    u === "PRESENT"
  ) {
    return "ABSTAIN";
  }

  const t = normalizeKey(s);
  if (
    /^(kabul|evet|destek|onay|lehte|olumlu|yes|aye)$/.test(t) ||
    /\bkabul\b/.test(t)
  ) {
    return "YES";
  }
  if (
    /^(ret|red|hayir|karsi|aleyhte|olumsuz|no|nay)$/.test(t) ||
    /\b(ret|red)\b/.test(t)
  ) {
    return "NO";
  }
  if (
    /^(cekimser|cekimen|cek|abstain|notr)$/.test(t) ||
    /cekimser/.test(t)
  ) {
    return "ABSTAIN";
  }

  return null;
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (
      s &&
      s !== "." &&
      s !== "-" &&
      s !== "?" &&
      s !== "…" &&
      s !== "..." &&
      s !== "null" &&
      s !== "undefined" &&
      s !== "none" &&
      s !== "n/a" &&
      s !== "na" &&
      !/^\.+$/.test(s)
    ) {
      return s;
    }
  }
  return "";
}

/** Katalog dışı / placeholder / yanlış tip (parti id vb.) lawId */
export function isGarbageLawId(raw: unknown): boolean {
  if (!firstNonEmpty(raw)) return true;
  const s = String(raw).trim();
  // Parti id / uuid yanlışlıkla lawId yazılmış
  if (/^party[_-]/i.test(s)) return true;
  if (/^(sim|bill|neg|ally|vote|conf)_/i.test(s)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return true;
  }
  // Katalog kalıbı değilse ve çok uzunsa şüpheli
  if (s.length > 48 && !/_t\d+$/i.test(s)) return true;
  return false;
}

function pickCatalogLawId(simulationId: string, slug: string): string | null {
  return suggestLawsForParty(simulationId, slug, 1)[0]?.id ?? null;
}

/** respondNegotiation için yalnız inbound masa — outbound'a yanlış bağlama yok */
function openNegotiationFor(
  simulationId: string,
  actorPartyId: string
): {
  id: string;
  from_party_id: string;
  to_party_id: string;
  round: number;
} | null {
  const asTarget = getDb()
    .prepare(
      `SELECT id, from_party_id, to_party_id, round FROM negotiations
       WHERE simulation_id = ? AND status = 'open' AND to_party_id = ?
         AND from_party_id != to_party_id
       ORDER BY updated_month DESC LIMIT 1`
    )
    .get(simulationId, actorPartyId) as
    | {
        id: string;
        from_party_id: string;
        to_party_id: string;
        round: number;
      }
    | undefined;
  return asTarget ?? null;
}

function defaultMinistriesFor(
  offererSeats: number,
  targetSlug: string,
  targetSeats?: number
): string[] {
  const quota = partnerMinistryQuota(
    offererSeats,
    targetSeats ?? Math.max(80, Math.floor(offererSeats * 0.45))
  );
  return preferredMinistriesForSlug(targetSlug).slice(0, quota);
}

/**
 * Path A — format kurtarma vs son çare karar doldurma.
 * - format: yalnızca alias/normalize/mekanik id (billId, negotiationId)
 * - last_resort: oyun aksamasın diye oy/law/hedef doldur (fallback turları)
 */
export type EnrichMode = "format" | "last_resort";

export function enrichToolArgs(
  party: PartyRow,
  fnNameRaw: string,
  rawArgs: Record<string, unknown>,
  mode: EnrichMode = "format"
): Record<string, unknown> {
  const fnName = canonicalizeToolName(fnNameRaw);
  const args: Record<string, unknown> = { ...rawArgs };
  const simId = party.simulation_id;
  const lastResort = mode === "last_resort";

  // Ortak alias alanları
  if (!args.targetPartyId) {
    args.targetPartyId =
      args.target_party_id ??
      args.target ??
      args.partyId ??
      args.toPartyId ??
      args.partnerId;
  }
  if (!args.message) {
    args.message =
      args.msg ?? args.text ?? args.counterMessage ?? args.offerMessage;
  }
  if (!args.speechText) {
    args.speechText = args.speech ?? args.statement ?? args.reason_text;
  }
  // lawId placeholder (".", "-", "none"…) → temizle, sonra alias dene
  if (isGarbageLawId(args.lawId)) {
    const alt = firstNonEmpty(
      args.law_id,
      args.law,
      args.catalogId,
      typeof args.id === "string" && /_t\d+$/i.test(args.id) ? args.id : null
    );
    args.lawId = alt || "";
  }
  if (!args.vote && args.vote !== 0 && args.vote !== false) {
    args.vote = args.oy ?? args.choice ?? args.decision;
  }
  if (!args.negotiationId) {
    args.negotiationId =
      args.negotiation_id ?? args.negId ?? args.negotiation ?? args.dealId;
  }
  if (!args.billId) {
    args.billId = args.bill_id ?? args.bill;
  }

  switch (fnName) {
    case "voteOnBill": {
      const bill = getActiveBill(simId);
      // billId mekanik — model kararı değil
      if (!firstNonEmpty(args.billId) && bill) {
        args.billId = bill.id;
      }
      const normalized = normalizeVoteValue(args.vote);
      if (normalized) {
        args.vote = normalized;
      } else if (lastResort) {
        if (bill) {
          const law = resolveLawForBill(bill);
          args.vote = preferredVoteForParty(
            party.id,
            party.slug,
            law,
            bill.proposer_id === party.id,
            attitudeVoteBias(party.id, bill.proposer_id)
          );
        } else {
          args.vote = "ABSTAIN";
        }
      }
      // Teklif sahibi: yalnız YES
      if (
        bill &&
        bill.proposer_id === party.id &&
        args.vote &&
        String(args.vote).toUpperCase() !== "YES"
      ) {
        args.vote = "YES";
      }
      // speech: format'ta boş bırakılabilir (executor hizalar); last_resort doldur
      if (lastResort && !firstNonEmpty(args.speechText)) {
        const title = bill?.title || "yasa";
        const v = String(args.vote || "ABSTAIN");
        args.speechText =
          v === "YES"
            ? `${party.name}, “${title}” metnini destekliyor.`
            : v === "NO"
              ? `${party.name}, “${title}” metnine ret oyu veriyor.`
              : `${party.name}, “${title}” konusunda çekimser kalıyor.`;
      }
      break;
    }

    case "voteConfidence": {
      const normalized = normalizeVoteValue(args.vote);
      if (normalized) args.vote = normalized;
      else if (lastResort) {
        args.vote = party.is_government ? "YES" : "NO";
      }
      if (lastResort && !firstNonEmpty(args.speechText)) {
        args.speechText = `${party.name} güvenoyu/gensoru tutumunu açıkladı: ${args.vote}`;
      }
      if (!firstNonEmpty(args.motionId)) {
        const row = getDb()
          .prepare(
            `SELECT id FROM confidence_motions
             WHERE simulation_id = ? AND status = 'voting'
             ORDER BY created_month DESC LIMIT 1`
          )
          .get(simId) as { id: string } | undefined;
        if (row) args.motionId = row.id;
      }
      break;
    }

    case "negotiateCoalition": {
      const resolved = resolvePartyRef(simId, party.id, args.targetPartyId);
      if (resolved) {
        args.targetPartyId = resolved;
      } else if (lastResort) {
        const partner = pickBestPartner(simId, party.id);
        if (partner) args.targetPartyId = partner.id;
      }
      if (lastResort && !firstNonEmpty(args.message)) {
        const target = getParties(simId).find(
          (p) => p.id === args.targetPartyId
        );
        args.message = `${party.name}, ${target?.name || "ortak"} ile hükümet kurmak için koalisyon görüşmesi açıyor.`;
      }
      if (
        lastResort &&
        (!Array.isArray(args.ministriesOffered) ||
          !(args.ministriesOffered as unknown[]).length)
      ) {
        const target = getParties(simId).find(
          (p) => p.id === args.targetPartyId
        );
        args.ministriesOffered = defaultMinistriesFor(
          party.seats,
          target?.slug || "center",
          target?.seats
        );
      }
      // Format: boş bakanlık listesi mekanik default (karar değil, şema dolgusu)
      if (
        !lastResort &&
        (!Array.isArray(args.ministriesOffered) ||
          !(args.ministriesOffered as unknown[]).length) &&
        firstNonEmpty(args.targetPartyId)
      ) {
        const target = getParties(simId).find(
          (p) => p.id === String(args.targetPartyId)
        );
        args.ministriesOffered = defaultMinistriesFor(
          party.seats,
          target?.slug || "center",
          target?.seats
        );
      }
      if (lastResort && !firstNonEmpty(args.constitutionalConcessions)) {
        args.constitutionalConcessions =
          "Ortak program, 301 sandalye hedefi, bakanlık paylaşımı";
      }
      break;
    }

    case "respondNegotiation": {
      let neg = firstNonEmpty(args.negotiationId)
        ? (getDb()
            .prepare(
              `SELECT id, from_party_id, to_party_id, round FROM negotiations WHERE id = ?`
            )
            .get(String(args.negotiationId)) as
            | {
                id: string;
                from_party_id: string;
                to_party_id: string;
                round: number;
              }
            | undefined)
        : null;

      // Açık müzakere id'si mekanik bağlama — tek açık masa varsa format kurtarma
      if (!neg || neg.from_party_id === neg.to_party_id) {
        neg = openNegotiationFor(simId, party.id);
      }
      if (neg) {
        args.negotiationId = neg.id;
        const toward = attitudeVoteBias(party.id, neg.from_party_id);

        // accept zorlanmaz — AI red hakkı
        if (typeof args.accept === "string") {
          args.accept = /^(true|1|yes|evet|kabul)$/i.test(args.accept);
        } else if (lastResort) {
          if (
            args.accept === undefined ||
            args.accept === null ||
            args.accept === ""
          ) {
            args.accept = lastResortShouldAccept({
              toward,
              round: neg.round,
            });
          }
        }

        if (
          lastResort &&
          !firstNonEmpty(args.counterMessage) &&
          !firstNonEmpty(args.message)
        ) {
          args.counterMessage = args.accept
            ? `${party.name}, koalisyon teklifini kabul ediyor — ortak hükümet.`
            : `${party.name}, teklifi yetersiz buluyor; soft karşı teklif veya red hakkı saklı.`;
        }
        if (
          lastResort &&
          (!Array.isArray(args.ministriesRequested) ||
            !(args.ministriesRequested as unknown[]).length)
        ) {
          args.ministriesRequested = defaultMinistriesFor(
            party.seats,
            party.slug,
            party.seats
          );
        }
      }
      break;
    }

    case "proposeLaw": {
      // Parti id / uuid yanlışlıkla gelirse temizle
      if (isGarbageLawId(args.lawId)) {
        args.lawId = "";
      }
      // Path A: format'ta law seçme — last_resort'ta katalogdan doldur
      if (lastResort && isGarbageLawId(args.lawId)) {
        const pick = pickCatalogLawId(simId, party.slug);
        if (pick) args.lawId = pick;
      }
      break;
    }

    case "seizePower":
    case "proposeRegimeChange": {
      if (lastResort && !firstNonEmpty(args.manifesto)) {
        args.manifesto =
          party.slug === "left"
            ? `${party.name} halk iktidarı ve toplumsal dönüşüm programını ilan eder.`
            : party.slug === "right"
              ? `${party.name} milli egemenlik ve istikrar programını ilan eder.`
              : `${party.name} anayasal düzen ve reform programını ilan eder.`;
      }
      if (
        lastResort &&
        fnName === "seizePower" &&
        !firstNonEmpty(args.regimeType)
      ) {
        args.regimeType =
          party.slug === "left"
            ? "socialist_republic"
            : party.slug === "right"
              ? "military_junta"
              : "presidential_republic";
      }
      break;
    }

    case "declareEmergency": {
      if (lastResort && !firstNonEmpty(args.rationale)) {
        args.rationale = `${party.name} kamu düzeni gerekçesiyle olağanüstü tedbir talep ediyor.`;
      }
      break;
    }

    case "proposeAlliance":
    case "launchSmearCampaign": {
      const resolved = resolvePartyRef(simId, party.id, args.targetPartyId);
      if (resolved) args.targetPartyId = resolved;
      else if (lastResort) {
        const partner = pickBestPartner(simId, party.id);
        if (partner) args.targetPartyId = partner.id;
      }
      if (
        lastResort &&
        fnName === "proposeAlliance" &&
        !firstNonEmpty(args.concessionsOffer)
      ) {
        args.concessionsOffer = "Karşılıklı destek ve bakanlık paylaşımı";
      }
      break;
    }

    case "breakAlliance": {
      let resolved = resolvePartyRef(
        simId,
        party.id,
        args.partyId ?? args.targetPartyId
      );
      if (!resolved) {
        const stress = shouldForceBreakAlliance(simId, party.id);
        if (stress.partnerId) resolved = stress.partnerId;
      }
      if (resolved) args.partyId = resolved;
      if (
        (lastResort || mode === "format") &&
        !firstNonEmpty(args.reason)
      ) {
        const stress = shouldForceBreakAlliance(simId, party.id);
        args.reason =
          stress.stress != null && stress.stress > 0
            ? `Koalisyon gerilimi sürdürülemez (stres ${stress.stress.toFixed(0)}/100).`
            : `${party.name} ittifakı gözden geçiriyor.`;
      }
      break;
    }

    case "holdRally": {
      // Şehir/ton: model yazdıysa koru; boşsa format'ta da makul default
      // (miting kararı "yap/yapma" — nerede yapılacağı ikincil)
      if (!firstNonEmpty(args.cityId) && !firstNonEmpty(args.city)) {
        args.cityId =
          party.slug === "left"
            ? "diyarbakir"
            : party.slug === "right"
              ? "konya"
              : "ankara";
      } else if (!args.cityId && args.city) {
        args.cityId = args.city;
      }
      if (!firstNonEmpty(args.tone)) {
        args.tone =
          party.slug === "left"
            ? "RADICAL"
            : party.slug === "right"
              ? "POPULIST"
              : "MODERATE";
      } else {
        const t = String(args.tone).toUpperCase();
        if (["POPULIST", "RADICAL", "MODERATE"].includes(t)) args.tone = t;
      }
      if (!firstNonEmpty(args.focusTopic)) {
        args.focusTopic = defaultRallyFocusTopic(party.slug);
      } else {
        args.focusTopic = sanitizeRallyFocusTopic(
          args.focusTopic,
          party.slug
        );
      }
      break;
    }

    case "issuePRStatement": {
      if (!firstNonEmpty(args.stance)) {
        args.stance = "reform";
      } else {
        args.stance = String(args.stance).toLowerCase();
      }
      // Muhalefet resign yapamaz → reform
      if (
        args.stance === "resign" &&
        !isGovernmentBlocMember(simId, party.id)
      ) {
        args.stance = "reform";
      }
      if (!firstNonEmpty(args.statementText) && !firstNonEmpty(args.statement)) {
        if (lastResort) {
          args.statementText =
            args.stance === "resign"
              ? `${party.name} sorumluluğu üstlenerek istifa ediyor.`
              : args.stance === "deny"
                ? `${party.name} suçlamaları reddediyor.`
                : `${party.name} reform ve şeffaflık sözü veriyor.`;
        }
      } else if (!args.statementText && args.statement) {
        args.statementText = args.statement;
      }
      break;
    }

    default:
      break;
  }

  return args;
}

/** Eksik kritik karar alanı var mı? (format enrich sonrası) */
export function missingDecisionFields(
  fnNameRaw: string,
  args: Record<string, unknown>
): string[] {
  const fnName = canonicalizeToolName(fnNameRaw);
  const miss: string[] = [];
  switch (fnName) {
    case "voteOnBill":
      if (!normalizeVoteValue(args.vote)) miss.push("vote");
      break;
    case "proposeLaw":
      if (isGarbageLawId(args.lawId)) miss.push("lawId");
      break;
    case "negotiateCoalition":
      if (!firstNonEmpty(args.targetPartyId)) miss.push("targetPartyId");
      if (!firstNonEmpty(args.message)) miss.push("message");
      break;
    case "respondNegotiation":
      if (!firstNonEmpty(args.negotiationId)) miss.push("negotiationId");
      break;
    case "seizePower":
    case "proposeRegimeChange":
      if (!firstNonEmpty(args.manifesto)) miss.push("manifesto");
      break;
    default:
      break;
  }
  return miss;
}
