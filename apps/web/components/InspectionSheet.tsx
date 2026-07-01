"use client";
import { useState } from "react";
import { api, type Asset, type Inspection, type InspectionRating } from "@/lib/api";
import { Sheet } from "./Sheet";

const RATINGS: InspectionRating[] = ["good", "fair", "poor"];

export function InspectionSheet({
  householdId, assets, onClose, onSaved,
}: {
  householdId: string;
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [assetId, setAssetId] = useState("");
  const [inspectedOn, setDate] = useState("");
  const [rating, setRating] = useState<InspectionRating>("good");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.createInspection(householdId, {
        assetId: assetId || null, inspectedOn, rating, notes: notes.trim() || null,
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title="Log an inspection" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row2">
          <div className="field">
            <label>Asset</label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">— none —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={inspectedOn} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Condition</label>
          <select value={rating} onChange={(e) => setRating(e.target.value as InspectionRating)}>
            {RATINGS.map((r) => <option key={r} value={r} style={{ textTransform: "capitalize" }}>{r}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you find?" />
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
