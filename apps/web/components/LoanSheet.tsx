"use client";
import { useState } from "react";
import { api, type Asset, type Loan } from "@/lib/api";
import { Sheet } from "./Sheet";

export function LoanSheet({
  householdId, existing, assets, onClose, onSaved,
}: {
  householdId: string;
  existing?: Loan | null;
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [outstanding, setOutstanding] = useState(existing ? String(existing.outstanding) : "");
  const [emiMonthly, setEmi] = useState(existing ? String(existing.emiMonthly) : "");
  const [ratePct, setRate] = useState(existing?.ratePct != null ? String(existing.ratePct) : "");
  const [securedAssetId, setSecured] = useState(existing?.securedAssetId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Loans typically secure real estate; offer those first but allow any asset.
  const securable = [...assets].sort((a, b) =>
    (a.assetClass === "real_estate" ? 0 : 1) - (b.assetClass === "real_estate" ? 0 : 1)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Partial<Loan> = {
      name: name.trim(),
      outstanding: Number(outstanding),
      emiMonthly: Number(emiMonthly),
      ratePct: ratePct ? Number(ratePct) : null,
      securedAssetId: securedAssetId || null,
    };
    try {
      if (existing) await api.updateLoan(existing.id, body);
      else await api.createLoan(householdId, body);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit loan" : "Add a loan"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home loan" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Outstanding (₹)</label>
            <input inputMode="numeric" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} placeholder="5800000" />
          </div>
          <div className="field">
            <label>Monthly EMI (₹)</label>
            <input inputMode="numeric" value={emiMonthly} onChange={(e) => setEmi(e.target.value)} placeholder="52000" />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Interest rate (%)</label>
            <input inputMode="decimal" value={ratePct} onChange={(e) => setRate(e.target.value)} placeholder="8.6" />
          </div>
          <div className="field">
            <label>Secured against</label>
            <select value={securedAssetId} onChange={(e) => setSecured(e.target.value)}>
              <option value="">Unsecured</option>
              {securable.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <div className="hint">Links the loan to an asset for LTV</div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
