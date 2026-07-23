"use client";

import { useEffect, useRef } from "react";
import type { EventPublic } from "@/lib/types";
import { looksLikePromptLeak } from "@/lib/sim/speechSanitize";

interface NewsFeedProps {
  events: EventPublic[];
}

const TYPE_LABELS: Record<string, string> = {
  party_speech: "Kürsü",
  vote_cast: "Oy",
  vote_result: "Oylama sonucu",
  tool_executed: "Hamle",
  decision: "Karar",
  crisis: "Kriz",
  election_result: "Seçim",
  election_blocked: "Seçim engeli",
  coalition_needed: "Koalisyon",
  mandate_granted: "Formateur görevi",
  mandate_expired: "Görev iadesi",
  mandate_exhausted: "Formateur tükendi",
  government_formed: "Hükümet",
  government_fallen: "Hükümet düştü",
  alliance_accepted: "İttifak",
  alliance_broken: "İttifak bozuldu",
  alliance_reinforced: "Koalisyon yenilendi",
  negotiation_offer: "Müzakere",
  negotiation_accepted: "Anlaşma",
  negotiation_failed: "Müzakere çöktü",
  regime_changed: "Rejim değişti",
  emergency_declared: "OHAL",
  bill_to_floor: "Genel kurul",
  month_tick: "Ay geçişi",
  simulation_started: "Başlangıç",
  inaugural_election_pending: "Kurucu seçim",
  agent_error: "Hata",
  agent_skipped: "Pas",
  vote_fallback: "Yedek oy",
  context_trimmed: "Bağlam",
  analyst: "Spiker",
  confidence_motion: "Gensoru",
  confidence_passed: "Güvenoyu",
  confidence_failed: "Gensoru reddi",
  ministries_shared: "Bakanlık paylaşımı",
  attitude: "Bakış",
  law_enacted: "Kanun yürürlükte",
  tool_rejected: "Reddedilen hamle",
  action_fallback: "Sistem hamlesi",
  proposeLaw: "Katalog yasası",
  proposeCustomBill: "Özgür slot yasası",
};

const JUNK_SPEECH =
  /holdRally|voteOnBill|proposeBill|proposeLaw|TOOL\s|Öncelikli|Strateji|Öneri:|oy verme zorunluluğu|seçeneği yok|DURUM ANALİZİ|Siz ne yapacaksınız|simülasyon durumu|talimatlar ışığında/i;

function eventColor(type: string, payload: Record<string, unknown>): string {
  if (typeof payload.partyColor === "string") return payload.partyColor;
  if (type === "crisis" || type === "regime_changed") return "#c45c4a";
  if (
    type === "vote_result" ||
    type === "election_result" ||
    type === "inaugural_election_pending"
  )
    return "#d4af37";
  if (
    type === "government_formed" ||
    type === "alliance_accepted" ||
    type === "ministries_shared"
  )
    return "#3d9a6a";
  if (type === "coalition_needed" || type === "month_tick") return "#8fa898";
  return "#8fa898";
}

function voteTr(v: unknown): string {
  const s = String(v || "").toUpperCase();
  if (s === "YES") return "Kabul";
  if (s === "NO") return "Ret";
  if (s === "ABSTAIN") return "Çekimser";
  return s || "?";
}

function formatElectionBody(p: Record<string, unknown>): string {
  const results = Array.isArray(p.results) ? p.results : null;
  if (results && results.length) {
    const line = results
      .map((r) => {
        const row = r as {
          name?: string;
          seats?: number;
          poll_share?: number;
        };
        return `${row.name || "?"} ${row.seats ?? "?"} sandalye`;
      })
      .join(" · ");
    return typeof p.message === "string" ? `${p.message}` : line;
  }
  return typeof p.message === "string" ? p.message : "Seçim sonucu";
}

