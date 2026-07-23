import { getDb } from "../db/client";
import { createId, getMetrics, getParties } from "../db/repository";
import { getRegime } from "./regime";
import type { MonthDiff } from "../types";

export function captureMonthSnapshot(
  simulationId: string,
  month: number,
  previousJson?: string | null
): MonthDiff {
  const parties = getParties(simulationId);
  const metrics = getMetrics(simulationId);
  const regime = getRegime(simulationId);
  const snapshot = {
    month,
    metrics,
    regime_type: regime.regime_type,
    parties: parties.map((p) => ({
      slug: p.slug,
      seats: p.seats,
      poll_share: p.poll_share,
      is_government: p.is_government,
    })),
  };
  const json = JSON.stringify(snapshot);

  const changes: string[] = [];
  let metrics_delta: Record<string, number> | undefined;
  let regime_changed = false;

  if (previousJson) {
    try {
      const prev = JSON.parse(previousJson) as typeof snapshot;
      if (prev.regime_type !== snapshot.regime_type) {
        regime_changed = true;
        changes.push(
          `Rejim: ${prev.regime_type} → ${snapshot.regime_type}`
        );
      }
      metrics_delta = {};
      for (const key of [
        "economy",
        "freedom",
        "security",
        "fear",
        "inflation",
        "unemployment",
      ] as const) {
        const d = Number(metrics[key]) - Number(prev.metrics[key]);
        if (Math.abs(d) >= 0.5) {
          metrics_delta[key] = Number(d.toFixed(2));
          changes.push(`${key} ${d > 0 ? "+" : ""}${d.toFixed(1)}`);
        }
      }
      for (const p of snapshot.parties) {
        const old = prev.parties.find((x) => x.slug === p.slug);
        if (old && old.seats !== p.seats) {
          changes.push(`${p.slug} sandalye ${old.seats}→${p.seats}`);
        }
        if (old && Math.abs(old.poll_share - p.poll_share) >= 1) {
          changes.push(
            `${p.slug} anket ${old.poll_share.toFixed(0)}→${p.poll_share.toFixed(0)}`
          );
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    changes.push("İlk ay kaydı");
  }

  const diff = { month, changes, metrics_delta, regime_changed };
  getDb()
    .prepare(
      `INSERT INTO month_snapshots (id, simulation_id, month, snapshot_json, diff_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(simulation_id, month) DO UPDATE SET
         snapshot_json = excluded.snapshot_json,
         diff_json = excluded.diff_json`
    )
    .run(
      createId("snap"),
      simulationId,
      month,
      json,
      JSON.stringify(diff)
    );

  return diff;
}

export function getPreviousSnapshotJson(
  simulationId: string,
  beforeMonth: number
): string | null {
  const row = getDb()
    .prepare(
      `SELECT snapshot_json FROM month_snapshots
       WHERE simulation_id = ? AND month < ?
       ORDER BY month DESC LIMIT 1`
    )
    .get(simulationId, beforeMonth) as { snapshot_json: string } | undefined;
  return row?.snapshot_json ?? null;
}

export function getMonthDiffs(
  simulationId: string,
  limit = 24
): MonthDiff[] {
  const rows = getDb()
    .prepare(
      `SELECT diff_json FROM month_snapshots WHERE simulation_id = ?
       ORDER BY month DESC LIMIT ?`
    )
    .all(simulationId, limit) as Array<{ diff_json: string | null }>;
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.diff_json || "{}") as MonthDiff;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as MonthDiff[];
}

export function recordLatency(opts: {
  simulationId: string;
  partyId: string | null;
  month: number;
  modelId: string | null;
  durationMs: number;
  toolCalls: number;
  ok: boolean;
  error?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO agent_latency (
        id, simulation_id, party_id, month, model_id, duration_ms, tool_calls, ok, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      createId("lat"),
      opts.simulationId,
      opts.partyId,
      opts.month,
      opts.modelId,
      opts.durationMs,
      opts.toolCalls,
      opts.ok ? 1 : 0,
      opts.error ?? null
    );
}
