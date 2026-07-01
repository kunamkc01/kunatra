"use client";
import { useState } from "react";
import { api, type Vendor } from "@/lib/api";
import { Sheet } from "./Sheet";

export function VendorSheet({
  householdId, existing, onClose, onSaved,
}: {
  householdId: string;
  existing?: Vendor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Partial<Vendor> = {
      name: name.trim(), category: category.trim() || null, phone: phone.trim() || null, notes: notes.trim() || null,
    };
    try {
      if (existing) await api.updateVendor(existing.id, body);
      else await api.createVendor(householdId, body);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit vendor" : "Add a vendor"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Plumbing" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="plumber, electrician, AMC…" />
          </div>
          <div className="field">
            <label>Phone</label>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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
