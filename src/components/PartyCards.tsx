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
    is_coalition_partner?: boolean;
    is_formateur?: boolean;
    ministries?: string[];
    signals?: Array<"idle" | "rebellion" | "honeymoon" | "blame">;
  }>;
  /** KabineBanner zaten gösteriyorsa sandalyeyi tekrarlama */
  compact?: boolean;
}

function roleLabel(p: PartyCardsProps["parties"][number]): {
  text: string;
  tone: "gold" | "partner" | "formateur" | "muted";
} {
  if (p.is_government) return { text: "İktidar", tone: "gold" };
  if (p.is_coalition_partner)
    return { text: "Ortak", tone: "partner" };
  if (p.is_formateur) return { text: "Formateur", tone: "formateur" };
  return { text: "Muhalefet", tone: "muted" };
}

const SIGNAL_STYLE: Record<
  string,
  { label: string; color: string; border: string }
> = {
  idle: { label: "Pass", color: "var(--muted)", border: "rgba(143,168,152,0.45)" },
  rebellion: {
    label: "İsyan",
    color: "var(--gold-soft)",
    border: "rgba(232,200,114,0.5)",
  },
  honeymoon: {
    label: "Balayı",
    color: "var(--gold)",
    border: "rgba(212,175,55,0.45)",
  },
  blame: {
    label: "Kriz izi",
    color: "#f0d0c8",
    border: "rgba(196,92,74,0.5)",
  },
};

export function PartyCards({ parties, compact }: PartyCardsProps) {
  const sorted = [...parties].sort((a, b) => {
    const rank = (p: (typeof parties)[number]) =>
      p.is_government
        ? 0
        : p.is_coalition_partner
          ? 1
          : p.is_formateur
            ? 2
            : 3;
    return rank(a) - rank(b);
  });

  return (
    <div>
      {!compact && (
        <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
          Partiler
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {sorted.map((p) => {
          const role = roleLabel(p);
          const inBloc = p.is_government || p.is_coalition_partner;
          const borderColor =
            role.tone === "gold"
              ? "rgba(212,175,55,0.55)"
              : role.tone === "partner"
                ? "rgba(61,154,106,0.5)"
                : "var(--line)";
          const badgeColor =
            role.tone === "gold"
              ? "var(--gold)"
              : role.tone === "partner"
                ? "#7dcea0"
                : role.tone === "formateur"
                  ? "var(--cream)"
                  : "var(--muted)";

          return (
            <div
              key={p.id}
              className="relative overflow-hidden border p-3"
              style={{
                borderColor,
                borderTop: `3px solid ${p.color}`,
                background: p.is_government
                  ? "linear-gradient(165deg, rgba(212,175,55,0.14), rgba(16,36,28,0.35))"
                  : p.is_coalition_partner
                    ? "linear-gradient(165deg, rgba(61,154,106,0.12), rgba(16,36,28,0.3))"
                    : undefined,
                boxShadow: p.is_government
                  ? "0 0 0 1px rgba(212,175,55,0.18)"
                  : undefined,
              }}
            >
              {inBloc && (
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-1"
                  style={{
                    background: p.is_government ? "var(--gold)" : "#3d9a6a",
                  }}
                />
              )}
              <div className="mb-1 flex items-start justify-between gap-2">
                <h4
                  className="text-sm leading-tight"
                  style={{ fontFamily: "var(--font-display), serif" }}
                >
                  {p.name}
                </h4>
                <span
                  className="shrink-0 text-[0.65rem] tracking-wider uppercase"
                  style={{ color: badgeColor }}
                >
                  {role.text}
                </span>
              </div>
              <p className="text-sm">
                {p.seats} sandalye · %{p.poll_share.toFixed(1)}
              </p>
              {p.signals && p.signals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.signals.map((s) => {
                    const st = SIGNAL_STYLE[s];
                    if (!st) return null;
                    return (
                      <span
                        key={s}
                        className="border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider"
                        style={{
                          borderColor: st.border,
                          color: st.color,
                        }}
                      >
                        {st.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {p.ministries && p.ministries.length > 0 && (
                <p
                  className="mt-1.5 text-[0.7rem] leading-snug"
                  style={{ color: inBloc ? "var(--cream)" : "var(--muted)" }}
                >
                  {p.ministries.slice(0, 3).join(", ")}
                  {p.ministries.length > 3 ? "…" : ""}
                </p>
              )}
              <p
                className="mt-1 truncate text-[0.65rem]"
                style={{ color: "var(--muted)" }}
              >
                {p.model_id || "model yok"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
