import type { BillRow, MetricKey } from "../types";

const METRIC_TR: Record<string, string> = {
  economy: "Ekonomi güveni",
  freedom: "Özgürlük",
  security: "Güvenlik",
  fear: "Toplumsal korku",
  inflation: "Enflasyon",
  unemployment: "İşsizlik",
};

const CATEGORY_TR: Record<string, string> = {
  economy: "Ekonomi",
  freedom: "Özgürlükler",
  security: "Güvenlik",
  welfare: "Sosyal refah",
  media: "Medya / iletişim",
  judiciary: "Yargı",
  foreign: "Dış politika",
  constitutional: "Anayasa",
  religious: "Din / inanç",
  revolutionary: "Devrimci / düzen değişimi",
};

const STATUS_TR: Record<string, string> = {
  proposed: "Teklif edildi",
  in_committee: "Komisyonda",
  voting: "Genel kurulda oylanıyor",
  passed: "Kabul edildi",
  rejected: "Reddedildi",
  vetoed_aym: "AYM iptal etti",
};

export function metricLabel(key: string): string {
  return METRIC_TR[key] || key;
}

export function categoryLabel(key: string): string {
  return CATEGORY_TR[key] || key;
}

export function billStatusLabel(status: string): string {
  return STATUS_TR[status] || status;
}

export interface BillImpactView {
  summary: string;
  gains: string[];
  losses: string[];
  sideEffects: string[];
  regimeNote: string | null;
}

/** Kanun ne getirir / ne götürür — UI ve ajan bağlamı için */
export function describeBillImpact(bill: {
  title: string;
  category: string;
  target_metric: string;
  impact_value: number;
  proposed_regime?: string | null;
  is_regime_change?: number;
  gains_text?: string | null;
  losses_text?: string | null;
  law_id?: string | null;
  is_custom?: number;
}): BillImpactView {
  const metric = metricLabel(bill.target_metric);
  const v = bill.impact_value;
  const gains: string[] = [];
  const losses: string[] = [];
  const sideEffects: string[] = [];

  if (bill.gains_text) {
    for (const g of bill.gains_text.split(" · ").filter(Boolean)) gains.push(g);
  }
  if (bill.losses_text) {
    for (const l of bill.losses_text.split(" · ").filter(Boolean)) losses.push(l);
  }

  if (!gains.length && !losses.length) {
    const invertBad = ["fear", "inflation", "unemployment"].includes(
      bill.target_metric
    );
    if (v > 0) {
      if (invertBad) {
        losses.push(`${metric} artar (+${v}) — toplum için olumsuz`);
      } else {
        gains.push(`${metric} güçlenir (+${v})`);
      }
    } else if (v < 0) {
      if (invertBad) {
        gains.push(`${metric} azalır (${v}) — rahatlama`);
      } else {
        losses.push(`${metric} zayıflar (${v})`);
      }
    }
  }

  if (bill.law_id) {
    sideEffects.push(`Katalog yasası: ${bill.law_id}`);
  }
  if (bill.is_custom) {
    sideEffects.push("Özgür slot (şablon etkileri sabit)");
  }

  // Secondary effects (mirror applyMetricImpact) — yalnızca eski faturalar
  if (!bill.law_id && !bill.is_custom) {
    const key = bill.target_metric as MetricKey;
    if (key === "economy" && v > 0) {
      sideEffects.push("Enflasyon ve işsizlik bir miktar gerileyebilir");
    }
    if (key === "economy" && v < 0) {
      sideEffects.push("Enflasyon ve işsizlik baskısı artabilir");
    }
    if (key === "freedom" && v < 0) {
      sideEffects.push("Korku iklimi sertleşebilir");
    }
    if (key === "security" && v > 0) {
      sideEffects.push("Korku azalabilir; özgürlükler biraz daralabilir");
    }
    if (key === "fear" && v > 0) {
      sideEffects.push("Özgürlük hissi düşebilir");
    }
  }
  if (bill.category === "religious" || bill.category === "church") {
    sideEffects.push("Laiklik / toplumsal kutuplaşma etkilenebilir");
  }
  if (bill.category === "media") {
    sideEffects.push("Basın özgürlüğü ve algı yönetimi etkilenir");
  }
  if (bill.category === "welfare") {
    sideEffects.push("Kamu harcaması ve seçmen memnuniyeti değişebilir");
  }

  let regimeNote: string | null = null;
  if (bill.proposed_regime || bill.is_regime_change) {
    regimeNote = `Bu yasa geçerse ülke rejimini değiştirebilir: ${bill.proposed_regime || "anayasal dönüşüm"}`;
  }

  const direction =
    gains.length && !losses.length
      ? "net kazanç odaklı"
      : losses.length && !gains.length
        ? "kısıtlayıcı / maliyetli"
        : "karışık etkili";

  const summary = `“${bill.title}” ${categoryLabel(bill.category)} yasası; ${direction}. Ana etki: ${metric} ${v > 0 ? "+" : ""}${v}.`;

  return { summary, gains, losses, sideEffects, regimeNote };
}

export function describeBillForAgent(bill: BillRow): string {
  const d = describeBillImpact(bill);
  return [
    d.summary,
    d.gains.length ? `Getiriler: ${d.gains.join("; ")}` : "",
    d.losses.length ? `Götürüler: ${d.losses.join("; ")}` : "",
    d.sideEffects.length ? `Yan etki: ${d.sideEffects.join("; ")}` : "",
    d.regimeNote || "",
  ]
    .filter(Boolean)
    .join(" | ");
}
