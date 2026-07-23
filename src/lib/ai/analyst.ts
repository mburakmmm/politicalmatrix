import { createLmClient } from "../ai/lmStudio";
import { OBSERVER_SYSTEM_PROMPT } from "../ai/prompts";
import { getRecentEvents, getSimulation, insertEvent } from "../db/repository";
import { getRegime } from "../sim/regime";
import { getSetting } from "../db/client";

export async function runObserverNarration(
  simulationId: string
): Promise<void> {
  const sim = getSimulation(simulationId);
  if (!sim) return;

  const modelId =
    sim.observer_model_id ||
    getSetting("observer_model_id", "") ||
    null;
  if (!modelId) return;

  const events = getRecentEvents(simulationId, 12);
  const regime = getRegime(simulationId);
  const digest = events
    .map((e) => {
      try {
        const p = JSON.parse(e.payload) as { message?: string };
        return `- [${e.type}] ${p.message || e.type}`;
      } catch {
        return `- [${e.type}]`;
      }
    })
    .join("\n");

  try {
    const client = createLmClient();
    const completion = await client.chat.completions.create({
      model: modelId,
      temperature: 0.6,
      messages: [
        { role: "system", content: OBSERVER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Ay ${sim.month}. Rejim: ${regime.regime_label} (${regime.regime_type}).\nOlaylar:\n${digest}\n\nSpiker özeti yaz.`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) {
      insertEvent(
        simulationId,
        "analyst",
        {
          message: text.slice(0, 800),
          partyName: "Spiker",
          partyColor: "#d4af37",
        },
        sim.month
      );
    }
  } catch {
    // observer optional — never break sim
  }
}
