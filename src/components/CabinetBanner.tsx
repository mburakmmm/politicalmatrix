"use client";

interface CabinetParty {
  id: string;
  name: string;
  color: string;
  seats: number;
  is_government: boolean;
  is_coalition_partner?: boolean;
  is_formateur?: boolean;
}

interface AllianceInfo {
  from_party_id: string;
  to_party_id: string;
  from_name: string;
  to_name: string;
  status: string;
  stress?: number;
  consecutive_nos?: number;
}

interface CabinetBannerProps {
  parties: CabinetParty[];
  alliances: AllianceInfo[];
  governmentSeats: number;
  majority: boolean;
  phase: string;
}

export function CabinetBanner({
  parties,
  alliances,
  governmentSeats,
  majority,
  phase,
}: CabinetBannerProps) {
  const lead = parties.find((p) => p.is_government);
  const formateur = parties.find((p) => p.is_formateur && !p.is_government);
  const partners = parties.filter((p) => p.is_coalition_partner);
  const opposition = parties.filter(
    (p) => !p.is_government && !p.is_coalition_partner && !p.is_formateur
  );

  const accepted = alliances.filter((a) => a.status === "accepted");
  const maxStress = accepted.reduce(
    (m, a) => Math.max(m, a.stress ?? 0),
    0
  );

  const forming =
    phase === "coalition_talks" ||
    phase === "negotiation" ||
    (!!formateur && !lead);

  if (!lead && !formateur && partners.length === 0) {
    return (
      <div
        className="mb-4 border px-3 py-3"
        style={{
          borderColor: "rgba(196,92,74,0.45)",
          background: "rgba(196,92,74,0.08)",
        }}
      >
        <p
          className="text-[0.65rem] tracking-[0.18em] uppercase"
          style={{ color: "var(--danger)" }}
        >
          Kabine yok
        </p>
        <p className="mt-1 text-sm" style={{ color: "var(--cream)" }}>
          Mühürlü iktidar yok — koalisyon veya formateur süreci bekleniyor.
        </p>
        {opposition.length > 0 && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Meclis: {opposition.map((p) => p.name).join(" · ")}
          </p>
        )}
      </div>
    );
  }

  const stressColor =
    maxStress >= 70
      ? "var(--danger)"
      : maxStress >= 52
        ? "#d4a06a"
        : maxStress >= 28
          ? "var(--gold-soft)"
          : "var(--muted)";

  return (
    <div
      className="mb-4 border px-3 py-3"
      style={{
        borderColor: majority
          ? "rgba(212,175,55,0.45)"
          : "rgba(196,92,74,0.35)",
        background: majority
          ? "linear-gradient(135deg, rgba(212,175,55,0.12), rgba(16,36,28,0.4))"
          : "rgba(196,92,74,0.07)",
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-[0.65rem] tracking-[0.18em] uppercase"
          style={{ color: "var(--gold)" }}
        >
          {forming ? "Kabine oluşumu" : "İktidar bloğu"}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span>
            Blok:{" "}
            <strong style={{ color: majority ? "var(--ok)" : "var(--danger)" }}>
              {governmentSeats}/600
            </strong>
            <span style={{ color: "var(--muted)" }}> · eşik 301</span>
          </span>
          {accepted.length > 0 && (
            <span style={{ color: stressColor }}>
              Koalisyon stresi {maxStress.toFixed(0)}/100
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {(lead || formateur) && (
          <BlocChip
            party={lead || formateur!}
            label={lead ? "İktidar" : "Formateur"}
            accent="gold"
          />
        )}
        {partners.map((p) => (
          <BlocChip
            key={p.id}
            party={p}
            label={forming ? "Müzakere ortağı" : "Koalisyon ortağı"}
            accent="partner"
          />
        ))}
        {opposition.map((p) => (
          <BlocChip key={p.id} party={p} label="Muhalefet" accent="muted" />
        ))}
      </div>

      {accepted.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {accepted.map((a) => (
            <li key={`${a.from_party_id}-${a.to_party_id}`} className="text-xs">
              <span style={{ color: "var(--cream)" }}>
                {a.from_name} ↔ {a.to_name}
              </span>
              <span style={{ color: "var(--muted)" }}>
                {" "}
                · gerilim {(a.stress ?? 0).toFixed(0)}
                {(a.consecutive_nos ?? 0) > 0
                  ? ` · ardışık ret ${a.consecutive_nos}`
                  : ""}
              </span>
              <div
                className="mt-1 h-1 overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min(100, a.stress ?? 0)}%`,
                    background:
                      (a.stress ?? 0) >= 52
                        ? "var(--danger)"
                        : (a.stress ?? 0) >= 28
                          ? "var(--gold)"
                          : "var(--ok)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlocChip({
  party,
  label,
  accent,
}: {
  party: CabinetParty;
  label: string;
  accent: "gold" | "partner" | "muted";
}) {
  const border =
    accent === "gold"
      ? "rgba(212,175,55,0.65)"
      : accent === "partner"
        ? "rgba(100,180,140,0.55)"
        : "var(--line)";
  const bg =
    accent === "gold"
      ? "rgba(212,175,55,0.14)"
      : accent === "partner"
        ? "rgba(61,154,106,0.12)"
        : "rgba(0,0,0,0.2)";
  const labelColor =
    accent === "gold"
      ? "var(--gold)"
      : accent === "partner"
        ? "#7dcea0"
        : "var(--muted)";

  return (
    <div
      className="min-w-[9.5rem] flex-1 border px-3 py-2"
      style={{
        borderColor: border,
        background: bg,
        boxShadow:
          accent === "gold" ? "0 0 0 1px rgba(212,175,55,0.15)" : undefined,
      }}
    >
      <div
        className="text-[0.62rem] tracking-[0.16em] uppercase"
        style={{ color: labelColor }}
      >
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: party.color }}
          aria-hidden
        />
        <span
          className="text-sm leading-tight"
          style={{ fontFamily: "var(--font-display), serif" }}
        >
          {party.name}
        </span>
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        {party.seats} sandalye
      </div>
    </div>
  );
}
