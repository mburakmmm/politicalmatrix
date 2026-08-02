"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";

export interface SeatParty {
  id: string;
  name: string;
  color: string;
  seats: number;
  /** Sol→sağ sıra (küçük = sol kanat) */
  order?: number;
  /** İktidar / ortak — hemicycle vurgusu */
  role?: "government" | "partner" | "opposition";
}

interface SeatChartProps {
  parties: SeatParty[];
  width?: number;
  height?: number;
}

type SeatPos = { x: number; y: number; angle: number; row: number };

/**
 * Gerçek meclis hemicycle:
 * 1) Koltuklar yay üzerinde geometrik yerleştirilir
 * 2) Açıya göre soldan sağa sıralanır
 * 3) Partiler ideoloji sırasıyla bitişik bloklar halinde boyanır
 * (Wikipedia / parliamentdiagram mantığı)
 */
function buildHemicyclePositions(
  totalSeats: number,
  width: number,
  height: number
): SeatPos[] {
  const n = Math.max(1, totalSeats);
  // 600 sandalye için ~12 sıra — TBMM/EP tarzı yoğunluk
  const rows = Math.max(8, Math.min(14, Math.round(Math.sqrt(n) * 0.55)));
  const cx = width / 2;
  const cy = height - 10;
  const innerR = Math.max(48, height * 0.22);
  const outerR = Math.min(width * 0.48, height * 0.92);

  // Yay uzunluğuna orantılı koltuk sayısı
  const weights: number[] = [];
  let weightSum = 0;
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0 : r / (rows - 1);
    const radius = innerR + (outerR - innerR) * t;
    const w = Math.max(0.001, radius);
    weights.push(w);
    weightSum += w;
  }

  const rowCounts: number[] = [];
  let remaining = n;
  for (let r = 0; r < rows; r++) {
    if (r === rows - 1) {
      rowCounts.push(remaining);
      break;
    }
    const ideal = Math.round((weights[r] / weightSum) * n);
    const count = Math.max(1, Math.min(remaining - (rows - r - 1), ideal));
    rowCounts.push(count);
    remaining -= count;
  }

  const positions: SeatPos[] = [];
  for (let r = 0; r < rows; r++) {
    const t = rows === 1 ? 0 : r / (rows - 1);
    const radius = innerR + (outerR - innerR) * t;
    const count = rowCounts[r];
    // Uçlarda yarım aralık — koltuklar kenara yapışmasın
    for (let i = 0; i < count; i++) {
      const frac = count === 1 ? 0.5 : i / (count - 1);
      // π → 0 : sol (muhalefet/sol) → sağ
      const angle = Math.PI - frac * Math.PI;
      positions.push({
        x: cx + radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
        angle,
        row: r,
      });
    }
  }

  // Soldan sağa boyama: önce açı (büyük=sol), aynı açıda iç sıra önde
  positions.sort((a, b) => {
    if (Math.abs(a.angle - b.angle) > 1e-9) return b.angle - a.angle;
    return a.row - b.row;
  });

  return positions;
}

function seatFingerprint(parties: SeatParty[]): string {
  return parties
    .map((p) => `${p.id}:${p.seats}:${p.color}:${p.role || "-"}`)
    .sort()
    .join("|");
}

function SeatChartInner({
  parties,
  width = 560,
  height = 320,
}: SeatChartProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const drawnKey = useRef<string>("");

  const fingerprint = useMemo(() => seatFingerprint(parties), [parties]);

  const orderedParties = useMemo(() => {
    const slugOrder: Record<string, number> = {
      left: 0,
      sol: 0,
      center: 1,
      merkez: 1,
      right: 2,
      sag: 2,
      sağ: 2,
    };
    return [...parties]
      .filter((p) => p.seats > 0)
      .sort((a, b) => {
        if (a.order != null && b.order != null) return a.order - b.order;
        const ao = a.order ?? 99;
        const bo = b.order ?? 99;
        if (ao !== bo && (a.order != null || b.order != null)) return ao - bo;
        // isimden kaba ideoloji
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        const as =
          slugOrder[
            Object.keys(slugOrder).find((k) => an.includes(k)) || ""
          ] ?? 50;
        const bs =
          slugOrder[
            Object.keys(slugOrder).find((k) => bn.includes(k)) || ""
          ] ?? 50;
        if (as !== bs) return as - bs;
        return a.name.localeCompare(b.name, "tr");
      });
  }, [parties]);

  useEffect(() => {
    if (!ref.current) return;

    // Aynı dağılım → DOM'u yeniden kurma / animasyon yok
    const drawKey = `${fingerprint}|${width}|${height}`;
    if (drawnKey.current === drawKey) return;
    drawnKey.current = drawKey;

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const total = orderedParties.reduce((s, p) => s + p.seats, 0);
    if (total <= 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#8fa898")
        .attr("font-size", 12)
        .text("Sandalye yok");
      return;
    }

    const positions = buildHemicyclePositions(total, width, height);

    // Bitişik parti blokları
    const paint: Array<{
      color: string;
      partyId: string;
      name: string;
      role?: SeatParty["role"];
    }> = [];
    for (const p of orderedParties) {
      for (let i = 0; i < p.seats; i++) {
        paint.push({
          color: p.color,
          partyId: p.id,
          name: p.name,
          role: p.role,
        });
      }
    }

    const seatR = Math.max(
      2.2,
      Math.min(4.2, (width / Math.sqrt(total)) * 0.22)
    );

    const g = svg.append("g").attr("class", "hemicycle");

    positions.forEach((pos, idx) => {
      const seat = paint[idx];
      if (!seat) return;
      const isGov = seat.role === "government";
      const isPartner = seat.role === "partner";
      const circle = g
        .append("circle")
        .attr("cx", pos.x)
        .attr("cy", pos.y)
        .attr("r", isGov ? seatR * 1.08 : seatR)
        .attr("fill", seat.color)
        .attr(
          "stroke",
          isGov
            ? "rgba(212,175,55,0.95)"
            : isPartner
              ? "rgba(125,206,160,0.85)"
              : "rgba(0,0,0,0.35)"
        )
        .attr("stroke-width", isGov || isPartner ? 1.15 : 0.4)
        .attr("data-party", seat.partyId);
      const roleTr =
        isGov ? " — İktidar" : isPartner ? " — Koalisyon ortağı" : "";
      circle.append("title").text(`${seat.name}${roleTr}`);
    });

    // Dağılım gerçekten değişince kısa fade-in
    g.selectAll("circle")
      .attr("opacity", 0)
      .transition()
      .duration(280)
      .delay((_, i) => Math.min(400, (Number(i) % 50) * 3))
      .attr("opacity", 1);

    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", height - 4)
      .attr("text-anchor", "middle")
      .attr("fill", "#8fa898")
      .attr("font-size", 11)
      .attr("letter-spacing", "0.14em")
      .text(`${total} SANDALYE`);
  }, [fingerprint, orderedParties, width, height]);

  return (
    <svg
      ref={ref}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Meclis koltuk dağılımı (hemicycle)"
      className="overflow-visible"
    />
  );
}

function partiesEqual(a: SeatParty[], b: SeatParty[]): boolean {
  return seatFingerprint(a) === seatFingerprint(b);
}

export const SeatChart = memo(SeatChartInner, (prev, next) => {
  return (
    prev.width === next.width &&
    prev.height === next.height &&
    partiesEqual(prev.parties, next.parties)
  );
});
