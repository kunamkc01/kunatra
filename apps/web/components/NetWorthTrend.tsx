"use client";
import { useEffect, useState } from "react";
import { api, type NetWorthPoint } from "@/lib/api";
import { inr } from "@/lib/format";

const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

/** Change vs n months back (nearest available point at or before that month). */
function deltaVs(points: NetWorthPoint[], monthsBack: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = new Date(`${last.month.slice(0, 10)}T00:00:00`);
  target.setMonth(target.getMonth() - monthsBack);
  const base = [...points].reverse().find((p) => new Date(`${p.month.slice(0, 10)}T00:00:00`) <= target);
  if (!base || base === last) return null;
  return last.netWorth - base.netWorth;
}

/**
 * The mirror with memory: a hand-rolled SVG line of monthly net-worth
 * snapshots. History accrues from the day snapshots began — no backfill.
 */
export function NetWorthTrend({ householdId }: { householdId: string }) {
  const [points, setPoints] = useState<NetWorthPoint[] | null>(null);

  useEffect(() => {
    api.networthHistory(householdId).then(setPoints).catch(() => setPoints(null));
  }, [householdId]);

  if (!points || points.length === 0) return null;

  if (points.length === 1) {
    return (
      <div className="hint" style={{ margin: "0 4px 14px" }}>
        Your mirror started remembering this month ({monthLabel(points[0].month)}: {inr(points[0].netWorth)}) —
        the trend line grows from here.
      </div>
    );
  }

  // ---- chart geometry ----
  const W = 720, H = 150, PAD = { l: 8, r: 8, t: 14, b: 22 };
  const vals = points.map((p) => p.netWorth);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const area = `${PAD.l},${H - PAD.b} ${line} ${x(points.length - 1).toFixed(1)},${H - PAD.b}`;
  // sparse month labels: first, last, and up to 3 in between
  const labelIdx = new Set<number>([0, points.length - 1]);
  for (let k = 1; k <= 3; k++) labelIdx.add(Math.round((k * (points.length - 1)) / 4));

  const q = deltaVs(points, 3);
  const yr = deltaVs(points, 12);
  const sinceStart = points[points.length - 1].netWorth - points[0].netWorth;
  const chip = (label: string, v: number | null) =>
    v == null ? null : (
      <span key={label} className={`pill ${v >= 0 ? "p-good" : "p-bad"}`}>
        {v >= 0 ? "↑" : "↓"} {inr(Math.abs(v))} {label}
      </span>
    );

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="sec-label" style={{ marginTop: 0, marginBottom: 4 }}>
        Net worth over time
        <span style={{ display: "flex", gap: 6 }}>
          {chip("this quarter", q)}
          {chip("this year", yr) ?? chip(`since ${monthLabel(points[0].month)}`, sinceStart)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Net worth trend">
        <polygon points={area} fill="var(--accent-bg)" />
        <polyline points={line} fill="none" stroke="var(--navy)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p.netWorth)} r={i === points.length - 1 ? 4 : 2.6} fill="var(--navy)" />
            {labelIdx.has(i) && (
              <text x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                fontSize="10.5" fill="var(--muted)">{monthLabel(p.month)}</text>
            )}
          </g>
        ))}
        <text x={x(points.length - 1)} y={y(points[points.length - 1].netWorth) - 8} textAnchor="end"
          fontSize="11.5" fontWeight="600" fill="var(--ink)">{inr(points[points.length - 1].netWorth)}</text>
      </svg>
    </div>
  );
}
