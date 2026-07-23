import { NextResponse } from "next/server";
import { startRuntime } from "@/lib/sim/runtime";
import { getActiveSimulation } from "@/lib/db/repository";
import { buildSimulationState } from "@/lib/db/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const sim = getActiveSimulation();
  if (!sim) {
    return NextResponse.json(
      { error: "Simülasyon bulunamadı" },
      { status: 404 }
    );
  }

  const missingModels = (
    await import("@/lib/db/repository")
  )
    .getParties(sim.id)
    .filter((p) => !p.model_id);

  if (missingModels.length) {
    return NextResponse.json(
      {
        error:
          "Tüm partilere bir LLM modeli atanmalı. Ayarlar’dan LM Studio veya OpenRouter modeli seçin.",
        missing: missingModels.map((p) => p.slug),
      },
      { status: 400 }
    );
  }

  const result = startRuntime();
  const state = await buildSimulationState();
  return NextResponse.json({ ...result, state });
}
