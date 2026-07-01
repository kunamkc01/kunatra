"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, currentHouseholdId, type Asset, type Loan, type Household } from "@/lib/api";
import { inr, assetClassLabel } from "@/lib/format";
import { Shell } from "@/components/Shell";
import { AssetSheet } from "@/components/AssetSheet";
import { LoanSheet } from "@/components/LoanSheet";

export default function Assets() {
  const [ready, setReady] = useState(false);
  const [hhId, setHhId] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [assetSheet, setAssetSheet] = useState<{ open: boolean; edit?: Asset | null }>({ open: false });
  const [loanSheet, setLoanSheet] = useState<{ open: boolean; edit?: Loan | null }>({ open: false });

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [hh, a, l] = await Promise.all([api.getHousehold(id), api.listAssets(id), api.listLoans(id)]);
      setHousehold(hh); setAssets(a); setLoans(l);
    } catch (e: any) {
      setErr(e.message ?? "Could not load");
    }
  }, []);

  useEffect(() => {
    const id = currentHouseholdId();
    setHhId(id); setReady(true);
    if (id) load(id);
  }, [load]);

  const refresh = () => { if (hhId) load(hhId); };

  async function removeAsset(a: Asset) {
    if (!confirm(`Delete "${a.name}"? Any loan secured against it becomes unsecured.`)) return;
    await api.deleteAsset(a.id); refresh();
  }
  async function removeLoan(l: Loan) {
    if (!confirm(`Delete "${l.name}"?`)) return;
    await api.deleteLoan(l.id); refresh();
  }

  const securedFor = (assetId: string) => loans.filter((l) => l.securedAssetId === assetId).reduce((s, l) => s + l.outstanding, 0);
  const gross = assets.reduce((s, a) => s + a.value, 0);
  const totalEmi = loans.reduce((s, l) => s + l.emiMonthly, 0);
  const income = household?.monthlyTakeHome ?? null;
  const assetName = (id: string | null) => assets.find((a) => a.id === id)?.name;

  // Top-level assets vs nested components (parent_asset_id).
  const topLevel = assets.filter((a) => !a.parentAssetId);
  const childrenOf = (id: string) => assets.filter((a) => a.parentAssetId === id);

  if (!ready) return <Shell><div /></Shell>;
  if (!hhId) {
    return (
      <Shell>
        <div className="empty">No household yet. <Link href="/" style={{ color: "var(--accent)" }}>Set one up →</Link></div>
      </Shell>
    );
  }

  const renderAssetRow = (a: Asset, nested = false) => {
    const loan = securedFor(a.id);
    const equity = a.value - loan;
    const ltv = a.value > 0 && loan > 0 ? (loan / a.value) * 100 : null;
    return (
      <tr key={a.id} style={nested ? { background: "var(--tint)" } : undefined}>
        <td style={{ paddingLeft: nested ? 26 : 8 }}>
          {nested && <span className="muted">↳ </span>}
          <span style={{ fontWeight: 500 }}>{a.name}</span>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{assetClassLabel(a.assetClass)}{a.liquid ? " · liquid" : ""}{a.realEstate?.address ? ` · ${a.realEstate.address}` : ""}</div>
        </td>
        <td className="tnum">{inr(a.value)}</td>
        <td className="tnum" style={{ color: loan > 0 ? "var(--bad)" : "var(--muted)" }}>{loan > 0 ? inr(loan) : "—"}</td>
        <td className="tnum">{inr(equity)}</td>
        <td className="tnum" style={{ color: ltv != null ? (ltv >= 80 ? "var(--bad)" : ltv >= 60 ? "var(--warn)" : "var(--ink)") : "var(--muted)" }}>
          {ltv != null ? `${ltv.toFixed(0)}%` : "owned"}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button className="btn ghost small" onClick={() => setAssetSheet({ open: true, edit: a })}>Edit</button>
          <button className="btn ghost small danger" onClick={() => removeAsset(a)}>Delete</button>
        </td>
      </tr>
    );
  };

  return (
    <Shell office={household?.displayName}>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Asset register</h2>
          <div className="scr-sub">Properties at the top level · loans netted per asset</div>
        </div>
        <button className="btn primary" onClick={() => setAssetSheet({ open: true, edit: null })}>+ Add asset</button>
      </div>

      {err && <div className="strip bad">{err}</div>}

      <div className="label" style={{ marginBottom: 8 }}>Debt service</div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><div className="tl">Gross assets</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(gross)}</div></div>
        <div className="tile b"><div className="tl">Total EMI</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(totalEmi)}<span style={{ fontSize: 12, color: "var(--muted)" }}>/mo</span></div></div>
        <div className="tile"><div className="tl">EMI vs income</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{income ? `${((totalEmi / income) * 100).toFixed(0)}%` : "—"}</div></div>
      </div>

      <div className="scroll">
        <table>
          <thead><tr><th style={{ width: "34%" }}>Asset</th><th>Market value</th><th>Loan</th><th>Equity</th><th>LTV</th><th></th></tr></thead>
          <tbody>
            {topLevel.length === 0 && <tr><td colSpan={6} className="empty">No assets yet — add your home, funds, savings…</td></tr>}
            {topLevel.flatMap((a) => [renderAssetRow(a), ...childrenOf(a.id).map((c) => renderAssetRow(c, true))])}
          </tbody>
        </table>
      </div>

      {/* Loans */}
      <div className="sec-label">Loans<button className="btn small primary" onClick={() => setLoanSheet({ open: true, edit: null })}>+ Add loan</button></div>
      {loans.length === 0 && <div className="empty">No loans — or add one to see your leverage.</div>}
      {loans.map((l) => (
        <div className="row-item" key={l.id}>
          <div className="h">
            <span className="t">{l.name}</span>
            <span className="tnum" style={{ color: "var(--bad)" }}>{inr(l.outstanding)}</span>
          </div>
          <div className="meta">
            EMI {inr(l.emiMonthly)}/mo{l.ratePct != null ? ` · ${l.ratePct}%` : ""}
            {l.securedAssetId ? ` · against ${assetName(l.securedAssetId) ?? "an asset"}` : " · unsecured"}
          </div>
          <div className="acts">
            <button className="btn ghost small" onClick={() => setLoanSheet({ open: true, edit: l })}>Edit</button>
            <button className="btn ghost small danger" onClick={() => removeLoan(l)}>Delete</button>
          </div>
        </div>
      ))}

      {/* Cash flow */}
      <CashflowPanel household={household} onSaved={refresh} />

      <div className="explain">
        LTV is on current market value; equity is value minus the loan secured on that asset. Solar, lifts and UPS can be
        recorded as components of the property they serve — their cost rolls up to the parent.
      </div>

      {assetSheet.open && hhId && (
        <AssetSheet householdId={hhId} existing={assetSheet.edit} onClose={() => setAssetSheet({ open: false })} onSaved={() => { setAssetSheet({ open: false }); refresh(); }} />
      )}
      {loanSheet.open && hhId && (
        <LoanSheet householdId={hhId} existing={loanSheet.edit} assets={assets} onClose={() => setLoanSheet({ open: false })} onSaved={() => { setLoanSheet({ open: false }); refresh(); }} />
      )}
    </Shell>
  );
}

