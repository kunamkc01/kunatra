"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, currentHouseholdId, type Asset, type Loan, type Household } from "@/lib/api";
import { inr, assetClassLabel } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { AssetSheet } from "@/components/AssetSheet";
import { LoanSheet } from "@/components/LoanSheet";

export default function Manage() {
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
  const closeAsset = () => setAssetSheet({ open: false });
  const closeLoan = () => setLoanSheet({ open: false });

  async function removeAsset(a: Asset) {
    if (!confirm(`Delete "${a.name}"? Any loan secured against it becomes unsecured.`)) return;
    await api.deleteAsset(a.id); refresh();
  }
  async function removeLoan(l: Loan) {
    if (!confirm(`Delete "${l.name}"?`)) return;
    await api.deleteLoan(l.id); refresh();
  }

  const gross = assets.reduce((s, a) => s + a.value, 0);
  const debt = loans.reduce((s, l) => s + l.outstanding, 0);
  const assetName = (id: string | null) => assets.find((a) => a.id === id)?.name;

  if (!ready) return <main className="app" />;
  if (!hhId) {
    return (
      <main className="app">
        <TopBar />
        <div className="empty">No household yet. <Link href="/" className="navlink">Set one up →</Link></div>
      </main>
    );
  }

  return (
    <main className="app">
      <TopBar right={<Link href="/" className="navlink">← Mirror</Link>} />

      <div className="hero" style={{ padding: "18px 22px" }}>
        <div className="lbl">Net worth so far</div>
        <div className="nw" style={{ fontSize: 34, margin: "2px 0 10px" }}>{inr(gross - debt)}</div>
        <div className="row">
          <div>Assets<b>{inr(gross)}</b></div>
          <div>Debt<b className="debt">{inr(debt)}</b></div>
        </div>
      </div>

      {err && <div className="err" style={{ padding: "0 4px" }}>{err}</div>}

      {/* Cash flow */}
      <CashflowPanel household={household} onSaved={refresh} />

      {/* Assets */}
      <div className="sec">
        What you own
        <button className="btn small primary" onClick={() => setAssetSheet({ open: true, edit: null })}>+ Add asset</button>
      </div>
      {assets.length === 0 && <div className="empty">No assets yet — add your home, funds, savings…</div>}
      {assets.map((a) => (
        <div className="card" key={a.id}>
          <div className="body">
            <div className="top">
              <span className="label">{a.name}</span>
              <span className="val" style={{ color: "var(--ink)" }}>{inr(a.value)}</span>
            </div>
            <div className="sub">
              {assetClassLabel(a.assetClass)}
              {a.liquid ? " · liquid" : ""}
              {a.realEstate?.address ? ` · ${a.realEstate.address}` : ""}
            </div>
          </div>
          <button className="btn ghost small" onClick={() => setAssetSheet({ open: true, edit: a })}>Edit</button>
          <button className="btn ghost small danger" onClick={() => removeAsset(a)}>Delete</button>
        </div>
      ))}

      {/* Loans */}
      <div className="sec">
        What you owe
        <button className="btn small primary" onClick={() => setLoanSheet({ open: true, edit: null })}>+ Add loan</button>
      </div>
      {loans.length === 0 && <div className="empty">No loans — good news, or add one to see your leverage.</div>}
      {loans.map((l) => (
        <div className="card" key={l.id}>
          <div className="body">
            <div className="top">
              <span className="label">{l.name}</span>
              <span className="val" style={{ color: "var(--warn)" }}>{inr(l.outstanding)}</span>
            </div>
            <div className="sub">
              EMI {inr(l.emiMonthly)}/mo{l.ratePct != null ? ` · ${l.ratePct}%` : ""}
              {l.securedAssetId ? ` · against ${assetName(l.securedAssetId) ?? "an asset"}` : " · unsecured"}
            </div>
          </div>
          <button className="btn ghost small" onClick={() => setLoanSheet({ open: true, edit: l })}>Edit</button>
          <button className="btn ghost small danger" onClick={() => removeLoan(l)}>Delete</button>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <Link href="/" className="btn">See where you stand →</Link>
      </div>

      {assetSheet.open && hhId && (
        <AssetSheet householdId={hhId} existing={assetSheet.edit} onClose={closeAsset} onSaved={() => { closeAsset(); refresh(); }} />
      )}
      {loanSheet.open && hhId && (
        <LoanSheet householdId={hhId} existing={loanSheet.edit} assets={assets} onClose={closeLoan} onSaved={() => { closeLoan(); refresh(); }} />
      )}
    </main>
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
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={save} style={{ marginTop: 14 }}>
      <h3>Monthly cash flow</h3>
      <p className="desc">Drives EMI-strain and how many months your savings would last.</p>
      <div className="row2">
        <div className="field">
          <label>Take-home (₹)</label>
          <input inputMode="numeric" value={takeHome} onChange={(e) => { setTakeHome(e.target.value); setSaved(false); }} placeholder="140000" />
        </div>
        <div className="field">
          <label>Essentials (₹)</label>
          <input inputMode="numeric" value={essential} onChange={(e) => { setEssential(e.target.value); setSaved(false); }} placeholder="50000" />
        </div>
      </div>
      <div className="actions">
        <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save cash flow"}</button>
        {saved && <span style={{ color: "var(--good)", fontSize: 12.5, alignSelf: "center" }}>Saved ✓</span>}
      </div>
    </form>
  );
}
