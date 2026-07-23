"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPublic, SimulationState } from "@/lib/types";

function mergeChronological(
  prev: EventPublic[],
  incoming: EventPublic[]
): EventPublic[] {
  const map = new Map<string, EventPublic>();
  for (const e of prev) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return [...map.values()].sort((a, b) => {
    if (a.month !== b.month) return a.month - b.month;
    const ta = a.created_at || "";
    const tb = b.created_at || "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function useSimulation() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<EventPublic[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as SimulationState;
      setState(data);
      // Tam arşiv — kırpma yok
      setLiveEvents(data.events);
      setError(null);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const es = new EventSource("/api/sim/events");
    esRef.current = es;

    es.addEventListener("event", (msg) => {
      try {
        const data = JSON.parse((msg as MessageEvent).data) as EventPublic;
        setLiveEvents((prev) => mergeChronological(prev, [data]));
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("snapshot", () => {
      void refresh();
    });

    es.addEventListener("simulation", () => {
      void refresh();
    });

    es.onerror = () => {
      // browser auto-reconnects
    };

    return () => {
      es.close();
    };
  }, [refresh]);

  const post = useCallback(
    async (url: string, body?: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "İstek başarısız");
      }
      if (data.state) {
        setState(data.state);
        setLiveEvents(data.state.events);
      } else {
        await refresh();
      }
      return data;
    },
    [refresh]
  );

  return {
    state,
    loading,
    error,
    liveEvents,
    refresh,
    start: () => post("/api/sim/start"),
    pause: () => post("/api/sim/pause"),
    tick: () => post("/api/sim/tick"),
    reset: (body?: {
      seed?: number;
      speed?: number;
      modelMap?: Record<string, string>;
    }) => post("/api/sim/reset", body ?? {}),
    setState,
  };
}
