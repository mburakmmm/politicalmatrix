"use client";

interface PartyCardsProps {
  parties: Array<{
    id: string;
    name: string;
    color: string;
    ideology: string;
    seats: number;
    poll_share: number;
    model_id: string | null;
    is_government: boolean;
    is_formateur?: boolean;
  }>;
  governmentSeats: number;
  majority: boolean;
}

export function PartyCards({
  parties,
  governmentSeats,
  majority,
}: PartyCardsProps) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
        <span>
          Hükümet sandalyesi:{" "}
          <strong style={{ color: majority ? "#3d9a6a" : "#c45c4a" }}>
            {governmentSeats}/600
          </strong>
          <span> (eşik 301)</span>
        </span>
        <span>{majority ? "Çoğunluk var" : "Koalisyon gerekli"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {parties.map((p) => (
          <div
            key={p.id}
            className="border border-[var(--line)] p-3"
            style={{ borderTop: `3px solid ${p.color}` }}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h4
                className="text-sm leading-tight"
                style={{ fontFamily: "var(--font-display), serif" }}
              >
                {p.name}
              </h4>
              {p.is_government ? (
                <span
                  className="shrink-0 text-[0.65rem] tracking-wider uppercase"
                  style={{ color: "var(--gold)" }}
                >
                  İktidar
                </span>
              ) : p.is_formateur ? (
                <span
                  className="shrink-0 text-[0.65rem] tracking-wider uppercase"
                  style={{ color: "var(--cream)" }}
                >
                  Formateur
                </span>
              ) : null}
            </div>
            <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
              {p.ideology}
            </p>
            <p className="text-sm">
              {p.seats} sandalye · %{p.poll_share.toFixed(1)}
            </p>
            <p className="mt-1 truncate text-[0.7rem]" style={{ color: "var(--muted)" }}>
              Model: {p.model_id || "atanmadı"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
