import { updateMetrics, updateParty, getParties, getSimulation } from "../db/repository";
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

export function rebalancePollsFromMetrics(
  simulationId: string,
  parties: PartyRow[],
  metrics: MetricsRow,
  rng: () => number
): PartyRow[] {
  const economyFactor = (metrics.economy - 50) / 50;
  const freedomFactor = (metrics.freedom - 50) / 50;
  const fearFactor = (metrics.fear - 40) / 50;
  const unempPressure = Math.max(0, (metrics.unemployment - 20) / 25);
  const inflationPressure = Math.max(0, (metrics.inflation - 35) / 40);

  let shares = parties.map((p) => {
    let delta = (rng() - 0.5) * 1.8;
    const sealedGov = !!p.is_government;

    if (sealedGov) {
      // Mühürlü iktidar: metrik sonuçları sert — kötü yönetim pahalı
      delta += economyFactor * 4.2;
      delta -= unempPressure * 3.5;
      delta -= inflationPressure * 2.8;
      if (metrics.fear > 60) delta -= 2.8;
      if (metrics.economy < 35) delta -= 2.5;
      if (metrics.economy > 65 && metrics.fear < 40) delta += 2.2;
    } else {
      // Muhalefet: iktidar başarısızlığından beslenir
      if (economyFactor < -0.15) delta += 2.0;
      if (unempPressure > 0.3) delta += 1.6;
      if (fearFactor > 0.4) delta += 1.2;
    }

    if (p.slug === "left") {
      delta += freedomFactor * 2.4 + (economyFactor < 0 ? 2.5 : -1.0);
      if (!sealedGov && metrics.unemployment > 28) delta += 2.4;
    } else if (p.slug === "right") {
      delta += fearFactor * 2.6 + (freedomFactor < 0 ? 1.4 : -0.8);
      if (sealedGov) delta += economyFactor * 1.2;
    } else if (p.slug === "center") {
      delta += Math.abs(economyFactor) < 0.25 ? 1.8 : -0.9;
      if (metrics.fear > 55 && metrics.economy < 45) delta -= 1.5;
      delta += (rng() - 0.5) * 1.0;
    }
    return { id: p.id, share: Math.max(5, p.poll_share + delta) };
  });

  const sum = shares.reduce((s, x) => s + x.share, 0);
  shares = shares.map((s) => ({
    id: s.id,
    share: Number(((s.share / sum) * 100).toFixed(2)),
  }));

  for (const s of shares) {
    updateParty(s.id, { poll_share: s.share });
  }

  return getParties(simulationId);
}
