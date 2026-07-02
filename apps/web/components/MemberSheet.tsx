"use client";
import { useState } from "react";
import { api, type Member } from "@/lib/api";
import { inr } from "@/lib/format";
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
  const [gross, setGross] = useState(existing?.monthlyGross != null ? String(existing.monthlyGross) : "");
  const [tds, setTds] = useState(existing?.monthlyTds != null ? String(existing.monthlyTds) : "");
  const [expenses, setExpenses] = useState(existing?.monthlyExpenses != null ? String(existing.monthlyExpenses) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const net = gross ? Number(gross) - (tds ? Number(tds) : 0) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = { name: name.trim(), monthlyGross: gross ? Number(gross) : null, monthlyTds: tds ? Number(tds) : null, monthlyExpenses: expenses ? Number(expenses) : null };
    try {
      if (existing) await api.updateMember(existing.id, body);
      else await api.createMember(householdId, { name: body.name, monthlyGross: body.monthlyGross ?? undefined, monthlyTds: body.monthlyTds ?? undefined, monthlyExpenses: body.monthlyExpenses ?? undefined });
      onSaved();
    } catch (e: any) { setErr(e.message ?? "Could not save"); setBusy(false); }
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
            <label>Gross salary (₹/month)</label>
            <input inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="150000" />
          </div>
          <div className="field">
            <label>TDS (₹/month)</label>
            <input inputMode="numeric" value={tds} onChange={(e) => setTds(e.target.value)} placeholder="tax deducted" />
          </div>
        </div>
        {net != null && (
          <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>Take-home (net): <b style={{ color: "var(--ink)" }}>{inr(net)}/mo</b> — this is what adds to the household total.</div>
        )}
        <div className="field">
          <label>Personal expenses (₹/month)</label>
          <input inputMode="numeric" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="their own monthly spend" />
          <div className="hint">Kept per person; it adds on top of the household's shared essentials in runway &amp; surplus.</div>
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
