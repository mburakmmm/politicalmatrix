"use client";

import type { DecisionExplain, MonthDiff, LatencyStat } from "@/lib/types";

export function PodiumPanel({ podium }: { podium: DecisionExplain | null }) {
  if (!podium) {
    return (
      <div className="panel p-4">
        <h3
          className="text-xs tracking-[0.12em] uppercase mb-2"
          style={{ color: "var(--muted)" }}
        >
          Kürsü
        </h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Henüz kürsü konuşması yok.
        </p>
      </div>
    );
  }
  return (
    <div className="panel p-4 md:p-5">
      <h3
        className="text-xs tracking-[0.12em] uppercase mb-2"
        style={{ color: "var(--gold)" }}
      >
        Kürsü · Ay {podium.month}
      </h3>
      <p
        className="mb-2 text-lg leading-snug"
        style={{ fontFamily: "var(--font-display), serif", color: podium.party_color }}
      >
        {podium.party_name}
      </p>
      <p className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {podium.tool}
      </p>
      <p className="text-base leading-relaxed">{podium.rationale}</p>
    </div>
  );
}

export function DiffPanel({ diffs }: { diffs: MonthDiff[] }) {
  return (
    <div className="panel p-4">
      <h3
        className="mb-3 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--gold-soft)" }}
      >
        Ay Farkları (Replay)
      </h3>
      <div className="max-h-48 space-y-2 overflow-y-auto text-sm">
        {diffs.length === 0 && (
          <p style={{ color: "var(--muted)" }}>Henüz diff yok.</p>
        )}
        {diffs.map((d) => (
          <div key={d.month} className="border-l-2 border-[var(--line)] pl-2">
            <strong>Ay {d.month}</strong>
            {d.regime_changed && (
              <span className="ml-2 text-[var(--danger)]">REJİM DEĞİŞTİ</span>
            )}
            <ul className="text-xs" style={{ color: "var(--muted)" }}>
              {d.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DecisionPanel({
  decisions,
}: {
  decisions: DecisionExplain[];
}) {
  return (
    <div className="panel p-4">
      <h3
        className="mb-3 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--gold-soft)" }}
      >
        Karar Açıklamaları
      </h3>
      <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
        {decisions.slice(0, 15).map((d) => (
          <div key={d.id}>
            <span style={{ color: d.party_color }}>●</span>{" "}
            <strong>{d.party_name}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>({d.tool})</span>
            <div className="text-xs" style={{ color: "var(--cream)" }}>
              {d.rationale}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LatencyPanel({ latency }: { latency: LatencyStat[] }) {
  return (
    <div className="panel p-4">
      <h3
        className="mb-3 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--gold-soft)" }}
      >
        Model Latency
      </h3>
      <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
        {latency.length === 0 && (
          <p style={{ color: "var(--muted)" }}>Veri yok.</p>
        )}
        {latency.map((l, i) => (
          <div key={i} style={{ color: l.ok ? "var(--muted)" : "#e8c8c0" }}>
            Ay {l.month} · {l.party_name || "?"} · {l.duration_ms}ms ·{" "}
            {l.tool_calls} ok
            {l.error?.startsWith("red:")
              ? ` · ${l.error.replace("red:", "red ")}`
              : ""}{" "}
            · {l.model_id || "?"}
            {!l.ok && l.error && !l.error.startsWith("red:")
              ? ` · ERR: ${l.error.slice(0, 60)}`
              : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RegionsPanel({
  regions,
}: {
  regions: SimulationStateRegions;
}) {
  return (
    <div className="panel p-4">
      <h3
        className="mb-3 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--gold-soft)" }}
      >
        Bölgesel Seçmen
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto">
        {regions.map((r) => {
          const top = [...r.supports].sort((a, b) => b.support - a.support)[0];
          return (
            <div key={r.id} className="text-xs border border-[var(--line)] p-2">
              <div className="font-medium">{r.name}</div>
              <div style={{ color: "var(--muted)" }}>
                dindarlık {r.religiosity.toFixed(0)} · huzursuzluk{" "}
                {r.unrest.toFixed(0)}
              </div>
              {top && (
                <div style={{ color: top.color }}>
                  lider: {top.party_name} %{top.support.toFixed(0)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SimulationStateRegions = Array<{
  id: string;
  name: string;
  religiosity: number;
  unrest: number;
  supports: Array<{
    party_name: string;
    color: string;
    support: number;
  }>;
}>;
