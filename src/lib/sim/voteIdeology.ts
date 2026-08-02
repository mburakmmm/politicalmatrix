import type { LawDef } from "./laws/catalog";
import { biasKeyForSlug, LAW_GROUP_LABELS, type LawGroup } from "./laws/catalog";
import { getLaw } from "./laws/catalog";
import type { IdeologyRow } from "../types";
import { getIdeology } from "./ideology";

export type VoteChoice = "YES" | "NO" | "ABSTAIN";

/**
 * İdeolojik oy — yumuşak rehberlik.
 * Zorunlu tek kural: teklif sahibi kendi yasasına YES.
 * Aşırı uyum/karşıtlık (±2) yalnızca son çare yumuşatma; ±1 tamamen serbest.
 */
export function resolveIdeologicalVote(opts: {
  slug: string;
  law: LawDef | null;
  vote: VoteChoice;
  isProposer: boolean;
  attitudeBias?: number;
}): { vote: VoteChoice; coerced: boolean; reason?: string } {
  const { slug, law, isProposer } = opts;
  const attitudeBias = opts.attitudeBias ?? 0;
  let vote = opts.vote;

  if (isProposer && vote !== "YES") {
    return {
      vote: "YES",
      coerced: true,
      reason:
        vote === "ABSTAIN"
          ? "Teklif sahibi kendi yasasına Çekimser kalamaz — Kabul zorunlu"
          : "Teklif sahibi kendi yasasına Ret veremez — Kabul zorunlu",
    };
  }

  if (!law) {
    return { vote, coerced: false };
  }

  const score = law.bias[biasKeyForSlug(slug)];

  // Yalnızca aşırı uç (±2): model tamamen ters oy verdiyse hafifçe yumuşat
  if (score >= 2 && vote === "NO" && attitudeBias < -5) {
    return { vote, coerced: false };
  }
  if (score >= 2 && vote === "NO") {
    return {
      vote: "ABSTAIN",
      coerced: true,
      reason: `Güçlü ideoloji uyumu (skor ${score}): sert Ret çekimserleştirildi — taktik Ret için bakışınızı soğutun`,
    };
  }

  if (score <= -2 && vote === "YES" && attitudeBias >= 12) {
    return {
      vote: "ABSTAIN",
      coerced: true,
      reason: `Güçlü ideoloji karşıtlığı (${score}) ama teklif sahibine bakış çok sıcak — Çekimser`,
    };
  }
  return { vote, coerced: false };
}

/** Fallback / önerilen oy — model tool kaçırınca; vektör + katalog bias */
export function preferredVoteForLaw(
  slug: string,
  law: LawDef | null,
  isProposer: boolean,
  attitudeBias = 0,
  ideology?: IdeologyRow | null
): VoteChoice {
  if (isProposer) return "YES";
  if (!law) {
    if (attitudeBias >= 8) return "YES";
    if (attitudeBias <= -8) return "NO";
    return "ABSTAIN";
  }
  const score = law.bias[biasKeyForSlug(slug)];
  if (score >= 1) return "YES";
  if (score <= -1) return attitudeBias >= 10 ? "ABSTAIN" : "NO";

  // Nötr katalog (0): ekonomi eksenini vektörle kır
  const econ = ideology?.econ_left_right;
  if (econ != null && (law.group === "economy" || law.group === "taxation" || law.group === "labor" || law.group === "welfare")) {
    // Sol vektör (negatif) → sağcı ekonomi nötr yasaya soğuk
    if (econ <= -25 && (law.tier >= 4 || /piyasa|özel|liberal|laissez/i.test(law.title))) {
      return attitudeBias >= 10 ? "ABSTAIN" : "NO";
    }
    if (econ >= 25 && (law.tier <= 2 || /komuta|sendika|refah|kamulaş/i.test(law.title))) {
      return attitudeBias >= 10 ? "ABSTAIN" : "NO";
    }
  }

  if (attitudeBias >= 8) return "YES";
  if (attitudeBias <= -8) return "NO";
  return "ABSTAIN";
}

/** partyId biliniyorsa vektörü otomatik yükle */
export function preferredVoteForParty(
  partyId: string,
  slug: string,
  law: LawDef | null,
  isProposer: boolean,
  attitudeBias = 0
): VoteChoice {
  return preferredVoteForLaw(
    slug,
    law,
    isProposer,
    attitudeBias,
    getIdeology(partyId)
  );
}

