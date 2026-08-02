"use client";

import { useEffect, useMemo, useState } from "react";
import { useSimulation } from "@/hooks/useSimulation";
import { SeatChart } from "@/components/SeatChart";
import { NewsFeed } from "@/components/NewsFeed";
import { BillPanel } from "@/components/BillPanel";
import { MetricGauges } from "@/components/MetricGauges";
import { PollBars } from "@/components/PollBars";
import { PartyCards } from "@/components/PartyCards";
import { CabinetBanner } from "@/components/CabinetBanner";
import { StatusStrip } from "@/components/StatusStrip";
import { SimControls } from "@/components/SimControls";
import { RegimePanel } from "@/components/RegimePanel";
import {
  PodiumPanel,
  DiffPanel,
  DecisionPanel,
  LatencyPanel,
  RegionsPanel,
} from "@/components/DepthPanels";
import { AlmanacPanel, AttitudesPanel } from "@/components/AlmanacPanels";
import { LawCodePanel } from "@/components/LawCodePanel";

const CRISIS_LABELS: Record<string, string> = {
  economic_crisis: "Ekonomik kriz",
  aym_veto: "AYM vetosu",
  corruption_scandal: "Yolsuzluk skandalı",
  revolutionary_moment: "Devrimci an",
  theocratic_surge: "Teokratik dalga",
};

const GUIDE_KEY = "pm_guide_dismissed_v1";

