import { NextResponse } from "next/server";
import { getActiveSimulation, updateSimulation } from "@/lib/db/repository";
import { runSimulationTick } from "@/lib/sim/engine";
import { buildSimulationState } from "@/lib/db/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const sim = getActiveSimulation();
  if (!sim) {
    return NextResponse.json({ error: "Simülasyon yok" }, { status: 404 });
  }

  // Allow manual tick even when paused
  if (sim.status === "idle" || sim.status === "paused") {
    updateSimulation(sim.id, { status: "running" });
  }

  const result = await runSimulationTick(sim.id);

  // Restore paused if user only wanted one tick while paused — keep running if was running
  // Manual tick leaves status as running; client can pause again.

  const state = await buildSimulationState();
  return NextResponse.json({ ...result, state });
}
