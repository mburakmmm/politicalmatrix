import { getActiveSimulation, getRecentEvents } from "@/lib/db/repository";
import { ensureDefaultSettings } from "@/lib/db/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureDefaultSettings();

  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastEventId: string | null = null;
  let activeSimId: string | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("connected", { ok: true, at: new Date().toISOString() });

      intervalId = setInterval(() => {
        try {
          const sim = getActiveSimulation();
          if (!sim) {
            send("heartbeat", { ok: true });
            return;
          }

          if (activeSimId !== sim.id) {
            activeSimId = sim.id;
            lastEventId = null;
            send("simulation", {
              id: sim.id,
              month: sim.month,
              status: sim.status,
              phase: sim.phase,
            });
          }

          const events = getRecentEvents(sim.id, 250);

          if (lastEventId === null) {
            if (events[0]) lastEventId = events[0].id;
          } else {
            const idx = events.findIndex((e) => e.id === lastEventId);
            const fresh =
              idx === -1 ? [...events].reverse() : events.slice(0, idx).reverse();

            for (const e of fresh) {
              let payload: Record<string, unknown> = {};
              try {
                payload = JSON.parse(e.payload);
              } catch {
                payload = { raw: e.payload };
              }
              send("event", {
                id: e.id,
                type: e.type,
                payload,
                month: e.month,
                created_at: e.created_at,
              });
              lastEventId = e.id;
            }
          }

          send("snapshot", {
            month: sim.month,
            status: sim.status,
            phase: sim.phase,
            speed: sim.speed,
            pending_crisis: sim.pending_crisis,
            term: sim.term,
          });
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }, 1500);
    },
    cancel() {
      if (intervalId) clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
