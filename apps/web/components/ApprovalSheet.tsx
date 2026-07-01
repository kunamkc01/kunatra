"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Sheet } from "./Sheet";

export function ApprovalSheet({
  householdId, onClose, onSaved,
}: {
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createApproval(householdId, { title: title.trim(), amount: amount ? Number(amount) : undefined, note: note.trim() || undefined });
      onSaved();
    } catch (e: any) { setErr(e.message ?? "Could not raise"); setBusy(false); }
  }

  return (
    <Sheet title="Raise a request" onClose={onClose}>
      <p className="desc">Propose a spend or change for the owner to approve. Nothing happens until they do.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label>What are you proposing?</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Replace water pump" autoFocus />
        </div>
        <div className="field">
          <label>Amount (₹, optional)</label>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="18000" />
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vendor quote, context…" />
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy || !title}>{busy ? "Sending…" : "Send for approval"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
