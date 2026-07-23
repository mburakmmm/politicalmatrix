import { getDb } from "../db/client";
import { createId } from "../db/repository";

export function logAlmanac(opts: {
  simulationId: string;
  month: number;
  kind: string;
  title: string;
  detail: string;
  deltas?: Record<string, number>;
  actorPartyId?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO almanac_entries (
        id, simulation_id, month, kind, title, detail, deltas_json, actor_party_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      createId("alm"),
      opts.simulationId,
      opts.month,
      opts.kind,
      opts.title,
      opts.detail,
      JSON.stringify(opts.deltas || {}),
      opts.actorPartyId ?? null
    );
}

export function getAlmanac(
  simulationId: string,
  limit = 40
): Array<{
  id: string;
  month: number;
  kind: string;
  title: string;
  detail: string;
  deltas: Record<string, number>;
  actor_party_id: string | null;
  created_at: string;
}> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM almanac_entries WHERE simulation_id = ?
       ORDER BY month DESC, created_at DESC LIMIT ?`
    )
    .all(simulationId, limit) as Array<{
    id: string;
    month: number;
    kind: string;
    title: string;
    detail: string;
    deltas_json: string;
    actor_party_id: string | null;
    created_at: string;
  }>;

  return rows.map((r) => {
    let deltas: Record<string, number> = {};
    try {
      deltas = JSON.parse(r.deltas_json || "{}");
    } catch {
      deltas = {};
    }
    return {
      id: r.id,
      month: r.month,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      deltas,
      actor_party_id: r.actor_party_id,
      created_at: r.created_at,
    };
  });
}
