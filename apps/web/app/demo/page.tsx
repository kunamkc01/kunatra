"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Assessment } from "@atlas/engine";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";

const tileClass = (sev?: string) => (sev === "good" ? "g" : sev === "watch" ? "w" : sev === "warning" ? "b" : "");

/**
 * The public sample mirror — a real assessment of the bundled demo persona,
 * shown BEFORE signup so people see the payoff first. Read-only, no auth.
 */
export default function Demo() {
  const [a, setA] = useState<Assessment | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => { api.demoAssessment().then(setA).catch(() => setErr(true)); }, []);

  const nw = a?.netWorth;
  const ex = a?.exposure;
  const inc = a?.income;
  const signals = a?.signals ?? [];
  const surplus = signals.find((s) => s.key === "surplus");
  const flagged = signals.filter((s) => s.severity !== "good").slice(0, 3);

  return (
    <div className="app" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="topbar">
        <div className="brand">
          <Link href="/login" className="mark">K</Link>
          <Link href="/login" className="wordmark">Kunatra</Link>
          <span className="office">a sample mirror</span>
        </div>
        <Link href="/login" className="btn primary" style={{ textDecoration: "none" }}>Create your own →</Link>
      </div>

      <div className="content">
        <div className="strip warn" style={{ marginBottom: 18 }}>
          <span>This is <b>Priya</b>, a sample salaried professional — real math, made-up person. Your mirror looks like this with your own numbers.</span>
        </div>

        {err && <div className="strip bad">The sample is unavailable right now — you can still <Link href="/login" style={{ fontWeight: 600 }}>create an account</Link>.</div>}

        {a && (
          <>
            <div className="scr-head">
              <div>
                <div className="label">Net worth</div>
                <div className="big num">{nw ? inr(nw.netWorth) : "₹—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="label">Where she stands</div>
                <div style={{ fontSize: 13.5, color: flagged.length ? "var(--warn)" : "var(--good)", marginTop: 4, fontWeight: 500 }}>
                  {flagged.length ? `${flagged.length} to keep an eye on` : "Looking steady"}
                </div>
              </div>
            </div>

            <div className="tiles" style={{ marginBottom: 16 }}>
              <div className="tile"><div className="tv num" style={{ fontSize: 22 }}>{nw ? inr(nw.grossAssets) : "—"}</div><div className="tl">Everything she owns</div></div>
              <div className="tile b"><div className="tv num" style={{ fontSize: 22 }}>{nw ? inr(nw.totalDebt) : "—"}</div><div className="tl">What she owes</div></div>
              {inc && <div className="tile acc"><div className="tv num" style={{ fontSize: 22 }}>{inr(inc.total)}<span style={{ fontSize: 12, color: "var(--muted)" }}>/mo</span></div><div className="tl">Monthly income</div></div>}
              {surplus && <div className={`tile ${tileClass(surplus.severity)}`}><div className="tv num" style={{ fontSize: 22 }}>{surplus.display}</div><div className="tl">Monthly surplus</div></div>}
            </div>

            <div className="sec-label">The signals — plain statements, never advice</div>
            {signals.slice(0, 5).map((s) => (
              <div key={s.key} className={`strip ${s.severity === "good" ? "good" : s.severity === "watch" ? "warn" : "bad"}`} style={{ marginBottom: 8 }}>
                <span><b>{s.label}: {s.display}.</b> {s.message}</span>
              </div>
            ))}

            {ex && (
              <>
                <div className="sec-label">Exposure</div>
                <div className="tiles" style={{ marginBottom: 18 }}>
                  {ex.emiToIncome != null && <div className="tile"><div className="tv num" style={{ fontSize: 22 }}>{ex.emiToIncome.toFixed(0)}%</div><div className="tl">EMI vs income</div></div>}
                  {ex.realEstateLTV != null && <div className="tile"><div className="tv num" style={{ fontSize: 22 }}>{ex.realEstateLTV.toFixed(0)}%</div><div className="tl">Property LTV</div></div>}
                  {ex.runwayMonths != null && <div className="tile"><div className="tv num" style={{ fontSize: 22 }}>{ex.runwayMonths.toFixed(1)} mo</div><div className="tl">Emergency runway</div></div>}
                </div>
              </>
            )}
          </>
        )}

        <div className="panel" style={{ textAlign: "center", marginTop: 10 }}>
          <h3 style={{ marginBottom: 6 }}>Your numbers deserve the same honesty.</h3>
          <p className="desc" style={{ margin: "0 0 14px" }}>Three fields to sign up, one asset to see your first picture — and free AI value estimates for your properties.</p>
          <Link href="/login" className="btn primary" style={{ textDecoration: "none" }}>Create your account</Link>
        </div>

        <p className="foot" style={{ textAlign: "center", marginTop: 16 }}>A mirror, not an advisor. Not financial advice.</p>
      </div>
    </div>
  );
}
