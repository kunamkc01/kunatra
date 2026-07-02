"use client";
import { useState } from "react";
import { api, type Asset, type Vendor, type WorkOrder, type WorkOrderCategory, type Recurrence, type RecurrenceMode } from "@/lib/api";
import { Sheet } from "./Sheet";

const RECUR: { value: Recurrence; label: string }[] = [
  { value: "none", label: "One-off" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const CATEGORIES: { value: WorkOrderCategory; label: string }[] = [
  { value: "repair", label: "Repair" },
  { value: "maintenance", label: "Maintenance" },
  { value: "amc", label: "AMC" },
  { value: "improvement", label: "Improvement" },
  { value: "other", label: "Other" },
];

export function WorkOrderSheet({
  householdId, existing, assets, vendors, onClose, onSaved,
}: {
  householdId: string;
  existing?: WorkOrder | null;
  assets: Asset[];
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [category, setCategory] = useState<WorkOrderCategory>(existing?.category ?? "repair");
  const [assetId, setAssetId] = useState(existing?.assetId ?? "");
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? "");
  const [scheduledFor, setScheduledFor] = useState(existing?.scheduledFor ?? "");
  const [estimatedCost, setEst] = useState(existing?.estimatedCost != null ? String(existing.estimatedCost) : "");
  const [actualCost, setActual] = useState(existing?.actualCost != null ? String(existing.actualCost) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? "none");
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>(existing?.recurrenceMode ?? "fixed");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Partial<WorkOrder> = {
      title: title.trim(),
      category,
      assetId: assetId || null,
      vendorId: vendorId || null,
      scheduledFor: scheduledFor || null,
      estimatedCost: estimatedCost ? Number(estimatedCost) : null,
      actualCost: actualCost ? Number(actualCost) : null,
      notes: notes.trim() || null,
      recurrence,
      recurrenceMode,
    };
    try {
      if (existing) await api.updateWorkOrder(existing.id, body);
      else await api.createWorkOrder(householdId, body);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit work order" : "New work order"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>What needs doing?</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix kitchen tap leak" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as WorkOrderCategory)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
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
        <div className="row2">
          <div className="field">
            <label>Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">— none —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Scheduled for</label>
            <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Estimated cost (₹)</label>
            <input inputMode="numeric" value={estimatedCost} onChange={(e) => setEst(e.target.value)} placeholder="3000" />
          </div>
          <div className="field">
            <label>Actual cost (₹)</label>
            <input inputMode="numeric" value={actualCost} onChange={(e) => setActual(e.target.value)} placeholder="on completion" />
            <div className="hint">Required to mark done</div>
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Repeats</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
              {RECUR.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {recurrence !== "none" && (
            <div className="field">
              <label>Recur by</label>
              <select value={recurrenceMode} onChange={(e) => setRecurrenceMode(e.target.value as RecurrenceMode)}>
                <option value="fixed">Fixed date each period</option>
                <option value="on_completion">After the last is completed</option>
              </select>
              <div className="hint">{recurrenceMode === "fixed" ? "Generated on the calendar, whether or not the last is done" : "A fresh one appears only when you complete the current"}</div>
            </div>
          )}
        </div>
        <div className="row2">
          <div className="field">
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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
