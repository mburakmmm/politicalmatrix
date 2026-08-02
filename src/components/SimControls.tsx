"use client";

import Link from "next/link";

interface SimControlsProps {
  status: string;
  speed: number;
  lmConnected: boolean;
  busy?: boolean;
  onStart: () => void;
  onPause: () => void;
  onTick: () => void;
  onSpeed: (speed: number) => void;
}

export function SimControls({
  status,
  speed,
  lmConnected,
  busy,
  onStart,
  onPause,
  onTick,
  onSpeed,
}: SimControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "running" ? (
        <button className="btn" disabled={busy} onClick={onPause}>
          Duraklat
        </button>
      ) : (
        <button className="btn btn-solid" disabled={busy || !lmConnected} onClick={onStart}>
          Başlat
        </button>
      )}
      <button className="btn btn-ghost" disabled={busy} onClick={onTick}>
        Tek Ay İlerlet
      </button>
      <div className="flex items-center gap-1 ml-1">
        {[0.5, 1, 2, 4].map((s) => (
          <button
            key={s}
            className="btn btn-ghost"
            style={{
              padding: "0.4rem 0.55rem",
              borderColor: speed === s ? "var(--gold)" : undefined,
              color: speed === s ? "var(--gold-soft)" : undefined,
            }}
            onClick={() => onSpeed(s)}
          >
            {s}x
          </button>
        ))}
      </div>
      <Link href="/settings" className="btn btn-ghost ml-auto">
        Ayarlar
      </Link>
    </div>
  );
}
