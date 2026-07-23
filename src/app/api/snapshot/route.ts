import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { pauseRuntime } from "@/lib/sim/runtime";
import { buildSimulationState } from "@/lib/db/state";
import { getActiveSimulation } from "@/lib/db/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const sim = getActiveSimulation();
  if (!sim) {
    return NextResponse.json({ error: "Simülasyon yok" }, { status: 404 });
  }

  const db = getDb();
  const snapshot = {
    version: 1,
    exported_at: new Date().toISOString(),
    simulations: db.prepare("SELECT * FROM simulations").all(),
    parties: db.prepare("SELECT * FROM parties").all(),
    metrics: db.prepare("SELECT * FROM metrics").all(),
    bills: db.prepare("SELECT * FROM bills").all(),
    votes: db.prepare("SELECT * FROM votes").all(),
    alliances: db.prepare("SELECT * FROM alliances").all(),
    events: db.prepare("SELECT * FROM events").all(),
    agent_memory: db.prepare("SELECT * FROM agent_memory").all(),
    poll_history: db.prepare("SELECT * FROM poll_history").all(),
    settings: db.prepare("SELECT * FROM settings").all(),
  };

  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="politicalmatrix-${sim.id}.json"`,
    },
  });
}

export async function POST(req: NextRequest) {
  pauseRuntime();
  const snapshot = await req.json();

  if (!snapshot || snapshot.version !== 1) {
    return NextResponse.json(
      { error: "Geçersiz snapshot (version: 1 bekleniyor)" },
      { status: 400 }
    );
  }

  const db = getDb();
  const clear = db.transaction(() => {
    db.exec(`
      DELETE FROM agent_memory;
      DELETE FROM votes;
      DELETE FROM bills;
      DELETE FROM alliances;
      DELETE FROM events;
      DELETE FROM poll_history;
      DELETE FROM metrics;
      DELETE FROM parties;
      DELETE FROM simulations;
      DELETE FROM settings;
    `);

    const insert = (table: string, rows: Record<string, unknown>[]) => {
      if (!rows?.length) return;
      const keys = Object.keys(rows[0]);
      const placeholders = keys.map(() => "?").join(",");
      const stmt = db.prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`
      );
      for (const row of rows) {
        stmt.run(...keys.map((k) => row[k]));
      }
    };

    insert("settings", snapshot.settings || []);
    insert("simulations", snapshot.simulations || []);
    insert("parties", snapshot.parties || []);
    insert("metrics", snapshot.metrics || []);
    insert("bills", snapshot.bills || []);
    insert("votes", snapshot.votes || []);
    insert("alliances", snapshot.alliances || []);
    insert("events", snapshot.events || []);
    insert("agent_memory", snapshot.agent_memory || []);
    insert("poll_history", snapshot.poll_history || []);
  });

  try {
    clear();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const state = await buildSimulationState();
  return NextResponse.json({ ok: true, message: "Snapshot yüklendi", state });
}
