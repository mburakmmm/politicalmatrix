import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, getDb } from "@/lib/db/client";
import {
  getActiveSimulation,
  getParties,
  updateParty,
  updateSimulation,
} from "@/lib/db/repository";
import { rescheduleRuntime } from "@/lib/sim/runtime";
import { buildSimulationState } from "@/lib/db/state";
import {
  OPENROUTER_DEFAULT_BASE,
  type LlmProviderId,
} from "@/lib/ai/llmProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const openrouterKey =
    getSetting("openrouter_api_key") || process.env.OPENROUTER_API_KEY || "";
  return NextResponse.json({
    llm_provider: getSetting("llm_provider", "lm_studio"),
    lm_base_url: getSetting(
      "lm_base_url",
      process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1"
    ),
    openrouter_base_url: getSetting(
      "openrouter_base_url",
      process.env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE
    ),
    openrouter_api_key: openrouterKey,
    openrouter_api_key_set: Boolean(openrouterKey.trim()),
    model_map: JSON.parse(getSetting("model_map", "{}")),
    observer_model_id: getSetting("observer_model_id", ""),
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();

  if (body.llm_provider === "lm_studio" || body.llm_provider === "openrouter") {
    setSetting("llm_provider", body.llm_provider as LlmProviderId);
  }

  if (typeof body.lm_base_url === "string" && body.lm_base_url.trim()) {
    setSetting("lm_base_url", body.lm_base_url.trim().replace(/\/$/, ""));
  }

  if (
    typeof body.openrouter_base_url === "string" &&
    body.openrouter_base_url.trim()
  ) {
    setSetting(
      "openrouter_base_url",
      body.openrouter_base_url.trim().replace(/\/$/, "")
    );
  }

  if (typeof body.openrouter_api_key === "string") {
    const key = body.openrouter_api_key.trim();
    // Boş string: anahtarı sil; dolu: kaydet. Maskeli placeholder göndermeyi yok say.
    if (key === "") {
      setSetting("openrouter_api_key", "");
    } else if (!key.startsWith("••••")) {
      setSetting("openrouter_api_key", key);
    }
  }

  if (body.model_map && typeof body.model_map === "object") {
    setSetting("model_map", JSON.stringify(body.model_map));
    const sim = getActiveSimulation();
    if (sim) {
      const parties = getParties(sim.id);
      for (const p of parties) {
        const modelId = body.model_map[p.slug];
        if (typeof modelId === "string") {
          updateParty(p.id, { model_id: modelId || null });
        }
      }
    }
  }

  if (Array.isArray(body.party_prompts)) {
    for (const item of body.party_prompts as Array<{
      slug: string;
      system_prompt: string;
      name?: string;
    }>) {
      const sim = getActiveSimulation();
      if (!sim) break;
      const party = getParties(sim.id).find((p) => p.slug === item.slug);
      if (party && item.system_prompt) {
        updateParty(party.id, {
          system_prompt: item.system_prompt,
          name: item.name,
        });
      }
    }
  }

  if (typeof body.speed === "number") {
    const sim = getActiveSimulation();
    if (sim) {
      updateSimulation(sim.id, {
        speed: Math.max(0.5, Math.min(4, body.speed)),
      });
      rescheduleRuntime();
    }
  }

  if (typeof body.tick_mode === "string") {
    const sim = getActiveSimulation();
    if (sim) {
      getDb()
        .prepare(`UPDATE simulations SET tick_mode = ? WHERE id = ?`)
        .run(body.tick_mode, sim.id);
    }
  }

  if (typeof body.observer_model_id === "string") {
    setSetting("observer_model_id", body.observer_model_id);
    const sim = getActiveSimulation();
    if (sim) {
      getDb()
        .prepare(`UPDATE simulations SET observer_model_id = ? WHERE id = ?`)
        .run(body.observer_model_id || null, sim.id);
    }
  }

  const state = await buildSimulationState();
  return NextResponse.json({ ok: true, state });
}
