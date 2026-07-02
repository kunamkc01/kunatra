"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Assessment, Signal } from "@atlas/engine";
import { api, type Household, type Asset, type Loan, type OperationsSummary, type MemberAssessment, type ComplianceSummary } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr, assetClassLabel } from "@/lib/format";
import { Shell } from "@/components/Shell";

const ALLOC_COLORS = ["var(--navy)", "var(--accent)", "var(--good)", "var(--seal)", "var(--warn)", "var(--muted)", "var(--bad)"];
const tileClass = (sev?: string) => (sev === "good" ? "g" : sev === "watch" ? "w" : sev === "warning" ? "b" : "");
const stripClass = (sev?: string) => (sev === "good" ? "good" : sev === "watch" ? "warn" : "bad");

export default function Portfolio() {
  const { user, ready } = useAuth({ requireRole: ["owner", "advisor"] });
  const isOwner = user?.role === "owner";
  const [household, setHousehold] = useState<Household | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [memberViews, setMemberViews] = useState<MemberAssessment[]>([]);
  const [comp, setComp] = useState<ComplianceSummary | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string, owner: boolean) => {
    setErr(null);
    try {
      const [hh, a, list, ln, mv] = await Promise.all([
        api.getHousehold(id), api.assessment(id), api.listAssets(id), api.listLoans(id), api.memberAssessments(id),
      ]);
      setHousehold(hh); setAssessment(a); setAssets(list); setLoans(ln); setMemberViews(mv);
      // Operations / compliance / approvals are the owner's oversight view.
      if (owner) {
        const [o, c, ap] = await Promise.all([api.operationsSummary(id), api.complianceSummary(id), api.approvalsSummary(id)]);
        setOps(o); setComp(c); setPendingApprovals(ap.pending);
      }
    } catch (e: any) {
      setErr(e.message ?? "Could not load your data");
    }
  }, []);

  useEffect(() => {
    if (ready && user) load(user.householdId, user.role === "owner");
  }, [ready, user, load]);

  if (!ready) return <Shell><div /></Shell>;

  const nw = assessment?.netWorth;
  const ex = assessment?.exposure;
  const inv = assessment?.investments;
  const incomeB = assessment?.income;
  const signals = assessment?.signals ?? [];
  const hasData = nw && (nw.grossAssets > 0 || nw.totalDebt > 0);
  const byKey = (k: string) => signals.find((s) => s.key === k);
  const surplusSig = byKey("surplus");
  // Areas that aren't in the clear, worst first — named so the status says *what* to look at.
  const flagged = signals
    .filter((s) => s.severity !== "good")
    .sort((a, b) => (a.severity === "warning" ? 0 : 1) - (b.severity === "warning" ? 0 : 1));
  const hasWarning = flagged.some((s) => s.severity === "warning");
  const status = flagged.length === 0
    ? { phrase: "Looking steady", color: "var(--good)" }
    : hasWarning
      ? { phrase: `${flagged.length} to review`, color: "var(--bad)" }
      : { phrase: `${flagged.length} to keep an eye on`, color: "var(--warn)" };
  const flaggedNames = flagged.slice(0, 3).map((s) => s.label.toLowerCase()).join(", ")
    + (flagged.length > 3 ? `, +${flagged.length - 3} more` : "");

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
          <div style={{ textAlign: "right", maxWidth: 260 }}>
            <div className="label">Where you stand</div>
            <div style={{ fontSize: 13.5, color: status.color, marginTop: 4, fontWeight: 500 }}>{status.phrase}</div>
            {flagged.length > 0 && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{flaggedNames}</div>
            )}
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
            {ex?.dscr != null && (
              <div className={`tile ${tileClass(byKey("dscr")?.severity)}`}><div className="tl">Rent vs EMI (DSCR)</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{ex.dscr.toFixed(2)}×</div></div>
            )}
          </div>

          {incomeB && (incomeB.earned > 0 || incomeB.fromAssets > 0) && (
            <>
              <div className="label" style={{ margin: "18px 0 8px" }}>Monthly income <span className="muted" style={{ fontWeight: 400 }}>· salary kept separate from what your assets bring in</span></div>
              <div className="tiles" style={{ marginBottom: 14 }}>
                <div className="tile"><div className="tl">Salary (take-home)</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(incomeB.earned)}</div></div>
                {incomeB.fromAssets > 0 && (
                  <div className="tile acc"><div className="tl">From assets (rent)</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(incomeB.fromAssets)}</div></div>
                )}
                <div className="tile"><div className="tl">Total coming in</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(incomeB.total)}</div></div>
                {surplusSig && (
                  <div className={`tile ${tileClass(surplusSig.severity)}`}><div className="tl">Monthly surplus</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{surplusSig.display}</div></div>
                )}
              </div>
            </>
          )}

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

          {inv && (inv.invested > 0 || inv.monthlyContribution > 0) && (
            <>
              <div className="label" style={{ margin: "18px 0 8px" }}>Investments</div>
              <div className="tiles">
                <div className="tile"><div className="tl">Invested</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(inv.invested)}</div></div>
                <div className="tile"><div className="tl">Current value</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(inv.currentValue)}</div></div>
                <div className={`tile ${inv.unrealizedGain >= 0 ? "g" : "b"}`}>
                  <div className="tl">Unrealized gain</div>
                  <div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>
                    {inv.unrealizedGain >= 0 ? "+" : "−"}{inr(Math.abs(inv.unrealizedGain))}
                    {inv.gainPct != null ? <span style={{ fontSize: 13 }}> · {inv.gainPct >= 0 ? "+" : ""}{inv.gainPct.toFixed(0)}%</span> : null}
                  </div>
                </div>
                {inv.monthlyContribution > 0 && (
                  <div className="tile acc"><div className="tl">Monthly investing</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(inv.monthlyContribution)}<span style={{ fontSize: 12, color: "var(--muted)" }}>/mo</span></div></div>
                )}
                {inv.xirrPct != null && (
                  <div className={`tile ${inv.xirrPct >= 0 ? "g" : "b"}`}>
                    <div className="tl">Return (XIRR)</div>
                    <div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inv.xirrPct >= 0 ? "+" : ""}{inv.xirrPct.toFixed(1)}%<span style={{ fontSize: 12, color: "var(--muted)" }}>/yr</span></div>
                  </div>
                )}
              </div>
            </>
          )}

          {memberViews.length > 0 && (
            <>
              <div className="label" style={{ margin: "18px 0 8px" }}>By member</div>
              <div className="tiles">
                {memberViews.map((m) => {
                  const emi = m.assessment.exposure.emiToIncome;
                  return (
                    <div className="tile" key={m.id}>
                      <div className="tl" style={{ fontWeight: 500, color: "var(--ink)" }}>{m.name}</div>
                      <div className="tv num" style={{ fontSize: 19, marginTop: 6 }}>{inr(m.assessment.netWorth.netWorth)}</div>
                      <div className="tl" style={{ marginTop: 4 }}>
                        {m.monthlyIncome != null ? `${inr(m.monthlyIncome)}/mo income` : "no income set"}
                        {emi != null ? ` · EMI ${emi.toFixed(0)}%` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

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

          {isOwner && pendingApprovals > 0 && (
            <div className="strip warn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              {pendingApprovals} request{pendingApprovals === 1 ? "" : "s"} awaiting your approval — see <Link href="/operations" style={{ color: "var(--accent)", fontWeight: 600 }}>Operations → Requests</Link>.
            </div>
          )}

          {comp && (comp.overdue > 0 || comp.dueSoon > 0) && (
            <div className={`strip ${comp.overdue > 0 ? "bad" : "warn"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
              {comp.overdue > 0 ? `${comp.overdue} compliance item${comp.overdue === 1 ? "" : "s"} overdue` : `${comp.dueSoon} due within 30 days`}
              {comp.next ? ` · next: ${comp.next.title} (${comp.next.dueOn})` : ""} — see <Link href="/operations" style={{ color: "var(--accent)", fontWeight: 600 }}>Operations</Link>.
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
