import { NextRequest, NextResponse } from "next/server";
import { pauseRuntime } from "@/lib/sim/runtime";
import {
  resetDatabaseAndCreate,
  updateParty,
  getParties,
} from "@/lib/db/repository";
import { getSetting, setSetting } from "@/lib/db/client";
import { buildSimulationState } from "@/lib/db/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  pauseRuntime();

  let body: {
    seed?: number;
    speed?: number;
    modelMap?: Record<string, string>;
    scenarioId?: string;
    tickMode?: string;
    observerModelId?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.modelMap) {
    setSetting("model_map", JSON.stringify(body.modelMap));
  }

  const modelMap =
    body.modelMap ??
    (JSON.parse(getSetting("model_map", "{}")) as Record<string, string>);

  const sim = resetDatabaseAndCreate({
    seed: body.seed,
    speed: body.speed,
    modelMap,
    scenarioId: body.scenarioId,
    tickMode: body.tickMode,
    observerModelId: body.observerModelId,
  });

  // Sync party model_ids from map
  for (const p of getParties(sim.id)) {
    if (modelMap[p.slug]) {
      updateParty(p.id, { model_id: modelMap[p.slug] });
    }
  }

  const state = await buildSimulationState();
  return NextResponse.json({ ok: true, message: "Yeni simülasyon oluşturuldu", state });
}
