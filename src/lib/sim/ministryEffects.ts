import { getDb } from "../db/client";
import {
  getMetrics,
  getParty,
  getParties,
  getSimulation,
  updateParty,
  clampMetric,
} from "../db/repository";
import type { MetricKey, MinistryKey } from "../types";
import { getMinistries } from "./ministries";
import { applyMetricImpact } from "./metrics";

type MinistryEffectDef = {
  primary: MetricKey;
  /** primary'ye uygulanacak baz etki (pozitif = metrik artar) */
  base: number;
  secondary?: MetricKey;
  secondaryBase?: number;
  /** slug çarpanı */
  left: number;
  right: number;
  center: number;
};

/**
 * Bakanlık → aylık metrik. Holder ideolojisi çarpanı belirler.
 * unemployment/fear için negatif baz = iyileşme.
 */
const EFFECTS: Record<MinistryKey, MinistryEffectDef> = {
  finance: {
    primary: "economy",
    base: 0.7,
    secondary: "inflation",
    secondaryBase: -0.35,
    left: 0.75,
    right: 1.15,
    center: 1.0,
  },
  interior: {
    primary: "security",
    base: 0.65,
    secondary: "fear",
    secondaryBase: -0.4,
    left: 0.7,
    right: 1.2,
    center: 0.95,
  },
  justice: {
    primary: "freedom",
    base: 0.6,
    secondary: "fear",
    secondaryBase: -0.25,
    left: 1.2,
    right: 0.65,
    center: 1.0,
  },
  defense: {
    primary: "security",
    base: 0.55,
    left: 0.75,
    right: 1.15,
    center: 0.95,
  },
  education: {
    primary: "freedom",
    base: 0.5,
    secondary: "economy",
    secondaryBase: 0.25,
    left: 1.15,
    right: 0.7,
    center: 1.0,
  },
  media: {
    primary: "freedom",
    base: 0.45,
    secondary: "fear",
    secondaryBase: -0.2,
    left: 1.05,
    right: 0.8,
    center: 0.95,
  },
  religious: {
    primary: "fear",
    base: 0.35,
    secondary: "freedom",
    secondaryBase: -0.3,
    left: -0.8,
    right: 1.15,
    center: 0.25,
  },
  labor: {
    primary: "unemployment",
    base: -0.7,
    secondary: "economy",
    secondaryBase: 0.3,
    left: 1.25,
    right: 0.6,
    center: 0.95,
  },
};

function slugMul(slug: string, def: MinistryEffectDef): number {
  if (slug === "left") return def.left;
  if (slug === "right") return def.right;
  return def.center;
}

/** Her ay dolu bakanlıklar metrik + influence + küçük anket etkisi üretir */
export function applyMinistryMonthlyEffects(simulationId: string): void {
  const sim = getSimulation(simulationId);
  if (!sim) return;
  const held = getMinistries(simulationId).filter((m) => m.holder_party_id);
  if (!held.length) return;

  let metrics = getMetrics(simulationId);

  for (const m of held) {
    const key = m.key as MinistryKey;
    const def = EFFECTS[key];
    if (!def) continue;
    const holder = getParty(m.holder_party_id!);
    if (!holder) continue;

    const mul = slugMul(holder.slug, def);
    const potency = ((m.influence ?? 50) / 50) * mul;

    const primaryImpact = Number((def.base * potency).toFixed(2));
    metrics = applyMetricImpact(
      simulationId,
      metrics,
      def.primary,
      primaryImpact,
      `${m.title} (${holder.name})`
    );

    if (def.secondary && def.secondaryBase != null) {
      const sec = Number((def.secondaryBase * potency).toFixed(2));
      metrics = applyMetricImpact(
        simulationId,
        metrics,
        def.secondary,
        sec,
        `${m.title} yan etki`
      );
    }

    const econ = metrics.economy;
    const inflDelta =
      econ > 55 ? 0.45 : econ < 38 ? -0.55 : (Math.random() - 0.5) * 0.35;
    getDb()
      .prepare(
        `UPDATE ministries SET influence = ? WHERE simulation_id = ? AND key = ?`
      )
      .run(
        clampMetric((m.influence ?? 50) + inflDelta, 20, 95),
        simulationId,
        m.key
      );
  }

  // Etki sessiz uygulanır — feed'e aylık ministry_effects yazılmaz

  // Bakanlık sayısı kadar küçük anket desteği (ekonomi iyiysa)
  const countByParty = new Map<string, number>();
  for (const m of held) {
    if (!m.holder_party_id) continue;
    countByParty.set(
      m.holder_party_id,
      (countByParty.get(m.holder_party_id) || 0) + 1
    );
  }
  const econOk = metrics.economy >= 45;
  for (const p of getParties(simulationId)) {
    const n = countByParty.get(p.id) || 0;
    if (!n) continue;
    const bump = Math.min(1.1, n * 0.12) * (econOk ? 1 : 0.35);
    updateParty(p.id, {
      poll_share: clampMetric(p.poll_share + bump, 5, 70),
    });
  }
}
