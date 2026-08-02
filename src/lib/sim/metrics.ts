import {
  updateMetrics,
  updateParty,
  getParties,
  getSimulation,
  getRecentEvents,
  getAcceptedAlliancePartners,
} from "../db/repository";
import type { MetricsRow, MetricKey, PartyRow } from "../types";
import { clampMetric } from "../db/repository";
import { logAlmanac } from "./almanac";
import { metricLabel } from "./billEffects";

export function driftMetrics(
  simulationId: string,
  metrics: MetricsRow,
  rng: () => number
): MetricsRow {
  const before = { ...metrics };
  const inflationPressure = (metrics.inflation - 30) / 100;
  const fearPressure = (metrics.fear - 40) / 100;

  const next = updateMetrics(simulationId, {
    economy: clampMetric(
      metrics.economy - inflationPressure * 4 + (rng() - 0.5) * 2
    ),
    freedom: clampMetric(metrics.freedom + (rng() - 0.52) * 1.5),
    security: clampMetric(
      metrics.security + fearPressure * 1.5 + (rng() - 0.5) * 1.2
    ),
    fear: clampMetric(
      metrics.fear + inflationPressure * 3 + (rng() - 0.45) * 2
    ),
    inflation: clampMetric(
      metrics.inflation + (50 - metrics.economy) * 0.04 + (rng() - 0.5) * 2
    ),
    unemployment: clampMetric(
      metrics.unemployment +
        (45 - metrics.economy) * 0.03 +
        (rng() - 0.5) * 1.5
    ),
  });

  const deltas: Record<string, number> = {};
  for (const k of [
    "economy",
    "freedom",
    "security",
    "fear",
    "inflation",
    "unemployment",
  ] as const) {
    const d = next[k] - before[k];
    if (Math.abs(d) >= 0.8) deltas[k] = Number(d.toFixed(1));
  }
  if (Object.keys(deltas).length) {
    const sim = getSimulation(simulationId);
    logAlmanac({
      simulationId,
      month: sim?.month ?? 0,
      kind: "drift",
      title: "Aylık toplumsal/ekonomik kayma",
      detail:
        "Enflasyon, korku ve büyüme baskılarıyla doğal salınım. Büyük olay yoksa da ülke her ay biraz değişir.",
      deltas,
    });
  }

  return next;
}

export function applyMetricImpact(
  simulationId: string,
  metrics: MetricsRow,
  target: MetricKey | string,
  impact: number,
  reason?: string
): MetricsRow {
  const key = target as keyof Omit<MetricsRow, "simulation_id">;
  if (!(key in metrics) || key === undefined) return metrics;

  const before = { ...metrics };
  const patch: Partial<Omit<MetricsRow, "simulation_id">> = {
    [key]: clampMetric(Number(metrics[key]) + impact),
  };

  if (key === "economy" && impact > 0) {
    patch.inflation = clampMetric(metrics.inflation - impact * 0.3);
    patch.unemployment = clampMetric(metrics.unemployment - impact * 0.25);
  }
  if (key === "economy" && impact < 0) {
    patch.inflation = clampMetric(metrics.inflation - impact * 0.2);
    patch.unemployment = clampMetric(metrics.unemployment - impact * 0.15);
  }
  if (key === "freedom" && impact < 0) {
    patch.fear = clampMetric(metrics.fear - impact * 0.4);
  }
  if (key === "security" && impact > 0) {
    patch.fear = clampMetric(metrics.fear - impact * 0.35);
    patch.freedom = clampMetric(metrics.freedom - impact * 0.2);
  }
  if (key === "fear" && impact > 0) {
    patch.freedom = clampMetric(metrics.freedom - impact * 0.3);
  }

  const next = updateMetrics(simulationId, patch);

  const deltas: Record<string, number> = {};
  for (const k of Object.keys(patch) as Array<keyof typeof before>) {
    if (k === "simulation_id") continue;
    const d = Number(next[k as keyof MetricsRow]) - Number(before[k]);
    if (Math.abs(d) >= 0.05) deltas[String(k)] = Number(d.toFixed(1));
  }

  const sim = getSimulation(simulationId);
  const sign = impact > 0 ? "+" : "";
  logAlmanac({
    simulationId,
    month: sim?.month ?? 0,
    kind: "policy",
    title: reason || `${metricLabel(String(target))} ${sign}${impact}`,
    detail: reason
      ? `${reason} → ana etki: ${metricLabel(String(target))} ${sign}${impact}`
      : `Politika/olay etkisi: ${metricLabel(String(target))} ${sign}${impact}`,
    deltas,
  });

  return next;
}

