import { NextResponse } from "next/server";
import { pauseRuntime } from "@/lib/sim/runtime";
import { buildSimulationState } from "@/lib/db/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const result = pauseRuntime();
  const state = await buildSimulationState();
  return NextResponse.json({ ...result, state });
}
