"use client";
import { useState } from "react";
import { api, type Member } from "@/lib/api";
import { Sheet } from "./Sheet";

export function MemberSheet({
  householdId, existing, onClose, onSaved,
}: {
  householdId: string;
  existing?: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [income, setIncome] = useState(existing?.monthlyIncome != null ? String(existing.monthlyIncome) : "");
  const [essential, setEssential] = useState(existing?.monthlyEssential != null ? String(existing.monthlyEssential) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = {
      name: name.trim(),
      monthlyIncome: income ? Number(income) : null,
      monthlyEssential: essential ? Number(essential) : null,
    };
    try {
      if (existing) await api.updateMember(existing.id, body);
      else await api.createMember(householdId, { name: body.name, monthlyIncome: body.monthlyIncome ?? undefined, monthlyEssential: body.monthlyEssential ?? undefined });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save"); setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit member" : "Add a family member"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Monthly income (₹)</label>
            <input inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="100000" />
            <div className="hint">Their take-home; adds to the household total</div>
          </div>
          <div className="field">
            <label>Monthly essentials (₹)</label>
            <input inputMode="numeric" value={essential} onChange={(e) => setEssential(e.target.value)} placeholder="optional" />
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
