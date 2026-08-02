"use client";

import type { SituationPublic } from "@/lib/types";

interface StatusStripProps {
  yearLabel: string;
  month: number;
  term: number;
  status: string;
  phaseLabel: string;
  lmConnected: boolean;
  llmLabel: string;
  situation: SituationPublic;
}

export function StatusStrip({
  yearLabel,
  month,
  term,
  status,
  phaseLabel,
  lmConnected,
  llmLabel,
  situation,
}: StatusStripProps) {
  return (
    <div
      className="status-strip sticky top-0 z-40 -mx-4 mb-4 border-b px-4 py-2 md:-mx-6 md:px-6"
      style={{
        borderColor: "var(--line)",
        background: "rgba(7, 20, 15, 0.92)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.7rem]">
        <span style={{ color: "var(--gold-soft)" }}>
          {term}. dönem · {yearLabel}
          <span style={{ color: "var(--muted)" }}> · sim #{month}</span>
        </span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span className="uppercase tracking-wider" style={{ color: "var(--cream)" }}>
          {phaseLabel}
        </span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span className="uppercase" style={{ color: "var(--muted)" }}>
          {status}
        </span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: lmConnected ? "var(--ok)" : "var(--danger)" }}
          />
          <span style={{ color: "var(--muted)" }}>
            {llmLabel} {lmConnected ? "bağlı" : "yok"}
          </span>
        </span>
        <span style={{ color: "var(--muted)" }}>·</span>
        <span
          style={{
            color: situation.majority ? "var(--ok)" : "var(--danger)",
          }}
        >
          Blok {situation.governmentSeats}/600
          {situation.majority ? " · çoğunluk" : " · azınlık"}
        </span>
        {situation.honeymoon && (
          <span
            className="border px-1.5 py-0.5 uppercase tracking-wider"
            style={{
              borderColor: "rgba(212,175,55,0.45)",
              color: "var(--gold)",
              background: "rgba(212,175,55,0.08)",
            }}
          >
            Balayı {situation.honeymoonMonthsLeft}ay
          </span>
        )}
        {situation.crisis && (
          <span
            className="border px-1.5 py-0.5 uppercase tracking-wider"
            style={{
              borderColor: "rgba(196,92,74,0.55)",
              color: "#f0d0c8",
              background: "rgba(196,92,74,0.12)",
            }}
          >
            Kriz
            {situation.crisis.blameLeadName
              ? ` · ${situation.crisis.blameLeadName}`
              : ""}
          </span>
        )}
      </div>
    </div>
  );
}
