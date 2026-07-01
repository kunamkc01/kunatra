"use client";
import { useState } from "react";
import { api, setCurrentHouseholdId } from "@/lib/api";

/** First-run: create a household with the net-worth inputs, then land on the mirror. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [displayName, setName] = useState("");
  const [takeHome, setTakeHome] = useState("");
  const [essential, setEssential] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const hh = await api.createHousehold({
        displayName: displayName.trim() || "My household",
        monthlyTakeHome: takeHome ? Number(takeHome) : undefined,
        monthlyEssential: essential ? Number(essential) : undefined,
      });
      setCurrentHouseholdId(hh.id);
      onDone();
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Set up your mirror</h3>
      <p className="desc">
        Kunatra shows you where you stand — net worth and whether you're overextended.
        Start with a name and your monthly cash flow; you'll add assets and loans next.
      </p>
      <form onSubmit={submit}>
        <div className="field">
          <label>What should we call this?</label>
          <input value={displayName} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya's finances" />
        </div>
        <div className="row2">
          <div className="field">
            <label>Monthly take-home (₹)</label>
            <input inputMode="numeric" value={takeHome} onChange={(e) => setTakeHome(e.target.value)} placeholder="140000" />
          </div>
          <div className="field">
            <label>Monthly essentials (₹)</label>
            <input inputMode="numeric" value={essential} onChange={(e) => setEssential(e.target.value)} placeholder="50000" />
            <div className="hint">Rent/spend excluding EMIs</div>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create & continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
