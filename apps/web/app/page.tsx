"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Assessment } from "@atlas/engine";
import { api, currentHouseholdId, type Household, type OperationsSummary } from "@/lib/api";
import { inr, sevClass } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { Onboarding } from "@/components/Onboarding";

export default function Dashboard() {
  const [ready, setReady] = useState(false);
  const [hhId, setHhId] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [ops, setOps] = useState<OperationsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [hh, a, o] = await Promise.all([
        api.getHousehold(id),
        api.assessment(id),
        api.operationsSummary(id),
      ]);
      setHousehold(hh);
      setAssessment(a);
      setOps(o);
    } catch (e: any) {
      setErr(e.message ?? "Could not load your data");
    }
  }, []);

  useEffect(() => {
    const id = currentHouseholdId();
    setHhId(id);
    setReady(true);
    if (id) load(id);
  }, [load]);

  const onOnboarded = () => {
    const id = currentHouseholdId();
    setHhId(id);
    if (id) load(id);
  };

  if (!ready) return <main className="app" />;

  if (!hhId) {
    return (
      <main className="app">
        <TopBar />
        <Onboarding onDone={onOnboarded} />
        <p className="foot">A mirror, not an advisor. Kunatra describes your position — it never tells you what to buy, sell or borrow.</p>
      </main>
    );
  }

  const nw = assessment?.netWorth;
  const hasData = nw && (nw.grossAssets > 0 || nw.totalDebt > 0);

  return (
    <main className="app wide">
      <TopBar
        right={
          <span style={{ display: "flex", gap: 14 }}>
            <Link href="/operations" className="navlink">Upkeep</Link>
            <Link href="/manage" className="navlink">Manage →</Link>
          </span>
        }
      />

      <div className="hero">
        <div className="lbl">You're worth</div>
        <div className="nw">{nw ? inr(nw.netWorth) : "₹—"}</div>
        <div className="row">
          <div>Everything you own<b>{nw ? inr(nw.grossAssets) : "₹—"}</b></div>
          <div>What you owe<b className="debt">{nw ? inr(nw.totalDebt) : "₹—"}</b></div>
        </div>
      </div>

      {err && <div className="err" style={{ padding: "0 4px" }}>{err}</div>}

      {!err && !hasData && (
        <div className="stance" style={{ borderStyle: "solid" }}>
          Nothing here yet. <Link href="/manage" style={{ color: "var(--navy)", fontWeight: 500 }}>Add your assets and loans</Link> to see where you stand.
        </div>
      )}

      {hasData && (
        <>
          <div className="sec">Where you stand</div>
          <div className="snap-grid">
            {assessment!.signals.map((s) => (
              <div className={`snap ${sevClass(s.severity)}`} key={s.key}>
                <div className="k">{s.label}</div>
                <div className="v">{s.display}</div>
                <div className="m">{s.message}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {ops && (
        <>
          <div className="sec">
            Upkeep at a glance
            <Link href="/operations" className="navlink">Manage →</Link>
          </div>
          <div className="snap-grid">
            <div className={`snap ${ops.workOrders.active > 0 ? "w" : "g"}`}>
              <div className="k">Open work orders</div>
              <div className="v">{ops.workOrders.active}</div>
              <div className="m">
                {ops.workOrders.inProgress} in progress · {ops.workOrders.open} not started
              </div>
            </div>
            <div className="snap n">
              <div className="k">Maintenance spend (YTD)</div>
              <div className="v">{inr(ops.maintenanceSpendYtd)}</div>
              <div className="m">{ops.workOrders.done} job{ops.workOrders.done === 1 ? "" : "s"} completed</div>
            </div>
            <div className={`snap ${ops.lastInspection ? sevClass(ratingSeverity(ops.lastInspection.rating)) : "n"}`}>
              <div className="k">Last inspection</div>
              <div className="v" style={{ textTransform: "capitalize" }}>
                {ops.lastInspection ? ops.lastInspection.rating : "—"}
              </div>
              <div className="m">
                {ops.lastInspection ? `on ${ops.lastInspection.on}` : "No inspection logged yet"}
              </div>
            </div>
            <div className="snap n">
              <div className="k">Vendors</div>
              <div className="v">{ops.vendors}</div>
              <div className="m">service providers on file</div>
            </div>
          </div>
        </>
      )}

      {hasData && (
        <>
          <div className="sec">
            What you own
            <Link href="/manage" className="navlink">Edit</Link>
          </div>
          <div className="snap-grid">
            {nw!.allocation.map((a) => (
              <div className="snap n" key={a.assetClass}>
                <div className="k">{allocLabel(a.assetClass)}</div>
                <div className="v" style={{ fontSize: 18 }}>{inr(a.value)}</div>
                <div className="m">{a.pct.toFixed(0)}% of everything you own</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stance">
        Kunatra shows you your position. It doesn't tell you what to buy, sell or borrow — that's your call.
      </div>
      <p className="foot">
        {household ? `${household.displayName} · ` : ""}Figures reflect what you've entered. Not financial advice.
      </p>
    </main>
  );
}

function ratingSeverity(r: string): "good" | "watch" | "warning" {
  return r === "good" ? "good" : r === "fair" ? "watch" : "warning";
}

function allocLabel(c: string): string {
  const m: Record<string, string> = {
    real_estate: "Real estate", mutual_fund: "Mutual funds", sip: "SIPs", equity: "Equity",
    epf: "EPF", ppf: "PPF", cash: "Cash & savings", gold: "Gold", insurance: "Insurance", other: "Other",
  };
  return m[c] ?? c;
}