/** Kriz anında iktidar bloğu (fatura sahipleri) */
export function currentGovernmentBlocIds(simulationId: string): {
  leadId: string | null;
  partnerIds: string[];
  all: string[];
} {
  const parties = getParties(simulationId);
  const leadId = parties.find((p) => p.is_government)?.id ?? null;
  if (!leadId) return { leadId: null, partnerIds: [], all: [] };
  const partnerIds = getAcceptedAlliancePartners(simulationId, leadId);
  return { leadId, partnerIds, all: [leadId, ...partnerIds] };
}

type CrisisScar = {
  blameIds: Set<string>;
  leadId: string | null;
  ageMonths: number;
  crisis: string;
};

/** Son kriz olayından miras fatura — kim çıkardıysa iz bırakır */
function readCrisisScar(
  simulationId: string,
  month: number
): CrisisScar | null {
  const events = getRecentEvents(simulationId, 80);
  const crisisEv = events.find((e) => e.type === "crisis");
  if (!crisisEv) return null;
  const age = month - crisisEv.month;
  if (age < 0 || age > 24) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(crisisEv.payload || "{}");
  } catch {
    payload = {};
  }
  const blame = payload.blamePartyIds;
  const ids = Array.isArray(blame)
    ? blame.map(String)
    : payload.blameLeadId
      ? [String(payload.blameLeadId)]
      : [];
  if (!ids.length) return null;
  return {
    blameIds: new Set(ids),
    leadId: payload.blameLeadId ? String(payload.blameLeadId) : ids[0],
    ageMonths: age,
    crisis: String(payload.crisis || "crisis"),
  };
}

/**
 * Anket yeniden dengeleme.
 * - İktidar BLOKU (lider+ortak) kötü metrikten birlikte zarar görür (ortak daha az).
 * - Krizi çıkaran eski iktidar muhalefetteyken “beslenmez”; iz bırakır.
 * - Yeni hükümet balayı: miras krizin faturasını ilk aylarda tam yemez.
 */
