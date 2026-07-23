"use client";

import type { BillPublic } from "@/lib/types";
import { MAJORITY_THRESHOLD } from "@/lib/types";
import {
  billStatusLabel,
  categoryLabel,
  describeBillImpact,
  metricLabel,
} from "@/lib/sim/billEffects";

interface BillPanelProps {
  bill: BillPublic | null;
  parties?: Array<{ id: string; name: string; color: string; seats: number }>;
}

function voteTr(v: string): string {
  if (v === "YES") return "Kabul";
  if (v === "NO") return "Ret";
  if (v === "ABSTAIN") return "Çekimser";
  return v;
}

export function BillPanel({ bill, parties = [] }: BillPanelProps) {
  if (!bill) {
    return (
      <div className="mt-4">
        <h3
          className="mb-2 text-xs tracking-[0.12em] uppercase"
          style={{ color: "var(--muted)" }}
        >
          Yasama & Oylama
        </h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Mecliste aktif yasa yok. Partiler yeni teklif sunabilir.
        </p>
      </div>
    );
  }

  const impact = describeBillImpact(bill);
  const votedIds = new Set((bill.votes || []).map((v) => v.party_id));
  const pending = parties.filter((p) => !votedIds.has(p.id));
  const yesNeed = Math.max(0, MAJORITY_THRESHOLD - bill.yes_votes);
  const progress =
    parties.length > 0
      ? ((bill.votes?.length || 0) / parties.length) * 100
      : 0;

  return (
    <div className="mt-4">
      <h3
        className="mb-2 text-xs tracking-[0.12em] uppercase"
        style={{ color: "var(--muted)" }}
      >
        Yasama & Oylama
      </h3>
      <p
        className="mb-1 text-lg leading-snug"
        style={{ fontFamily: "var(--font-display), serif" }}
      >
        “{bill.title}”
      </p>
      <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
        {categoryLabel(bill.category)} · {billStatusLabel(bill.status)}
        {bill.proposer_name ? ` · Teklif: ${bill.proposer_name}` : ""}
        {bill.law_id ? ` · ${bill.law_id}` : ""}
        {bill.is_custom ? " · Özgür slot" : ""}
      </p>

      <div
        className="mb-3 border border-[var(--line)] p-3 text-sm"
        style={{ background: "rgba(0,0,0,0.2)" }}
      >
        <p className="mb-2" style={{ color: "var(--cream)" }}>
          {impact.summary}
        </p>
        {impact.gains.length > 0 && (
          <p className="text-xs" style={{ color: "#3d9a6a" }}>
            Getirir: {impact.gains.join(" · ")}
          </p>
        )}
        {impact.losses.length > 0 && (
          <p className="text-xs" style={{ color: "#c45c4a" }}>
            Götürür: {impact.losses.join(" · ")}
          </p>
        )}
        {impact.sideEffects.length > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Yan etki: {impact.sideEffects.join(" · ")}
          </p>
        )}
        {impact.regimeNote && (
          <p className="mt-1 text-xs" style={{ color: "#e8c872" }}>
            {impact.regimeNote}
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Ana metrik: {metricLabel(bill.target_metric)}{" "}
          {bill.impact_value > 0 ? "+" : ""}
          {bill.impact_value}
        </p>
      </div>

      <div className="mb-1 flex items-center justify-between text-xs">
        <span style={{ color: "var(--gold-soft)" }}>
          Oylama ilerlemesi: {bill.votes?.length || 0}/{parties.length || 3} parti
        </span>
        <span style={{ color: "var(--muted)" }}>
          Kabule {yesNeed} sandalye kaldı (eşik {MAJORITY_THRESHOLD})
        </span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden border border-[var(--line)]">
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "var(--gold)",
            transition: "width 0.5s ease",
          }}
        />
      </div>

      <div className="mb-1 flex h-3 w-full overflow-hidden border border-[var(--line)]">
        <div
          style={{
            width: `${Math.min(100, (bill.yes_votes / 600) * 100)}%`,
            background: "#3d9a6a",
          }}
          title={`Kabul ${bill.yes_votes}`}
        />
        <div
          style={{
            width: `${Math.min(100, (bill.no_votes / 600) * 100)}%`,
            background: "#c45c4a",
          }}
          title={`Ret ${bill.no_votes}`}
        />
        <div
          style={{
            width: `${Math.min(100, (bill.abstain_votes / 600) * 100)}%`,
            background: "#5D6D7E",
          }}
          title={`Çekimser ${bill.abstain_votes}`}
        />
      </div>
      <div
        className="mb-3 flex justify-between text-xs"
        style={{ color: "var(--muted)" }}
      >
        <span>Kabul: {bill.yes_votes}</span>
        <span>Çekimser: {bill.abstain_votes}</span>
        <span>Ret: {bill.no_votes}</span>
      </div>

      <ul className="space-y-2">
        {parties.map((p) => {
          const v = bill.votes?.find((x) => x.party_id === p.id);
          return (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 border border-[var(--line)] px-2 py-1.5 text-xs"
            >
              <div>
                <span style={{ color: p.color }}>●</span> {p.name}{" "}
                <span style={{ color: "var(--muted)" }}>({p.seats} sandalye)</span>
                {v?.speech_text ? (
                  <div className="mt-0.5" style={{ color: "var(--cream)" }}>
                    “{v.speech_text.slice(0, 120)}
                    {v.speech_text.length > 120 ? "…" : ""}”
                  </div>
                ) : null}
              </div>
              <strong
                style={{
                  color: v
                    ? v.vote === "YES"
                      ? "#3d9a6a"
                      : v.vote === "NO"
                        ? "#c45c4a"
                        : "var(--muted)"
                    : "var(--gold)",
                }}
              >
                {v ? voteTr(v.vote) : "Bekleniyor"}
              </strong>
            </li>
          );
        })}
      </ul>
      {pending.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--gold-soft)" }}>
          Oyunu bekleyenler: {pending.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}