export default function HomePage() {
  const { state, loading, error, liveEvents, start, pause, tick, refresh } =
    useSimulation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [alliancesOpen, setAlliancesOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  useEffect(() => {
    try {
      setGuideOpen(localStorage.getItem(GUIDE_KEY) !== "1");
    } catch {
      setGuideOpen(true);
    }
  }, []);

  const dismissGuide = () => {
    setGuideOpen(false);
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const changeSpeed = async (speed: number) => {
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const seatParties = useMemo(
    () =>
      (state?.parties ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        seats: p.seats,
        order: p.slug === "left" ? 0 : p.slug === "center" ? 1 : 2,
        role: p.is_government
          ? ("government" as const)
          : p.is_coalition_partner
            ? ("partner" as const)
            : ("opposition" as const),
      })),
    [state?.parties]
  );

  if (loading || !state) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p style={{ color: "var(--muted)" }}>Meclis yükleniyor…</p>
      </main>
    );
  }

  const { simulation, parties, metrics, regime, situation } = state;
  const showAllianceSection =
    state.alliances.length > 0 || state.negotiations.length > 0;

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-4 md:px-6 md:pb-8">
      {/* B: Marka + kontroller — meclisten önce ama kısa */}
      <header className="mb-3">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              className="text-2xl md:text-3xl"
              style={{
                fontFamily: "var(--font-display), serif",
                color: "var(--gold-soft)",
              }}
            >
              PoliticalMatrix
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              Otonom Meclis — ülke her forma evrilebilir
            </p>
          </div>
          <div className="hidden md:block">
            <SimControls
              status={simulation.status}
              speed={simulation.speed}
              lmConnected={state.lmConnected}
              busy={busy}
              onStart={() => run(start)}
              onPause={() => run(pause)}
              onTick={() => run(tick)}
              onSpeed={changeSpeed}
            />
          </div>
        </div>
        <div className="gold-rule" />
      </header>

      {/* A: Sticky durum şeridi */}
      <StatusStrip
        yearLabel={simulation.yearLabel}
        month={simulation.month}
        term={simulation.term}
        status={simulation.status}
        phaseLabel={situation.phaseLabel}
        lmConnected={state.lmConnected}
        llmLabel={state.llmProviderLabel || "LLM"}
        situation={situation}
      />

      {(error || actionError || !state.lmConnected) && (
        <div
          className="mb-3 border border-[var(--line)] px-3 py-2 text-sm"
          style={{ color: "#e8c8c0", background: "rgba(196,92,74,0.12)" }}
        >
          {actionError ||
            error ||
            (state.llmProvider === "openrouter"
              ? "OpenRouter kataloguna ulaşılamıyor veya partilere model atanmamış. Ayarlar’dan kontrol edin."
              : "LM Studio’yu başlatın ve Ayarlar’dan model atayın.")}
        </div>
      )}

      {guideOpen && (
        <div
          className="mb-3 flex flex-wrap items-start justify-between gap-2 border border-[var(--line)] px-3 py-2 text-xs leading-relaxed"
          style={{ color: "var(--muted)", background: "rgba(0,0,0,0.18)" }}
        >
          <p>
            Yasama:{" "}
            <span style={{ color: "#3d9a6a" }}>getirir</span> /{" "}
            <span style={{ color: "#c45c4a" }}>götürür</span>. Almanağı neden
            değiştiğini yazar. Pass / isyan / balayı parti kartında görünür.
          </p>
          <button
            type="button"
            className="shrink-0 border border-[var(--line)] px-2 py-0.5 uppercase tracking-wider"
            style={{ color: "var(--gold-soft)" }}
            onClick={dismissGuide}
          >
            Anladım
          </button>
        </div>
      )}

      {/* A: Kriz + blame */}
      {situation.crisis && simulation.pending_crisis && (
        <div
          className="mb-4 border px-3 py-2 text-sm"
          style={{
            borderColor: "#c45c4a",
            color: "#f0d0c8",
            background: "rgba(196,92,74,0.15)",
          }}
        >
          <span className="uppercase tracking-wider text-xs" style={{ color: "var(--danger)" }}>
            Kriz ·{" "}
            {CRISIS_LABELS[situation.crisis.type] || situation.crisis.type}
          </span>
          {situation.crisis.blameLeadName ? (
            <p className="mt-1">
              Suçlanan blok:{" "}
              <strong style={{ color: "var(--cream)" }}>
                {situation.crisis.blameNames.join(" · ") ||
                  situation.crisis.blameLeadName}
              </strong>
              {situation.honeymoon && (
                <span className="ml-2 text-xs" style={{ color: "var(--gold-soft)" }}>
                  (yeni iktidar balayında — miras fatura kademeli)
                </span>
              )}
            </p>
          ) : (
            <p className="mt-1">Aktif kriz devam ediyor.</p>
          )}
        </div>
      )}

      {/* B: Ana sahne — meclis önce */}
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <section className="panel p-4 md:p-5">
          <h2
            className="mb-3 text-sm tracking-[0.14em] uppercase"
            style={{
              fontFamily: "var(--font-display), serif",
              color: "var(--gold-soft)",
            }}
          >
            Meclis
          </h2>
          {regime.parliament_dissolved ? (
            <p className="py-8 text-center text-sm" style={{ color: "#e8c8c0" }}>
              Meclis feshedildi. Güç {regime.regime_label} altında.
            </p>
          ) : (
            <>
              <CabinetBanner
                parties={parties}
                alliances={state.alliances}
                governmentSeats={state.governmentSeats}
                majority={state.majority}
                phase={simulation.phase}
              />
              <SeatChart parties={seatParties} />
              {/* C: hemicycle altında kısa legend — rol tekrarı yok, sadece renk */}
              <div className="mt-2 flex flex-wrap gap-3 text-[0.7rem]" style={{ color: "var(--muted)" }}>
                {parties.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1">
                    <span style={{ color: p.color }}>●</span>
                    {p.name}
                    <span>({p.seats})</span>
                  </span>
                ))}
              </div>
            </>
          )}
          <BillPanel bill={state.activeBill} parties={parties} />
          <div className="mt-5">
            <PartyCards parties={parties} compact />
          </div>
          {state.ministries.length > 0 && (
            <div className="mt-4 text-xs">
              <h3
                className="mb-2 uppercase tracking-wider"
                style={{ color: "var(--muted)" }}
              >
                Bakanlıklar
              </h3>
              <div className="flex flex-wrap gap-2">
                {state.ministries.map((m) => (
                  <span
                    key={m.id}
                    className="border border-[var(--line)] px-2 py-1"
                  >
                    <span style={{ color: "var(--cream)" }}>{m.title}</span>
                    {": "}
                    <span
                      style={{
                        color: m.holder_name
                          ? parties.find((p) => p.name === m.holder_name)
                              ?.color || "var(--gold)"
                          : "var(--muted)",
                      }}
                    >
                      {m.holder_name || "Boş"}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* D: Feed — mobilde collapse */}
        <section className="panel p-4 md:p-5 lg:sticky lg:top-14 lg:max-h-[calc(100vh-4.5rem)] lg:overflow-hidden">
          <NewsFeed events={liveEvents} compact />
        </section>
      </div>

      <section className="panel mt-4 p-4 md:p-5">
        <h2
          className="mb-4 text-sm tracking-[0.14em] uppercase"
          style={{
            fontFamily: "var(--font-display), serif",
            color: "var(--gold-soft)",
          }}
        >
          Anketler & Halkın Duygu Durumu
        </h2>
        <MetricGauges metrics={metrics} />
        <div className="gold-rule my-5" />
        <PollBars parties={parties} pollHistory={state.pollHistory} />
      </section>

      {/* C: İttifak — KabineBanner varsa collapse */}
      {showAllianceSection && (
        <section className="panel mt-4 p-4 md:p-5">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setAlliancesOpen((v) => !v)}
          >
            <h2
              className="text-sm tracking-[0.14em] uppercase"
              style={{ color: "var(--gold-soft)" }}
            >
              İttifak & Müzakere
            </h2>
            <span className="text-xs uppercase" style={{ color: "var(--muted)" }}>
              {alliancesOpen ? "Gizle" : "Aç"}
            </span>
          </button>
          {alliancesOpen && (
            <ul className="mt-3 space-y-3 text-sm">
              {state.alliances.map((a) => {
                const accepted = a.status === "accepted";
                const from = parties.find((p) => p.id === a.from_party_id);
                const to = parties.find((p) => p.id === a.to_party_id);
                return (
                  <li
                    key={a.id}
                    className="border px-3 py-2"
                    style={{
                      borderColor: accepted
                        ? "rgba(61,154,106,0.4)"
                        : "var(--line)",
                    }}
                  >
                    <span style={{ color: from?.color }}>
                      {a.from_name}
                    </span>
                    {" ↔ "}
                    <span style={{ color: to?.color }}>{a.to_name}</span>
                    <span
                      className="ml-2"
                      style={{
                        color: accepted ? "#3d9a6a" : "var(--gold-soft)",
                      }}
                    >
                      [{a.status}]
                    </span>
                    {accepted && (a.stress ?? 0) > 0 && (
                      <span
                        className="ml-2 text-xs"
                        style={{
                          color:
                            (a.stress ?? 0) >= 52
                              ? "var(--danger)"
                              : "var(--gold-soft)",
                        }}
                      >
                        stres {(a.stress ?? 0).toFixed(0)}
                      </span>
                    )}
                    {a.concessions ? (
                      <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                        {a.concessions}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {state.negotiations.map((n) => (
                <li
                  key={n.id}
                  className="text-xs"
                  style={{ color: "var(--muted)" }}
                >
                  Müzakere {n.from_name} ↔ {n.to_name} r{n.round} [{n.status}]
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* B: Regime / Podium — ikinci plan */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <RegimePanel regime={regime} />
        <PodiumPanel podium={state.podium} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AlmanacPanel entries={state.almanac || []} />
        <AttitudesPanel attitudes={state.attitudes || []} />
      </div>

      <div className="mt-4">
        <LawCodePanel
          laws={state.lawGroups || []}
          committee={state.committeeBills || []}
        />
      </div>

      {/* Drama vs debug */}
      <section className="panel mt-4 p-4 md:p-5">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setAnalyticsOpen((v) => !v)}
        >
          <h2
            className="text-sm tracking-[0.14em] uppercase"
            style={{ color: "var(--gold-soft)" }}
          >
            Analitik & Geliştirici
          </h2>
          <span className="text-xs uppercase" style={{ color: "var(--muted)" }}>
            {analyticsOpen ? "Gizle" : "Aç"}
          </span>
        </button>
        {analyticsOpen && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RegionsPanel regions={state.regions} />
            <DiffPanel diffs={state.monthDiffs} />
            <DecisionPanel decisions={state.recentDecisions} />
            <LatencyPanel latency={state.latency} />
          </div>
        )}
      </section>

      {/* D: Mobil alt sticky kontroller */}
      <div
        className="controls-dock fixed inset-x-0 bottom-0 z-50 border-t px-3 py-2 md:hidden"
        style={{
          borderColor: "var(--line)",
          background: "rgba(7, 20, 15, 0.94)",
          backdropFilter: "blur(10px)",
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <SimControls
          status={simulation.status}
          speed={simulation.speed}
          lmConnected={state.lmConnected}
          busy={busy}
          onStart={() => run(start)}
          onPause={() => run(pause)}
          onTick={() => run(tick)}
          onSpeed={changeSpeed}
        />
      </div>
    </main>
  );
}