function CashflowPanel({ household, onSaved }: { household: Household | null; onSaved: () => void }) {
  const [takeHome, setTakeHome] = useState("");
  const [essential, setEssential] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTakeHome(household?.monthlyTakeHome != null ? String(household.monthlyTakeHome) : "");
    setEssential(household?.monthlyEssential != null ? String(household.monthlyEssential) : "");
  }, [household]);

  if (!household) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setSaved(false);
    try {
      await api.updateHousehold(household!.id, {
        monthlyTakeHome: takeHome ? Number(takeHome) : null,
        monthlyEssential: essential ? Number(essential) : null,
      });
      setSaved(true); onSaved();
    } finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={save} style={{ marginTop: 18 }}>
      <h3>Monthly cash flow</h3>
      <p className="desc">Drives EMI-strain and how many months your savings would last.</p>
      <div className="row2">
        <div className="field"><label>Take-home (₹)</label><input inputMode="numeric" value={takeHome} onChange={(e) => { setTakeHome(e.target.value); setSaved(false); }} placeholder="140000" /></div>
        <div className="field"><label>Essentials (₹)</label><input inputMode="numeric" value={essential} onChange={(e) => { setEssential(e.target.value); setSaved(false); }} placeholder="50000" /></div>
      </div>
      <div className="actions">
        <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save cash flow"}</button>
        {saved && <span style={{ color: "var(--good)", fontSize: 12.5 }}>Saved ✓</span>}
      </div>
    </form>
  );
}
