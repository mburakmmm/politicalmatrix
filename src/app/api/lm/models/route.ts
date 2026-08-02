import { NextResponse } from "next/server";
import { listLlmModels } from "@/lib/ai/llmProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await listLlmModels();
  return NextResponse.json(result);
}
