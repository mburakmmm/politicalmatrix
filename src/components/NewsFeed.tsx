"use client";

import { useEffect, useRef, useState } from "react";
import type { EventPublic } from "@/lib/types";
import { looksLikePromptLeak, looksLikeGibberish } from "@/lib/sim/speechSanitize";

interface NewsFeedProps {
  events: EventPublic[];
  /** Mobilde daha kısa yükseklik / sekme dostu */
  compact?: boolean;
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
  resignation: "İstifa",
  alliance_accepted: "İttifak",
  alliance_broken: "İttifak bozuldu",
  alliance_reinforced: "Koalisyon yenilendi",
  coalition_strain: "Koalisyon gerilimi",
  alliance_break_fallback: "İttifak bozuldu",
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
  party_idle: "Pass / boş ay",
  mp_rebellion: "Milletvekili isyanı",
  negotiation_soft_pressure: "Müzakere baskısı",
  proposeLaw: "Katalog yasası",
  proposeCustomBill: "Özgür slot yasası",
  ministry_effects: "Bakanlık etkisi",
};

/** Feed gürültüsü — arka plan fiziği / çift satır */
const HIDDEN_EVENT_TYPES = new Set([
  "ministry_effects",
  "month_tick",
  "context_trimmed",
  "attitude",
]);

const EMPHASIS = new Set([
  "mp_rebellion",
  "party_idle",
  "action_fallback",
  "crisis",
  "government_fallen",
  "government_formed",
]);

const JUNK_SPEECH =
  /holdRally|voteOnBill|proposeBill|proposeLaw|TOOL\s|Öncelikli|Strateji|Öneri:|oy verme zorunluluğu|seçeneği yok|DURUM ANALİZİ|Siz ne yapacaksınız|simülasyon durumu|talimatlar ışığında/i;

function eventColor(type: string, payload: Record<string, unknown>): string {
  if (typeof payload.partyColor === "string") return payload.partyColor;
  if (type === "party_idle") return "#8fa898";
  if (type === "mp_rebellion") return "#e8c872";
  if (type === "action_fallback") return "#c45c4a";
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
  if (
    type === "alliance_broken" ||
    type === "coalition_strain" ||
    type === "government_fallen" ||
    type === "resignation"
  )
    return "#c45c4a";
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
    return typeof p.message === "string" ? `${p.message}` : "Seçim sonucu";
  }
  return typeof p.message === "string" ? p.message : "Seçim sonucu";
}

const QUIET_DECISION_TOOLS = new Set([
  "issuePRStatement",
  "holdRally",
  "negotiateCoalition",
  "respondNegotiation",
  "proposeAlliance",
  "breakAlliance",
  "launchSmearCampaign",
  "voteOnBill",
  "voteConfidence",
]);

