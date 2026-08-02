import { NextResponse } from "next/server";
import { buildSimulationState } from "@/lib/db/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await buildSimulationState();
    return NextResponse.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
