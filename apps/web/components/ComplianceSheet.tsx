"use client";
import { useState } from "react";
import { api, type Asset, type ComplianceItem, type ComplianceKind, type Recurrence } from "@/lib/api";
import { Sheet } from "./Sheet";

const KINDS: { value: ComplianceKind; label: string }[] = [
  { value: "property_tax", label: "Property tax" },
  { value: "insurance", label: "Insurance" },
  { value: "amc", label: "AMC" },
  { value: "inspection", label: "Inspection" },
  { value: "renewal", label: "Renewal" },
  { value: "other", label: "Other" },
];
const RECUR: { value: Recurrence; label: string }[] = [
  { value: "none", label: "One-off" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function ComplianceSheet({
  householdId, assets, onClose, onSaved,
}: {
  householdId: string;
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ComplianceKind>("property_tax");
  const [dueOn, setDueOn] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("yearly");
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createCompliance(householdId, { title: title.trim(), kind, dueOn, recurrence, assetId: assetId || null } as Partial<ComplianceItem>);
      onSaved();
    } catch (e: any) { setErr(e.message ?? "Could not save"); setBusy(false); }
  }

  return (
    <Sheet title="Add a due date" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>What's due?</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Property tax — Q2" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ComplianceKind)}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Due on</label>
            <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Repeats</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              {RECUR.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Asset</label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— none —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy || !title || !dueOn}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