function formatEvent(
  e: EventPublic,
  ctx?: { rejectedKeys?: Set<string> }
): { title: string; body: string } | null {
  const p = e.payload || {};
  const label = TYPE_LABELS[e.type] || e.type;

  if (HIDDEN_EVENT_TYPES.has(e.type)) return null;

  // decision zaten tool_executed / vote ile görünür — çift satır kes
  if (e.type === "decision") {
    const tool = String(p.tool || "");
    if (QUIET_DECISION_TOOLS.has(tool)) return null;
  }

  // Reddedilmiş deneme sonrası sahte pass gösterme
  if (e.type === "party_idle") {
    const name = String(p.partyName || "");
    if (name && ctx?.rejectedKeys?.has(`${e.month}::${name}`)) return null;
  }

  if (e.type === "tool_rejected") {
    return {
      title: "Reddedilen hamle",
      body: String(p.message || `${p.partyName} → ${p.tool}`),
    };
  }

  if (e.type === "tool_executed") {
    const tool = String(p.tool || "");
    if (tool === "holdRally") {
      return { title: "Miting", body: String(p.message || `${p.partyName} miting`) };
    }
    if (tool === "issuePRStatement") {
      const body = String(p.message || p.statementText || "");
      if (looksLikeGibberish(String(p.statementText || "")) && !body) return null;
      return {
        title: "Basın açıklaması",
        body,
      };
    }
    if (tool === "proposeLaw" || tool === "proposeCustomBill" || tool === "proposeBill") {
      return {
        title: TYPE_LABELS[tool] || "Yasa",
        body: String(p.message || p.title || ""),
      };
    }
    return { title: label, body: String(p.message || tool) };
  }

  if (e.type === "vote_cast") {
    const speech = String(p.speechText || "");
    if (
      looksLikePromptLeak(speech) ||
      looksLikeGibberish(speech) ||
      JUNK_SPEECH.test(speech)
    ) {
      return {
        title: "Oy",
        body: String(
          p.message || `${p.partyName || "Parti"} oy verdi: ${voteTr(p.vote)}`
        ).replace(/—\s*“.*/, ""),
      };
    }
    return {
      title: "Oy",
      body: String(p.message || `${p.partyName}: ${voteTr(p.vote)}`),
    };
  }

  if (e.type === "vote_result") {
    return { title: "Oylama sonucu", body: String(p.message || "Oylama tamamlandı") };
  }
  if (e.type === "election_result") {
    return { title: "Seçim", body: formatElectionBody(p) };
  }
  if (e.type === "party_speech") {
    const speech = String(p.speech || p.message || "");
    if (
      looksLikePromptLeak(speech) ||
      looksLikeGibberish(speech) ||
      JUNK_SPEECH.test(speech)
    ) {
      return null;
    }
    return { title: "Kürsü", body: `${p.partyName || "Parti"}: “${speech}”` };
  }

  const msg =
    (typeof p.message === "string" && p.message) ||
    (typeof p.speech === "string" && p.speech) ||
    "";
  if (!msg) return { title: label, body: "—" };
  if (
    (JUNK_SPEECH.test(msg) ||
      looksLikePromptLeak(msg) ||
      looksLikeGibberish(msg)) &&
    (e.type === "decision" || e.type === "party_speech")
  ) {
    return null;
  }
  return {
    title: label,
    body: msg.length > 400 ? msg.slice(0, 397) + "…" : msg,
  };
}

export function NewsFeed({ events, compact }: NewsFeedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const rejectedKeys = new Set<string>();
  for (const e of events) {
    if (e.type !== "tool_rejected") continue;
    const name = String(e.payload?.partyName || "");
    if (name) rejectedKeys.add(`${e.month}::${name}`);
  }

  const visible = events
    .map((e) => ({ e, formatted: formatEvent(e, { rejectedKeys }) }))
    .filter(
      (x): x is { e: EventPublic; formatted: { title: string; body: string } } =>
        Boolean(x.formatted)
    );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const maxH = compact ? "min(42vh, 360px)" : "min(70vh, 720px)";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
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
          <span className="hidden sm:inline">{visible.length} kayıt</span>
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-[var(--gold)]" />
          <button
            type="button"
            className="border border-[var(--line)] px-2 py-0.5 uppercase tracking-wider lg:hidden"
            style={{ color: "var(--gold-soft)" }}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? "Gizle" : "Aç"}
          </button>
        </div>
      </div>
      <div className="gold-rule mb-3" />
      <div
        ref={scrollerRef}
        className={`flex-1 space-y-3 overflow-y-auto pr-1 ${
          mobileOpen ? "block" : "hidden lg:block"
        }`}
        style={{ maxHeight: maxH, minHeight: compact ? 180 : 280 }}
      >
        {visible.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Henüz haber yok. Simülasyonu başlatın.
          </p>
        )}
        {visible.map(({ e, formatted }) => {
          const color = eventColor(e.type, e.payload);
          const emph = EMPHASIS.has(e.type);
          return (
            <article
              key={e.id}
              className="animate-feed-in border-l-2 pl-3"
              style={{
                borderColor: color,
                background: emph ? "rgba(0,0,0,0.18)" : undefined,
                paddingTop: emph ? 6 : undefined,
                paddingBottom: emph ? 6 : undefined,
                paddingRight: emph ? 8 : undefined,
              }}
            >
              <div
                className="mb-1 flex items-baseline gap-2 text-[0.7rem]"
                style={{ color: emph ? "var(--gold-soft)" : "var(--muted)" }}
              >
                <span>Ay {e.month}</span>
                <span>·</span>
                <span className="tracking-wide uppercase">{formatted.title}</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--cream)" }}>
                {formatted.body}
              </p>
            </article>
          );
        })}
      </div>
      {!mobileOpen && (
        <p className="text-xs lg:hidden" style={{ color: "var(--muted)" }}>
          Haber akışı gizli — “Aç” ile göster.
        </p>
      )}
    </div>
  );
}
