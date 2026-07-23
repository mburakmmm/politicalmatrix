"use client";

interface MetricGaugesProps {
  metrics: {
    economy: number;
    freedom: number;
    security: number;
    fear: number;
    inflation: number;
    unemployment: number;
  };
}

const LABELS: Array<{ key: keyof MetricGaugesProps["metrics"]; label: string; invert?: boolean }> = [
  { key: "economy", label: "Ekonomi Güveni" },
  { key: "freedom", label: "Özgürlük Hissi" },
  { key: "security", label: "Güvenlik" },
  { key: "fear", label: "Korku", invert: true },
  { key: "inflation", label: "Enflasyon", invert: true },
  { key: "unemployment", label: "İşsizlik", invert: true },
];

function barColor(value: number, invert?: boolean): string {
  const v = invert ? 100 - value : value;
  if (v >= 60) return "#3d9a6a";
  if (v >= 40) return "#d4af37";
  return "#c45c4a";
}

export function MetricGauges({ metrics }: MetricGaugesProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {LABELS.map(({ key, label, invert }) => {
        const value = metrics[key];
        return (
          <div key={key}>
            <div className="mb-1 flex justify-between text-xs">
              <span style={{ color: "var(--muted)" }}>{label}</span>
              <span style={{ color: "var(--cream)" }}>{value.toFixed(0)}/100</span>
            </div>
            <div className="metric-track">
              <div
                className="metric-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, value))}%`,
                  background: barColor(value, invert),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
