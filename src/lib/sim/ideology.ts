import { getDb } from "../db/client";
import type { IdeologyRow, PartyRow } from "../types";

const DEFAULTS: Record<string, Omit<IdeologyRow, "party_id">> = {
  left: {
    econ_left_right: -45,
    auth_liberty: -25,
    secular_religious: -40,
    nation_global: -15,
    radicalism: 25,
    media_power: 45,
  },
  center: {
    econ_left_right: 0,
    auth_liberty: -5,
    secular_religious: 0,
    nation_global: 5,
    radicalism: 10,
    media_power: 50,
  },
  right: {
    econ_left_right: 35,
    auth_liberty: 30,
    secular_religious: 40,
    nation_global: 45,
    radicalism: 20,
    media_power: 45,
  },
};

function clampAxis(n: number, min = -100, max = 100): number {
  return Math.max(min, Math.min(max, Number(n.toFixed(2))));
}

export function seedIdeology(party: PartyRow): void {
  const d = DEFAULTS[party.slug] ?? DEFAULTS.center;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO ideology_vectors (
        party_id, econ_left_right, auth_liberty, secular_religious,
        nation_global, radicalism, media_power
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      party.id,
      d.econ_left_right,
      d.auth_liberty,
      d.secular_religious,
      d.nation_global,
      d.radicalism,
      d.media_power
    );
}

export function getIdeology(partyId: string): IdeologyRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM ideology_vectors WHERE party_id = ?")
      .get(partyId) as IdeologyRow | undefined) ?? null
  );
}

export function driftIdeology(
  partyId: string,
  delta: Partial<Omit<IdeologyRow, "party_id">>
): IdeologyRow {
  const cur = getIdeology(partyId);
  if (!cur) {
    seedIdeology({
      id: partyId,
      slug: "center",
    } as PartyRow);
    return driftIdeology(partyId, delta);
  }
  const next = {
    econ_left_right: clampAxis(
      cur.econ_left_right + (delta.econ_left_right ?? 0)
    ),
    auth_liberty: clampAxis(cur.auth_liberty + (delta.auth_liberty ?? 0)),
    secular_religious: clampAxis(
      cur.secular_religious + (delta.secular_religious ?? 0)
    ),
    nation_global: clampAxis(cur.nation_global + (delta.nation_global ?? 0)),
    radicalism: clampAxis(cur.radicalism + (delta.radicalism ?? 0), 0, 100),
    media_power: clampAxis(cur.media_power + (delta.media_power ?? 0), 0, 100),
  };
  getDb()
    .prepare(
      `UPDATE ideology_vectors SET
        econ_left_right = ?, auth_liberty = ?, secular_religious = ?,
        nation_global = ?, radicalism = ?, media_power = ?
       WHERE party_id = ?`
    )
    .run(
      next.econ_left_right,
      next.auth_liberty,
      next.secular_religious,
      next.nation_global,
      next.radicalism,
      next.media_power,
      partyId
    );
  return { party_id: partyId, ...next };
}

export function ideologyFromTool(
  partyId: string,
  tool: string,
  args: Record<string, unknown>
): void {
  if (tool === "proposeRegimeChange" || tool === "seizePower") {
    const regime = String(args.regimeType || "");
    if (regime.includes("communist") || regime.includes("socialist")) {
      driftIdeology(partyId, {
        econ_left_right: -12,
        auth_liberty: 8,
        radicalism: 15,
      });
    } else if (regime.includes("fascist") || regime.includes("military")) {
      driftIdeology(partyId, {
        auth_liberty: 15,
        nation_global: 12,
        radicalism: 18,
      });
    } else if (regime.includes("theocracy") || regime.includes("caliphate")) {
      driftIdeology(partyId, {
        secular_religious: 18,
        auth_liberty: 12,
        radicalism: 14,
      });
    } else if (regime.includes("monarchy")) {
      driftIdeology(partyId, {
        auth_liberty: 10,
        nation_global: 8,
        radicalism: 10,
      });
    } else if (regime.includes("anarcho")) {
      driftIdeology(partyId, {
        auth_liberty: -20,
        radicalism: 20,
        econ_left_right: -8,
      });
    }
  }
  if (tool === "holdRally" && args.tone === "RADICAL") {
    driftIdeology(partyId, { radicalism: 4, media_power: 2 });
  }
  if (tool === "launchSmearCampaign") {
    driftIdeology(partyId, { media_power: 3, auth_liberty: 2 });
  }
}

export function describeIdeology(v: IdeologyRow): string {
  return `ekonomi=${v.econ_left_right.toFixed(0)} (sol−/sağ+), otorite=${v.auth_liberty.toFixed(0)} (özgür−/otoriter+), din=${v.secular_religious.toFixed(0)} (laik−/dinci+), ulus=${v.nation_global.toFixed(0)}, radikalizm=${v.radicalism.toFixed(0)}, medya=${v.media_power.toFixed(0)}`;
}

export function ensureSummaryRow(partyId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO party_summaries (party_id, summary, updated_month)
       VALUES (?, '', 1)`
    )
    .run(partyId);
}

export function getPartySummary(partyId: string): string {
  const row = getDb()
    .prepare("SELECT summary FROM party_summaries WHERE party_id = ?")
    .get(partyId) as { summary: string } | undefined;
  return row?.summary ?? "";
}

export function updatePartySummary(
  partyId: string,
  summary: string,
  month: number
): void {
  ensureSummaryRow(partyId);
  getDb()
    .prepare(
      `UPDATE party_summaries SET summary = ?, updated_month = ? WHERE party_id = ?`
    )
    .run(summary.slice(0, 2000), month, partyId);
}

export function appendSummaryFact(
  partyId: string,
  fact: string,
  month: number
): void {
  const prev = getPartySummary(partyId);
  const line = `Ay${month}: ${fact}`;
  const next = prev ? `${prev}\n${line}` : line;
  const lines = next.split("\n").slice(-18);
  updatePartySummary(partyId, lines.join("\n"), month);
}
