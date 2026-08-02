"use client";

import type { RegimePublic } from "@/lib/types";

export function RegimePanel({ regime }: { regime: RegimePublic }) {
  const authoritarian =
    regime.parliament_dissolved || regime.elections_suspended;

  return (
    <section
      className="panel p-4 md:p-5"
      style={{
        borderColor: authoritarian ? "rgba(196,92,74,0.55)" : undefined,
      }}
    >
      <h2
        className="mb-2 text-sm tracking-[0.14em] uppercase"
        style={{
          fontFamily: "var(--font-display), serif",
          color: authoritarian ? "#e8c8c0" : "var(--gold-soft)",
        }}
      >
        Ülke Rejimi
      </h2>
      <p
        className="mb-1 text-xl"
        style={{ fontFamily: "var(--font-display), serif" }}
      >
        {regime.regime_label}
      </p>
      <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
        {regime.regime_type}
        {regime.monarch_title ? ` · ${regime.monarch_title}` : ""}
        {regime.state_religion ? ` · Din: ${regime.state_religion}` : ""}
        {regime.ruling_doctrine ? ` · Doktrin: ${regime.ruling_doctrine}` : ""}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div>Anayasa gücü: {regime.constitution_strength.toFixed(0)}</div>
        <div>Laiklik: {regime.secularism.toFixed(0)}</div>
        <div>Sivil özgürlük: {regime.civil_liberties.toFixed(0)}</div>
        <div>Basın: {regime.press_freedom.toFixed(0)}</div>
      </div>
      {(regime.parliament_dissolved || regime.elections_suspended) && (
        <p className="mt-3 text-sm" style={{ color: "#e8c8c0" }}>
          {regime.parliament_dissolved ? "Meclis feshedildi. " : ""}
          {regime.elections_suspended ? "Seçimler askıda." : ""}
        </p>
      )}
      {regime.transformation_notes && (
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          {regime.transformation_notes}
        </p>
      )}
    </section>
  );
}
