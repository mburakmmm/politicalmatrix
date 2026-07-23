"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

export interface SeatParty {
  id: string;
  name: string;
  color: string;
  seats: number;
}

interface SeatChartProps {
  parties: SeatParty[];
  width?: number;
  height?: number;
}

/** Semi-circular parliament (hemicycle) seat layout */
export function SeatChart({
  parties,
  width = 520,
  height = 300,
}: SeatChartProps) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const total = parties.reduce((s, p) => s + p.seats, 0) || 1;
    const rows = 8;
    const seatRadius = 3.2;
    const cx = width / 2;
    const cy = height - 12;
    const innerR = 70;
    const outerR = Math.min(width, height * 2) / 2 - 16;
    const rowDenom = Math.max(1, rows - 1);

    // Expand seats list
    const seats: Array<{ color: string; partyId: string }> = [];
    for (const p of parties) {
      for (let i = 0; i < p.seats; i++) {
        seats.push({ color: p.color, partyId: p.id });
      }
    }

    // Distribute across rows proportionally to arc length
    const rowCounts: number[] = [];
    let remaining = seats.length;
    let weightSum = 0;
    const weights: number[] = [];
    for (let r = 0; r < rows; r++) {
      const t = r / rowDenom;
      const w = innerR + (outerR - innerR) * t;
      weights.push(w);
      weightSum += w;
    }
    for (let r = 0; r < rows; r++) {
      const count =
        r === rows - 1
          ? remaining
          : Math.max(1, Math.round((weights[r] / weightSum) * seats.length));
      rowCounts.push(Math.min(count, remaining));
      remaining -= rowCounts[r];
    }
    while (remaining > 0) {
      rowCounts[rows - 1] += 1;
      remaining -= 1;
    }

    const g = svg.append("g");

    let seatIdx = 0;
    for (let r = 0; r < rows; r++) {
      const t = r / rowDenom;
      const radius = innerR + (outerR - innerR) * t;
      const count = rowCounts[r];
      for (let i = 0; i < count; i++) {
        if (seatIdx >= seats.length) break;
        const angle = Math.PI - (i / Math.max(1, count - 1)) * Math.PI;
        const x = cx + radius * Math.cos(angle);
        const y = cy - radius * Math.sin(angle);
        g.append("circle")
          .attr("cx", x)
          .attr("cy", y)
          .attr("r", seatRadius)
          .attr("fill", seats[seatIdx].color)
          .attr("opacity", 0)
          .transition()
          .delay((seatIdx % 40) * 4)
          .duration(400)
          .attr("opacity", 0.92);
        seatIdx += 1;
      }
    }

    svg
      .append("text")
      .attr("x", cx)
      .attr("y", cy - 8)
      .attr("text-anchor", "middle")
      .attr("fill", "#8fa898")
      .attr("font-size", 11)
      .attr("letter-spacing", "0.12em")
      .text(`${total} SANDALYE`);
  }, [parties, width, height]);

  return (
    <svg
      ref={ref}
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Meclis koltuk dağılımı"
    />
  );
}
