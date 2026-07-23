"use client";

import { metricLabel } from "@/lib/sim/billEffects";

export interface AlmanacItem {
  id: string;
  month: number;
  kind: string;
  title: string;
  detail: string;
  deltas: Record<string, number>;
}

const KIND_TR: Record<string, string> = {
  era: "Dönem",
  drift: "Doğal kayma",
  policy: "Politika",
  bill: "Yasa",
  coalition: "Koalisyon",
  attitude: "Bakış",
  crisis: "Kriz",
  election: "Seçim",
};

function deltaLine(deltas: Record<string, number>): string {
  const parts = Object.entries(deltas).map(([k, v]) => {
    const sign = v > 0 ? "+" : "";
    return `${metricLabel(k)} ${sign}${v}`;
  });
  return parts.join(" · ");
}

export function AlmanacPanel({ entries }: { entries: AlmanacItem[] }) {
  return (
    <section className="panel p-4 md:p-5">
      <h2
        className="mb-1 text-sm tracking-[0.14em] uppercase"
        style={{
          fontFamily: "var(--font-display), serif",
          color: "var(--gold-soft)",
        }}
      >
        Ülke Almanağı
      </h2>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        Statların neden değiştiği — ay ay kayıt.
      </p>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {entries.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Henüz almanak kaydı yok.
          </p>
        )}
        {entries.map((e) => (
          <article
            key={e.id}
            className="border-l-2 border-[var(--line)] pl-3 text-sm"
          >
            <div
              className="mb-0.5 flex flex-wrap gap-2 text-[0.7rem]"
              style={{ color: "var(--muted)" }}
            >
              <span>Ay {e.month}</span>
              <span>·</span>
              <span>{KIND_TR[e.kind] || e.kind}</span>
            </div>
            <p
              className="font-medium"
              style={{ fontFamily: "var(--font-display), serif" }}
            >
              {e.title}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "var(--cream)" }}>
              {e.detail}
            </p>
            {Object.keys(e.deltas || {}).length > 0 && (
              <p className="mt-1 text-xs" style={{ color: "#e8c872" }}>
                Δ {deltaLine(e.deltas)}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export interface AttitudeItem {
  from_party_id: string;
  to_party_id: string;
  from_name: string;
  to_name: string;
  from_color: string;
  to_color: string;
  score: number;
  stance: string;
  stance_label: string;
  note: string;
}

export function AttitudesPanel({ attitudes }: { attitudes: AttitudeItem[] }) {
  return (
    <section className="panel p-4 md:p-5">
      <h2
        className="mb-1 text-sm tracking-[0.14em] uppercase"
        style={{
          fontFamily: "var(--font-display), serif",
          color: "var(--gold-soft)",
        }}
      >
        Partiler Arası Bakış
      </h2>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        Victoria 3 etki grubu gibi: kim kimi nasıl görüyor? İttifak ve oyları etkiler.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {attitudes.map((a) => {
          const warm = a.score >= 20;
          const cold = a.score <= -20;
          return (
            <div
              key={`${a.from_party_id}-${a.to_party_id}`}
              className="border border-[var(--line)] p-2 text-xs"
            >
              <div className="mb-1">
                <span style={{ color: a.from_color }}>{a.from_name}</span>
                <span style={{ color: "var(--muted)" }}> → </span>
                <span style={{ color: a.to_color }}>{a.to_name}</span>
              </div>
              <div
                style={{
                  color: warm ? "#3d9a6a" : cold ? "#c45c4a" : "var(--cream)",
                }}
              >
                {a.stance_label} ({a.score > 0 ? "+" : ""}
                {a.score.toFixed(0)})
              </div>
              <div style={{ color: "var(--muted)" }}>{a.note}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
