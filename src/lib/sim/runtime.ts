import { getActiveSimulation, updateSimulation } from "../db/repository";
import { runSimulationTick, getTickLock } from "./engine";

type RuntimeState = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
};

const GLOBAL_KEY = "__politicalmatrix_runtime__";

type GlobalWithRuntime = typeof globalThis & {
  [GLOBAL_KEY]?: RuntimeState;
};

function getRuntime(): RuntimeState {
  const g = globalThis as GlobalWithRuntime;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { timer: null, running: false };
  }
  return g[GLOBAL_KEY]!;
}

function speedToDelayMs(speed: number): number {
  const base = 12_000; // 1x = 12s per month (AI turns take time)
  const s = Math.max(0.25, Math.min(4, speed || 1));
  return Math.round(base / s);
}

async function loopOnce(): Promise<void> {
  const runtime = getRuntime();
  if (!runtime.running) return;
  if (getTickLock()) {
    scheduleNext();
    return;
  }

  const sim = getActiveSimulation();
  if (!sim || sim.status !== "running") {
    runtime.running = false;
    return;
  }

  try {
    await runSimulationTick(sim.id);
  } catch (err) {
    console.error("[PoliticalMatrix] tick error", err);
  }

  scheduleNext();
}

function scheduleNext(): void {
  const runtime = getRuntime();
  if (runtime.timer) clearTimeout(runtime.timer);
  if (!runtime.running) return;

  const sim = getActiveSimulation();
  if (!sim || sim.status !== "running") {
    runtime.running = false;
    return;
  }

  const delay = speedToDelayMs(sim.speed);
  runtime.timer = setTimeout(() => {
    void loopOnce();
  }, delay);
}

export function startRuntime(): { ok: boolean; message: string } {
  const sim = getActiveSimulation();
  if (!sim) return { ok: false, message: "Önce yeni simülasyon oluşturun" };

  updateSimulation(sim.id, { status: "running" });
  const runtime = getRuntime();
  runtime.running = true;
  if (runtime.timer) clearTimeout(runtime.timer);
  // Kick immediately
  void loopOnce();
  return { ok: true, message: "Simülasyon başlatıldı" };
}

export function pauseRuntime(): { ok: boolean; message: string } {
  const runtime = getRuntime();
  runtime.running = false;
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  const sim = getActiveSimulation();
  if (sim && sim.status === "running") {
    updateSimulation(sim.id, { status: "paused" });
  }
  return { ok: true, message: "Simülasyon duraklatıldı" };
}

export function isRuntimeRunning(): boolean {
  return getRuntime().running;
}

export function rescheduleRuntime(): void {
  const runtime = getRuntime();
  if (runtime.running) scheduleNext();
}
