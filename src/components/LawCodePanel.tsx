"use client";

import { LAW_GROUP_LABELS } from "@/lib/sim/laws/catalog";

export interface LawStateItem {
  group_key: string;
  law_id: string;
  title: string;
  tier: number;
  enacted_month: number;
}

export interface CommitteeItem {
  id: string;
  title: string;
  law_id: string | null;
  is_custom: number;
  debate_progress: number;
  debate_months_required: number;
  proposer_name?: string;
  created_month: number;
}

export function LawCodePanel({
  laws,
  committee,
}: {
  laws: LawStateItem[];
  committee: CommitteeItem[];
}) {
  return (
    <section className="panel p-4 md:p-5">
      <h2
        className="mb-1 text-sm tracking-[0.14em] uppercase"
        style={{
          fontFamily: "var(--font-display), serif",
          color: "var(--gold-soft)",
        }}
      >
        Kanun kodu & komisyon
      </h2>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        Genel kurulda tek yasa; fazlası komisyon kuyruğunda bekler. Katalog
        yasaları grup başına bir kademe yürürlüktedir.
      </p>

      {committee.length > 0 && (
        <div className="mb-4">
          <h3
            className="mb-2 text-xs tracking-[0.12em] uppercase"
            style={{ color: "var(--muted)" }}
          >
            Komisyon kuyruğu ({committee.length})
          </h3>
          <ul className="space-y-1.5 text-xs">
            {committee.map((b, i) => (
              <li
                key={b.id}
                className="flex justify-between gap-2 border border-[var(--line)] px-2 py-1.5"
              >
                <span>
                  <span style={{ color: "var(--gold)" }}>#{i + 1}</span>{" "}
                  {b.title}
                  {b.is_custom ? (
                    <span style={{ color: "var(--gold-soft)" }}> · slot</span>
                  ) : b.law_id ? (
                    <span style={{ color: "var(--muted)" }}> · {b.law_id}</span>
                  ) : null}
                  {b.proposer_name ? (
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      · {b.proposer_name}
                    </span>
                  ) : null}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  {b.debate_progress}/{b.debate_months_required} ay
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3
        className="mb-2 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--muted)" }}
      >
        Yürürlükteki katalog ({laws.length} grup)
      </h3>
      {laws.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Henüz katalog durumu yok.
        </p>
      ) : (
        <div className="grid max-h-64 gap-1 overflow-y-auto text-xs sm:grid-cols-2">
          {laws.map((l) => (
            <div
              key={l.group_key}
              className="border border-[var(--line)] px-2 py-1.5"
            >
              <div style={{ color: "var(--muted)" }}>
                {LAW_GROUP_LABELS[
                  l.group_key as keyof typeof LAW_GROUP_LABELS
                ] || l.group_key}{" "}
                · t{l.tier}
              </div>
              <div style={{ color: "var(--cream)" }}>{l.title}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