function formatEvent(
  e: EventPublic
): { title: string; body: string } | null {
  const p = e.payload || {};
  const label = TYPE_LABELS[e.type] || e.type;

  if (e.type === "tool_rejected") {
    return {
      title: "Reddedilen hamle",
      body: String(p.message || `${p.partyName} → ${p.tool}`),
    };
  }

  if (e.type === "tool_executed") {
    const tool = String(p.tool || "");
    if (tool === "holdRally") {
      return {
        title: "Miting",
        body: String(p.message || `${p.partyName} miting`),
      };
    }
    if (tool === "issuePRStatement") {
      return {
        title: "Basın açıklaması",
        body: String(p.message || p.statementText || ""),
      };
    }
    if (tool === "proposeLaw" || tool === "proposeCustomBill" || tool === "proposeBill") {
      return {
        title: TYPE_LABELS[tool] || "Yasa",
        body: String(p.message || p.title || ""),
      };
    }
    return {
      title: label,
      body: String(p.message || tool),
    };
  }

  if (e.type === "vote_cast") {
    const speech = String(p.speechText || "");
    if (looksLikePromptLeak(speech) || JUNK_SPEECH.test(speech)) {
      return {
        title: "Oy",
        body: String(
          p.message ||
            `${p.partyName || "Parti"} oy verdi: ${voteTr(p.vote)}`
        ).replace(/—\s*“.*/, ""),
      };
    }
    return {
      title: "Oy",
      body: String(p.message || `${p.partyName}: ${voteTr(p.vote)}`),
    };
  }

  if (e.type === "vote_result") {
    return {
      title: "Oylama sonucu",
      body: String(p.message || "Oylama tamamlandı"),
    };
  }

  if (e.type === "election_result") {
    return { title: "Seçim", body: formatElectionBody(p) };
  }

  if (e.type === "party_speech") {
    const speech = String(p.speech || p.message || "");
    if (looksLikePromptLeak(speech) || JUNK_SPEECH.test(speech)) return null;
    return {
      title: "Kürsü",
      body: `${p.partyName || "Parti"}: “${speech}”`,
    };
  }

  const msg =
    (typeof p.message === "string" && p.message) ||
    (typeof p.speech === "string" && p.speech) ||
    "";
  if (!msg) return { title: label, body: "—" };
  if (
    (JUNK_SPEECH.test(msg) || looksLikePromptLeak(msg)) &&
    (e.type === "decision" || e.type === "party_speech")
  ) {
    return null;
  }

  return {
    title: label,
    body: msg.length > 400 ? msg.slice(0, 397) + "…" : msg,
  };
}

export function NewsFeed({ events }: NewsFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const visible = events
    .map((e) => ({ e, formatted: formatEvent(e) }))
    .filter(
      (x): x is { e: EventPublic; formatted: { title: string; body: string } } =>
        Boolean(x.formatted)
    );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="text-sm tracking-[0.14em] uppercase"
          style={{
            fontFamily: "var(--font-display), serif",
            color: "var(--gold-soft)",
          }}
        >
          Canlı Meclis & Haber
        </h2>
        <div className="flex items-center gap-2 text-[0.7rem]" style={{ color: "var(--muted)" }}>
          <span>{visible.length} kayıt · baştan sona</span>
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-[var(--gold)]" />
        </div>
      </div>
      <div className="gold-rule mb-3" />
      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto pr-1"
        style={{ maxHeight: "min(70vh, 720px)" }}
      >
        {visible.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Henüz haber yok. Simülasyonu başlatın.
          </p>
        )}
        {visible.map(({ e, formatted }) => {
          const color = eventColor(e.type, e.payload);
          return (
            <article
              key={e.id}
              className="animate-feed-in border-l-2 pl-3"
              style={{ borderColor: color }}
            >
              <div
                className="mb-1 flex items-baseline gap-2 text-[0.7rem]"
                style={{ color: "var(--muted)" }}
              >
                <span>Ay {e.month}</span>
                <span>·</span>
                <span className="tracking-wide">{formatted.title}</span>
              </div>
              <p
                className="text-sm leading-relaxed"
                style={{ color: "var(--cream)" }}
              >
                {formatted.body}
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
