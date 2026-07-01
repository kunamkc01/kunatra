"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Assessment } from "@atlas/engine";
import { api, currentHouseholdId, type Household } from "@/lib/api";
import { inr, sevClass } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { Onboarding } from "@/components/Onboarding";

export default function Dashboard() {
  const [ready, setReady] = useState(false);
  const [hhId, setHhId] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [hh, a] = await Promise.all([api.getHousehold(id), api.assessment(id)]);
      setHousehold(hh);
      setAssessment(a);
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
    <main className="app">
      <TopBar right={<Link href="/manage" className="navlink">Manage →</Link>} />

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
          {assessment!.signals.map((s) => (
            <div className={`card ${sevClass(s.severity)}`} key={s.key}>
              <span className="dot" />
              <div className="body">
                <div className="top">
                  <span className="label">{s.label}</span>
                  <span className="val">{s.display}</span>
                </div>
                <div className="msg">{s.message}</div>
              </div>
            </div>
          ))}

          <div className="sec">
            What you own
            <Link href="/manage" className="navlink">Edit</Link>
          </div>
          {nw!.allocation.map((a) => (
            <div className="card" key={a.assetClass}>
              <div className="body">
                <div className="top">
                  <span className="label">{allocLabel(a.assetClass)}</span>
                  <span className="val" style={{ color: "var(--ink)" }}>{inr(a.value)}</span>
                </div>
                <div className="sub">{a.pct.toFixed(0)}% of everything you own</div>
              </div>
            </div>
          ))}
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

function allocLabel(c: string): string {
  const m: Record<string, string> = {
    real_estate: "Real estate", mutual_fund: "Mutual funds", sip: "SIPs", equity: "Equity",
    epf: "EPF", ppf: "PPF", cash: "Cash & savings", gold: "Gold", insurance: "Insurance", other: "Other",
  };
  return m[c] ?? c;
}
