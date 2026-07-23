"use client";

import { useState } from "react";
import { useSimulation } from "@/hooks/useSimulation";
import { SeatChart } from "@/components/SeatChart";
import { NewsFeed } from "@/components/NewsFeed";
import { BillPanel } from "@/components/BillPanel";
import { MetricGauges } from "@/components/MetricGauges";
import { PollBars } from "@/components/PollBars";
import { PartyCards } from "@/components/PartyCards";
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

export default function HomePage() {
  const { state, loading, error, liveEvents, start, pause, tick, refresh } =
    useSimulation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  if (loading || !state) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p style={{ color: "var(--muted)" }}>Meclis yükleniyor…</p>
      </main>
    );
  }

  const { simulation, parties, metrics, regime } = state;

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p
              className="mb-1 text-xs tracking-[0.22em] uppercase"
              style={{ color: "var(--gold)" }}
            >
              PoliticalMatrix.js
            </p>
            <h1
              className="text-2xl md:text-3xl"
              style={{ fontFamily: "var(--font-display), serif" }}
            >
              Autonomous Party Simulator
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Ülke demokraside kilitli değil — krallık, teokrasi, komünizm, faşizm
              dahil her forma evrilebilir.
            </p>
          </div>
          <div className="text-right text-xs" style={{ color: "var(--muted)" }}>
            <div>
              TERM: {simulation.term}. · {simulation.yearLabel} · AY{" "}
              {simulation.month} · {simulation.tick_mode}
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background: state.lmConnected ? "#3d9a6a" : "#c45c4a",
                }}
              />
              {state.llmProviderLabel || "LLM"}:{" "}
              {state.lmConnected ? "bağlı" : "yok"}
              <span>·</span>
              <span className="uppercase">{simulation.status}</span>
              <span>·</span>
              <span>
                {{
                  governing: "iktidar",
                  voting: "oylama",
                  election: "seçim / kampanya",
                  coalition_talks: "koalisyon görüşmeleri",
                  crisis: "kriz",
                  confidence: "gensoru / güvenoyu",
                  negotiation: "müzakere",
                  regime_transition: "rejim geçişi",
                }[simulation.phase] || simulation.phase}
              </span>
            </div>
          </div>
        </div>
        <div className="gold-rule mb-4" />
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
        {(error || actionError || !state.lmConnected) && (
          <div
            className="mt-3 border border-[var(--line)] px-3 py-2 text-sm"
            style={{ color: "#e8c8c0", background: "rgba(196,92,74,0.12)" }}
          >
            {actionError ||
              error ||
              (state.llmProvider === "openrouter"
                ? "OpenRouter kataloguna ulaşılamıyor veya partilere model atanmamış. Ayarlar’dan kontrol edin."
                : "LM Studio’yu başlatın ve Ayarlar’dan model atayın.")}
          </div>
        )}
        <div
          className="mt-3 border border-[var(--line)] px-3 py-2 text-xs leading-relaxed"
          style={{ color: "var(--muted)", background: "rgba(0,0,0,0.18)" }}
        >
          Nasıl okunur: Yasama panelinde kanun{" "}
          <span style={{ color: "#3d9a6a" }}>getirir</span> /{" "}
          <span style={{ color: "#c45c4a" }}>götürür</span> ve parti oyları
          görünür. <span style={{ color: "var(--gold-soft)" }}>Almanağı</span>{" "}
          metriklerin neden değiştiğini yazar.{" "}
          <span style={{ color: "var(--gold-soft)" }}>Bakış</span> paneli
          Victoria 3 tarzı ilişkileri gösterir — rakip/düşman ittifak kuramaz;
          kabul edilen ittifakta ortak en az 2 bakanlık alır.
        </div>
        {simulation.pending_crisis && (
          <div
            className="mt-3 border px-3 py-2 text-sm"
            style={{
              borderColor: "#c45c4a",
              color: "#f0d0c8",
              background: "rgba(196,92,74,0.15)",
            }}
          >
            Kriz: {simulation.pending_crisis}
          </div>
        )}
      </header>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <RegimePanel regime={regime} />
        <PodiumPanel podium={state.podium} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="panel p-4 md:p-5">
          <h2
            className="mb-3 text-sm tracking-[0.14em] uppercase"
            style={{
              fontFamily: "var(--font-display), serif",
              color: "var(--gold-soft)",
            }}
          >
            Meclis Koltuk Dağılımı
          </h2>
          {regime.parliament_dissolved ? (
            <p className="py-8 text-center text-sm" style={{ color: "#e8c8c0" }}>
              Meclis feshedildi. Güç {regime.regime_label} altında.
            </p>
          ) : (
            <SeatChart
              parties={parties.map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                seats: p.seats,
              }))}
            />
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs">
            {parties.map((p) => (
              <span key={p.id}>
                <span style={{ color: p.color }}>●</span> {p.name} (%
                {((p.seats / 600) * 100).toFixed(0)})
                {p.ideology_vector
                  ? ` · rad ${p.ideology_vector.radicalism.toFixed(0)}`
                  : ""}
              </span>
            ))}
          </div>
          <BillPanel bill={state.activeBill} parties={parties} />
          <div className="mt-5">
            <PartyCards
              parties={parties}
              governmentSeats={state.governmentSeats}
              majority={state.majority}
            />
          </div>
          {state.ministries.length > 0 && (
            <div className="mt-4 text-xs">
              <h3 className="mb-2 uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Bakanlıklar
                <span className="ml-2 normal-case tracking-normal" style={{ color: "var(--gold-soft)" }}>
                  (ittifakta ortak en az 2 bakanlık alır)
                </span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {state.ministries.map((m) => (
                  <span key={m.id} className="border border-[var(--line)] px-2 py-1">
                    <span style={{ color: "var(--cream)" }}>{m.title}</span>
                    {": "}
                    <span
                      style={{
                        color: m.holder_name
                          ? parties.find((p) => p.name === m.holder_name)?.color ||
                            "var(--gold)"
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

        <section className="panel p-4 md:p-5">
          <NewsFeed events={liveEvents} />
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RegionsPanel regions={state.regions} />
        <DiffPanel diffs={state.monthDiffs} />
        <DecisionPanel decisions={state.recentDecisions} />
        <LatencyPanel latency={state.latency} />
      </div>

      {(state.alliances.length > 0 || state.negotiations.length > 0) && (
        <section className="panel mt-4 p-4 md:p-5">
          <h2
            className="mb-1 text-sm tracking-[0.14em] uppercase"
            style={{ color: "var(--gold-soft)" }}
          >
            İttifak & Müzakere
          </h2>
          <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
            Kabul edilen ittifak = bakanlık paylaşımı. Bakış açısı rakip/düşman
            seviyesindeyse ittifak engellenir.
          </p>
          <ul className="space-y-3 text-sm">
            {state.alliances.map((a) => {
              const accepted = a.status === "accepted";
              const partnerMins = accepted
                ? state.ministries.filter(
                    (m) =>
                      m.holder_name === a.from_name ||
                      m.holder_name === a.to_name
                  )
                : [];
              return (
                <li
                  key={a.id}
                  className="border border-[var(--line)] px-3 py-2"
                >
                  <div>
                    {a.from_name} ↔ {a.to_name}{" "}
                    <span
                      style={{
                        color: accepted ? "#3d9a6a" : "var(--gold-soft)",
                      }}
                    >
                      [{a.status === "accepted" ? "kabul" : a.status === "pending" ? "beklemede" : a.status}]
                    </span>
                  </div>
                  {a.concessions ? (
                    <div className="mt-1 text-xs" style={{ color: "var(--cream)" }}>
                      Taviz: {a.concessions}
                    </div>
                  ) : null}
                  {accepted && partnerMins.length > 0 && (
                    <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      Bakanlıklar:{" "}
                      {partnerMins
                        .map((m) => `${m.title} (${m.holder_name})`)
                        .join(" · ")}
                    </div>
                  )}
                </li>
              );
            })}
            {state.negotiations.map((n) => (
              <li key={n.id} className="text-xs" style={{ color: "var(--muted)" }}>
                Müzakere {n.from_name} ↔ {n.to_name} r{n.round} [{n.status}]
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