const GROUP_KEYWORDS: Partial<Record<LawGroup, RegExp>> = {
  education: /eğitim|müfredat|okul|öğrenci|laik|din[iî]|öğretim/i,
  labor: /işçi|sendika|emek|ücret|çalışma|esnek piyasa|iş hukuku/i,
  welfare: /refah|sosyal|yardım|emekli|güvence/i,
  church: /din|laik|inanç|diyanet|kilise|cami/i,
  economy: /ekonomi|piyasa|büyüme|yatırım|enflasyon/i,
  taxation: /vergi|maliye|hazin/i,
  policing: /polis|güvenlik|kolluk|asayiş/i,
  military: /ordu|savunma|asker/i,
  media: /medya|basın|gazete|sansür/i,
  judiciary: /yargı|mahkeme|adalet|hukuk/i,
  healthcare: /sağlık|hastane|hekim/i,
  environment: /çevre|iklim|yeşil/i,
  housing: /konut|kira|barınma/i,
  migration: /göç|mülteci|sınır/i,
  foreign: /dış politika|diplomasi|ittifak|nato/i,
};

export function speechMatchesBillTopic(
  speech: string,
  group: string | null | undefined,
  title: string
): boolean {
  const t = speech.trim();
  if (t.length < 16) return false;
  const words = title
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length >= 4);
  let hits = 0;
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(esc, "i").test(t)) hits++;
  }
  if (hits >= 1) return true;
  // Grup anahtar kelimesi de kabul (AI özgürlüğü)
  if (group && GROUP_KEYWORDS[group as LawGroup]?.test(t)) return true;
  return false;
}

export function buildAlignedBillSpeech(opts: {
  partyName: string;
  slug: string;
  title: string;
  group: string | null | undefined;
  vote: VoteChoice;
  law?: LawDef | null;
}): string {
  const groupLabel =
    opts.group &&
    opts.group !== "custom" &&
    LAW_GROUP_LABELS[opts.group as LawGroup]
      ? LAW_GROUP_LABELS[opts.group as LawGroup]
      : opts.group && opts.group !== "custom"
        ? opts.group
        : "bu düzenleme";
  const topic = opts.title;

  if (opts.vote === "YES") {
    if (opts.slug === "left") {
      return `${opts.partyName} olarak “${topic}” teklifini emek, eşitlik ve ${groupLabel} perspektifinden destekliyoruz. Bu düzenleme halkın refahına hizmet ettiği ölçüde kabulümüzdür.`;
    }
    if (opts.slug === "right") {
      return `${opts.partyName} olarak “${topic}” düzenlemesini milli değerler, düzen ve ${groupLabel} istikrarı açısından gerekli görüyor; kabul oyu veriyoruz.`;
    }
    return `${opts.partyName} olarak “${topic}” metnini denge ve ${groupLabel} istikrarı çerçevesinde destekliyoruz. Aşırılıklardan uzak, uygulanabilir bir adım olarak kabul ediyoruz.`;
  }

  if (opts.vote === "NO") {
    if (opts.slug === "left") {
      return `${opts.partyName} “${topic}” teklifine karşıdır. ${groupLabel} alanında emekçi hakları ve laik-eşitlikçi çizgimizle bağdaşmayan bu metni reddediyoruz.`;
    }
    if (opts.slug === "right") {
      return `${opts.partyName} “${topic}” tasarısını reddediyor. ${groupLabel} düzeninde milli güvenlik ve toplumsal düzen önceliğimizle örtüşmeyen bir adımdır.`;
    }
    return `${opts.partyName} “${topic}” için ret oyudur. ${groupLabel} dengesi ve toplumsal uzlaşı açısından metni riskli buluyoruz.`;
  }

  return `${opts.partyName}, “${topic}” konusunda ${groupLabel} dengesi için çekimser kalıyor; metnin olgunlaşmasını bekliyoruz.`;
}

export function resolveLawForBill(bill: {
  law_id?: string | null;
  title: string;
}): LawDef | null {
  if (bill.law_id) return getLaw(bill.law_id) ?? null;
  return null;
}