export function rebalancePollsFromMetrics(
  simulationId: string,
  parties: PartyRow[],
  metrics: MetricsRow,
  rng: () => number
): PartyRow[] {
  const sim = getSimulation(simulationId);
  const month = sim?.month ?? 1;
  const economyFactor = (metrics.economy - 50) / 50;
  const freedomFactor = (metrics.freedom - 50) / 50;
  const fearFactor = (metrics.fear - 40) / 50;
  const unempPressure = Math.max(0, (metrics.unemployment - 20) / 25);
  const inflationPressure = Math.max(0, (metrics.inflation - 35) / 40);
  const economyBad = economyFactor < -0.12 || metrics.economy < 40;

  const bloc = currentGovernmentBlocIds(simulationId);
  const partnerSet = new Set(bloc.partnerIds);
  const sealedMonth = Number(
    (sim as { gov_sealed_month?: number | null } | undefined)?.gov_sealed_month ??
      0
  );
  const tenureMonths =
    sealedMonth > 0 && bloc.leadId ? Math.max(0, month - sealedMonth) : 99;

  // Balayı: ilk 8 ay miras kriz/kötü metrik faturası ramp
  // 0. ay → %20 sorumluluk, 8. ay → %100
  const honeymoonMul =
    tenureMonths >= 8
      ? 1
      : Math.max(0.2, 0.2 + (tenureMonths / 8) * 0.8);

  const scar = readCrisisScar(simulationId, month);
  // İz gücü: 0–18 ayda lineer sönüm
  const scarStrength = scar
    ? Math.max(0, 1 - scar.ageMonths / 18)
    : 0;

  let shares = parties.map((p) => {
    let delta = (rng() - 0.5) * 1.0;
    const isLead = !!p.is_government || p.id === bloc.leadId;
    const isPartner = partnerSet.has(p.id);
    const inBloc = isLead || isPartner;

    if (inBloc) {
      // Blok faturası: lider 100%, ortak ~55%
      let roleMul = isLead ? 1 : 0.55;
      // Kötü metrik + yeni iktidar → balayı (krizi onlar çıkarmadı)
      if (economyBad) {
        roleMul *= honeymoonMul;
      }

      delta += economyFactor * 3.0 * roleMul;
      delta -= unempPressure * 2.4 * roleMul;
      delta -= inflationPressure * 2.0 * roleMul;
      if (metrics.fear > 60) delta -= 1.8 * roleMul;
      if (metrics.economy < 35) delta -= 1.6 * roleMul;
      if (metrics.economy > 65 && metrics.fear < 40) {
        delta += 1.8 * roleMul;
      }

      // İdeoloji: iktidarda muhalefet bonusu YOK (eski bug)
      if (p.slug === "left") delta += freedomFactor * 0.8;
      else if (p.slug === "right") delta += fearFactor * 0.6;
      else delta += Math.abs(economyFactor) < 0.2 ? 0.6 : -0.3;
    } else {
      // Muhalefet: iktidar başarısızlığından beslenir
      let feast = 0;
      if (economyFactor < -0.15) feast += 1.6;
      if (unempPressure > 0.3) feast += 1.2;
      if (fearFactor > 0.4) feast += 0.9;

      if (p.slug === "left") {
        feast += freedomFactor * 1.2;
        if (metrics.unemployment > 28) feast += 1.4;
        if (economyFactor < 0) feast += 1.2;
      } else if (p.slug === "right") {
        feast += fearFactor * 1.4;
        if (freedomFactor < 0) feast += 0.8;
      } else {
        feast += Math.abs(economyFactor) < 0.25 ? 1.0 : -0.4;
        if (metrics.fear > 55 && metrics.economy < 45) feast -= 0.8;
      }

      // Krizi çıkaran eski iktidar muhalefette “beslenmesin”
      if (scar && scar.blameIds.has(p.id) && scarStrength > 0) {
        const isScarLead = scar.leadId === p.id;
        feast *= 1 - 0.9 * scarStrength;
        // Aktif iz: eski lider daha çok, ortak daha az
        delta -= scarStrength * (isScarLead ? 2.2 : 1.1);
      }

      delta += feast;
    }

    // Aylık şok tavanı — 45→8 tek çeyrekte olmasın
    delta = Math.max(-4.5, Math.min(4.5, delta));

    return { id: p.id, share: Math.max(8, p.poll_share + delta) };
  });

  const sum = shares.reduce((s, x) => s + x.share, 0) || 1;
  shares = shares.map((s) => ({
    id: s.id,
    share: Number(((s.share / sum) * 100).toFixed(2)),
  }));

  // Yeniden normalizasyon sonrası taban: kimse %6 altına düşmesin
  shares = shares.map((s) => ({
    id: s.id,
    share: Math.max(6, s.share),
  }));
  const sum2 = shares.reduce((s, x) => s + x.share, 0) || 1;
  shares = shares.map((s) => ({
    id: s.id,
    share: Number(((s.share / sum2) * 100).toFixed(2)),
  }));

  for (const s of shares) {
    updateParty(s.id, { poll_share: s.share });
  }

  return getParties(simulationId);
}
