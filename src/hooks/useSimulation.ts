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

/** Sandalye/UI için anlamlı state imzası — gereksiz setState önler */
function stateSignature(s: SimulationState): string {
  const seats = s.parties
    .map(
      (p) =>
        `${p.id}:${p.seats}:${p.poll_share}:${p.is_government ? 1 : 0}:${p.is_coalition_partner ? 1 : 0}`
    )
    .join(",");
  const allySig = s.alliances
    .map((a) => `${a.id}:${a.status}:${a.stress ?? 0}`)
    .join(",");
  const bill = s.activeBill
    ? `${s.activeBill.id}:${s.activeBill.status}:${s.activeBill.yes_votes}:${s.activeBill.no_votes}`
    : "-";
  return [
    s.simulation.id,
    s.simulation.month,
    s.simulation.status,
    s.simulation.phase,
    s.simulation.speed,
    s.simulation.pending_crisis ?? "",
    seats,
    allySig,
    bill,
    s.events.length,
    s.regime?.regime_type,
    s.governmentSeats,
  ].join("|");
}

export function useSimulation() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<EventPublic[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const sigRef = useRef<string>("");
  const refreshInFlight = useRef<Promise<SimulationState | null> | null>(null);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (refreshInFlight.current && !opts?.force) {
      return refreshInFlight.current;
    }

    const run = (async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as SimulationState;
        const sig = stateSignature(data);
        if (!opts?.force && sig === sigRef.current) {
          setError(null);
          return data;
        }
        sigRef.current = sig;
        setState(data);
        setLiveEvents(data.events);
        setError(null);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh({ force: true });
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

    // Meta veya yeni olay → tek seferlik state çek (debounce)
    let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(() => {
        void refresh();
      }, 200);
    };

    es.addEventListener("snapshot", () => {
      scheduleRefresh();
    });

    es.addEventListener("simulation", () => {
      void refresh({ force: true });
    });

    es.onerror = () => {
      // browser auto-reconnects
    };

    return () => {
      if (snapshotTimer) clearTimeout(snapshotTimer);
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
        const next = data.state as SimulationState;
        sigRef.current = stateSignature(next);
        setState(next);
        setLiveEvents(next.events);
      } else {
        await refresh({ force: true });
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
    refresh: () => refresh({ force: true }),
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
