"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface PollBarsProps {
  parties: Array<{
    slug: string;
    name: string;
    color: string;
    poll_share: number;
    seats: number;
  }>;
  pollHistory: Array<{ month: number; shares: Record<string, number> }>;
}

export function PollBars({ parties, pollHistory }: PollBarsProps) {
  const chartData = pollHistory.slice(-24).map((row) => {
    const point: Record<string, number | string> = { month: `A${row.month}` };
    for (const p of parties) {
      point[p.slug] = row.shares[p.slug] ?? null as unknown as number;
    }
    return point;
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3
          className="mb-3 text-xs tracking-[0.12em] uppercase"
          style={{ color: "var(--muted)" }}
        >
          Son Anket
        </h3>
        <ul className="space-y-3">
          {parties.map((p) => (
            <li key={p.slug}>
              <div className="mb-1 flex justify-between text-sm">
                <span>
                  <span style={{ color: p.color }}>●</span> {p.name}
                </span>
                <span>
                  %{p.poll_share.toFixed(1)} · {p.seats} sandalye
                </span>
              </div>
              <div className="metric-track">
                <div
                  className="metric-fill"
                  style={{
                    width: `${p.poll_share}%`,
                    background: p.color,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="h-52">
        <h3
          className="mb-3 text-xs tracking-[0.12em] uppercase"
          style={{ color: "var(--muted)" }}
        >
          Anket Trendi
        </h3>
        {chartData.length < 2 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Trend için daha fazla ay gerekli.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgba(212,175,55,0.12)" />
              <XAxis dataKey="month" stroke="#8fa898" fontSize={11} />
              <YAxis stroke="#8fa898" fontSize={11} domain={[0, 60]} />
              <Tooltip
                contentStyle={{
                  background: "#10241c",
                  border: "1px solid rgba(212,175,55,0.3)",
                  color: "#e8efe6",
                }}
              />
              {parties.map((p) => (
                <Line
                  key={p.slug}
                  type="monotone"
                  dataKey={p.slug}
                  stroke={p.color}
                  strokeWidth={2}
                  dot={false}
                  name={p.name}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
