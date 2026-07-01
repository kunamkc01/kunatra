"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Assessment, Signal } from "@atlas/engine";
import { api, type Household, type Asset, type Loan, type OperationsSummary } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr, assetClassLabel } from "@/lib/format";
import { Shell } from "@/components/Shell";

const ALLOC_COLORS = ["var(--navy)", "var(--accent)", "var(--good)", "var(--seal)", "var(--warn)", "var(--muted)", "var(--bad)"];
const tileClass = (sev?: string) => (sev === "good" ? "g" : sev === "watch" ? "w" : sev === "warning" ? "b" : "");
const stripClass = (sev?: string) => (sev === "good" ? "good" : sev === "watch" ? "warn" : "bad");

export default function Portfolio() {
  const { user, ready } = useAuth({ requireRole: "owner" });
  const [household, setHousehold] = useState<Household | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [hh, a, list, ln, o] = await Promise.all([
        api.getHousehold(id), api.assessment(id), api.listAssets(id), api.listLoans(id), api.operationsSummary(id),
      ]);
      setHousehold(hh); setAssessment(a); setAssets(list); setLoans(ln); setOps(o);
    } catch (e: any) {
      setErr(e.message ?? "Could not load your data");
    }
  }, []);

  useEffect(() => {
    if (ready && user) load(user.householdId);
  }, [ready, user, load]);

  if (!ready) return <Shell><div /></Shell>;

  const nw = assessment?.netWorth;
  const ex = assessment?.exposure;
  const signals = assessment?.signals ?? [];
  const hasData = nw && (nw.grossAssets > 0 || nw.totalDebt > 0);
  const byKey = (k: string) => signals.find((s) => s.key === k);
  const warnings = signals.filter((s) => s.severity === "warning").length;
  const watches = signals.filter((s) => s.severity === "watch").length;
  const status = warnings > 0
    ? { text: `${warnings} need${warnings === 1 ? "s" : ""} attention`, color: "var(--bad)" }
    : watches > 0
      ? { text: `${watches} to watch`, color: "var(--warn)" }
      : { text: "Looking healthy", color: "var(--good)" };

  // The headline descriptive signal (most severe) — the overextension "mirror".
  const lead: Signal | undefined =
    signals.find((s) => s.severity === "warning") ?? signals.find((s) => s.severity === "watch") ?? signals[0];

  const loanFor = (assetId: string) => loans.find((l) => l.securedAssetId === assetId);

  return (
    <Shell office={household?.displayName}>
      <div className="scr-head">
        <div>
          <div className="label">Net worth</div>
          <div className="big num">{nw ? inr(nw.netWorth) : "₹—"}</div>
        </div>
        {hasData && (
          <div style={{ textAlign: "right" }}>
            <div className="label">Where you stand</div>
            <div style={{ fontSize: 13.5, color: status.color, marginTop: 4, fontWeight: 500 }}>{status.text}</div>
          </div>
        )}
      </div>

      {err && <div className="strip bad">{err}</div>}

      {!err && !hasData && (
        <div className="explain">
          Nothing here yet. <Link href="/manage" style={{ color: "var(--accent)", fontWeight: 600 }}>Add your assets and loans</Link> to see where you stand.
        </div>
      )}

      {hasData && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>Exposure</div>
          <div className="tiles" style={{ marginBottom: 14 }}>
            <div className="tile"><div className="tl">Gross assets</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(nw!.grossAssets)}</div></div>
            <div className="tile b"><div className="tl">Total debt</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(nw!.totalDebt)}</div></div>
            {ex?.realEstateLTV != null && (
              <div className={`tile ${tileClass(byKey("ltv")?.severity)}`}><div className="tl">Real-estate LTV</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{ex.realEstateLTV.toFixed(0)}%</div></div>
            )}
            {ex?.emiToIncome != null ? (
              <div className={`tile ${tileClass(byKey("emi")?.severity)}`}><div className="tl">EMI vs income</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{ex.emiToIncome.toFixed(0)}%</div></div>
            ) : ex?.runwayMonths != null ? (
              <div className={`tile ${tileClass(byKey("runway")?.severity)}`}><div className="tl">Emergency runway</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{ex.runwayMonths.toFixed(1)} mo</div></div>
            ) : null}
          </div>

          {/* Allocation */}
          <div className="bar">
            {nw!.allocation.map((a, i) => (
              <i key={a.assetClass} style={{ width: `${a.pct}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
            ))}
          </div>
          <div className="legend">
            {nw!.allocation.map((a, i) => (
              <span key={a.assetClass}>
                <span className="sw" style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                {assetClassLabel(a.assetClass)} · {inr(a.value)}
              </span>
            ))}
          </div>

          {/* Holdings — assets netted against the loans secured on them */}
          <div className="scroll" style={{ marginTop: 18 }}>
            <table>
              <thead><tr><th style={{ width: "38%" }}>Holding</th><th>Type</th><th>Value</th><th>Loan against it</th></tr></thead>
              <tbody>
                {assets.map((a) => {
                  const ln = loanFor(a.id);
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.name}</td>
                      <td className="muted">{assetClassLabel(a.assetClass)}</td>
                      <td className="tnum">{inr(a.value)}</td>
                      <td className="tnum" style={{ color: ln ? "var(--bad)" : "var(--muted)" }}>{ln ? `−${inr(ln.outstanding)}` : "—"}</td>
                    </tr>
                  );
                })}
                {loans.filter((l) => !l.securedAssetId).map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 500 }}>{l.name} <span className="muted" style={{ fontSize: 11 }}>(unsecured)</span></td>
                    <td className="muted">Loan</td>
                    <td className="tnum muted">—</td>
                    <td className="tnum" style={{ color: "var(--bad)" }}>−{inr(l.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Debt is secured against specific assets — see <Link href="/manage" style={{ color: "var(--accent)" }}>Assets</Link> for per-asset loan, equity and LTV.
          </div>

          {/* The descriptive overextension signal */}
          {lead && (
            <div className={`strip ${stripClass(lead.severity)}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              {lead.message}
            </div>
          )}

          {ops && ops.workOrders.active > 0 && (
            <div className="strip acc">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 6l4 4M3 21l4-1 11-11-3-3L4 17l-1 4z" /></svg>
              {ops.workOrders.active} open work order{ops.workOrders.active === 1 ? "" : "s"} · {inr(ops.maintenanceSpendYtd)} maintenance YTD — see <Link href="/operations" style={{ color: "var(--accent)", fontWeight: 600 }}>Operations</Link>.
            </div>
          )}
        </>
      )}

      <p className="explain" style={{ marginTop: 18 }}>
        Kunatra shows you your position — it doesn't tell you what to buy, sell or borrow, that's your call.
        {household ? ` Figures reflect what you've entered for ${household.displayName}.` : ""} Not financial advice.
      </p>
    </Shell>
  );
}
