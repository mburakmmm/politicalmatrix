import { getActiveSimulation, getRecentEvents } from "@/lib/db/repository";
import { ensureDefaultSettings } from "@/lib/db/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SimMeta = {
  id: string;
  month: number;
  status: string;
  phase: string;
  speed: number;
  pending_crisis: string | null;
  term: number;
};

function metaKey(m: SimMeta): string {
  return [
    m.id,
    m.month,
    m.status,
    m.phase,
    m.speed,
    m.pending_crisis ?? "",
    m.term,
  ].join("|");
}

export async function GET() {
  ensureDefaultSettings();

  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastEventId: string | null = null;
  let activeSimId: string | null = null;
  let lastMetaKey: string | null = null;
  let lastEventBumpAt = 0;

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
            lastMetaKey = null;
            send("simulation", {
              id: sim.id,
              month: sim.month,
              status: sim.status,
              phase: sim.phase,
            });
          }

          const events = getRecentEvents(sim.id, 250);
          let hadFreshEvents = false;

          if (lastEventId === null) {
            if (events[0]) lastEventId = events[0].id;
          } else {
            const idx = events.findIndex((e) => e.id === lastEventId);
            const fresh =
              idx === -1
                ? [...events].reverse()
                : events.slice(0, idx).reverse();

            for (const e of fresh) {
              hadFreshEvents = true;
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

          const meta: SimMeta = {
            id: sim.id,
            month: sim.month,
            status: sim.status,
            phase: sim.phase,
            speed: sim.speed,
            pending_crisis: sim.pending_crisis,
            term: sim.term,
          };
          const key = metaKey(meta);

          // snapshot yalnız meta değişince VEYA yeni event gelince
          // (sürekli full /api/state yenilemeyi keser)
          if (key !== lastMetaKey || hadFreshEvents) {
            lastMetaKey = key;
            if (hadFreshEvents) lastEventBumpAt = Date.now();
            send("snapshot", {
              ...meta,
              reason: hadFreshEvents ? "events" : "meta",
              at: Date.now(),
            });
          } else {
            // Bağlantı canlı kalsın; client refresh etmesin
            send("heartbeat", {
              ok: true,
              month: sim.month,
              status: sim.status,
              idleMs: Date.now() - lastEventBumpAt,
            });
          }
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
