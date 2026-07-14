"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FundScheme, type FundValuation } from "@/lib/api";
import { inr } from "@/lib/format";

/** Link a mutual-fund/SIP asset to its AMFI scheme so its value tracks the NAV. */
export function FundPicker({ assetId, onValued }: { assetId: string; onValued?: () => void }) {
  const [fund, setFund] = useState<FundValuation | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FundScheme[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => api.getFund(assetId).then(setFund).catch(() => setFund(null)), [assetId]);
  useEffect(() => { load(); }, [load]);

  function onQuery(v: string) {
    setQ(v); setErr(null);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.searchFunds(v.trim());
        setResults(r);
        if (r.length === 0) setErr("No matching fund — try fewer words (e.g. just the fund house + strategy).");
      } catch {
        setResults([]);
        setErr("Fund search hiccuped — give it a second and type again.");
      } finally { setSearching(false); }
    }, 350);
  }

  async function pick(s: FundScheme) {
    setBusy(true); setErr(null);
    try {
      const v = await api.setFund(assetId, { schemeCode: String(s.schemeCode), schemeName: s.schemeName });
      setFund(v); setQ(""); setResults([]); onValued?.();
    } catch (e: any) { setErr(e.message ?? "Could not link the fund"); }
    finally { setBusy(false); }
  }
  async function refresh() { setBusy(true); try { setFund(await api.refreshFund(assetId)); onValued?.(); } finally { setBusy(false); } }
  async function unlink() {
    if (!confirm("Unlink this fund? Its value will stop tracking the NAV (you can set it by hand again).")) return;
    await api.unlinkFund(assetId); setFund(null); onValued?.();
  }

  if (fund === undefined) return null;

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Track the actual fund (auto-value from NAV)</div>
      {fund ? (
        <div className="panel">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{fund.schemeName ?? "Linked fund"}</div>
          <div className="num" style={{ fontSize: 22, marginTop: 2 }}>{inr(fund.currentValue)}</div>
          <div className="meta" style={{ marginTop: 3 }}>
            {fund.units.toLocaleString("en-IN")} units × NAV {fund.latestNav} {fund.latestNavDate ? `(${fund.latestNavDate})` : ""}
            {fund.invested > 0 && <> · invested {inr(fund.invested)} · <b style={{ color: fund.currentValue >= fund.invested ? "var(--good)" : "var(--bad)" }}>{fund.currentValue >= fund.invested ? "+" : "−"}{inr(Math.abs(fund.currentValue - fund.invested))}</b></>}
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn ghost small" type="button" onClick={refresh} disabled={busy}>Refresh NAV</button>
            <button className="btn ghost small danger" type="button" onClick={unlink}>Unlink</button>
          </div>
        </div>
      ) : (
        <>
          <p className="hint" style={{ margin: "0 0 8px" }}>Search your fund and pick the exact plan (Direct/Regular · Growth/IDCW). We compute the value from your investment dates × today&apos;s NAV — and keep it current.</p>
          <input value={q} onChange={(e) => onQuery(e.target.value)} placeholder="e.g. Parag Parikh Flexi Cap" />
          {searching && <div className="hint" style={{ marginTop: 4 }}>Searching…</div>}
          {results.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
              {results.map((s) => (
                <button key={s.schemeCode} type="button" onClick={() => pick(s)} disabled={busy}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, borderBottom: "1px solid var(--line)", padding: "8px 10px", cursor: "pointer", font: "inherit", fontSize: 12.5 }}>
                  {s.schemeName}
                </button>
              ))}
            </div>
          )}
          {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
        </>
      )}
    </div>
  );
}
