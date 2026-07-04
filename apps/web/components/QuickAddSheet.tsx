"use client";
import { useState } from "react";
import { api, type AssetClass } from "@/lib/api";
import { Sheet } from "./Sheet";

const CLASSES: { value: AssetClass; label: string }[] = [
  { value: "real_estate", label: "Property" },
  { value: "mutual_fund", label: "Mutual fund" },
  { value: "sip", label: "SIP" },
  { value: "equity", label: "Equity" },
  { value: "epf", label: "EPF" },
  { value: "ppf", label: "PPF" },
  { value: "nps", label: "NPS" },
  { value: "fd", label: "FD" },
  { value: "rd", label: "RD" },
  { value: "bonds", label: "Bonds" },
  { value: "gold", label: "Gold" },
  { value: "cash", label: "Cash" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

interface Row { name: string; assetClass: AssetClass; value: string; }
const blank = (): Row => ({ name: "", assetClass: "real_estate", value: "" });

/**
 * Load a whole portfolio fast: name, class, value — one line per asset.
 * Refinement (locality, rent, acquisition story) comes later via the register's
 * chips and each asset's page.
 */
export function QuickAddSheet({ householdId, onClose, onSaved }: {
  householdId: string; onClose: () => void; onSaved: (count: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>([blank(), blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upd = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = rows.filter((r) => r.name.trim() && r.value !== "" && Number(r.value) >= 0);
    if (filled.length === 0) { setErr("Fill at least one row (name and value)."); return; }
    setBusy(true); setErr(null);
    let done = 0;
    try {
      for (const r of filled) {
        await api.createAsset(householdId, { name: r.name.trim(), assetClass: r.assetClass, value: Number(r.value) });
        done++;
      }
      onSaved(done);
    } catch (e: any) {
      setErr(`${e.message ?? "Could not save"}${done ? ` — ${done} added before the error` : ""}`);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Quick add" onClose={onClose}>
      <p className="desc" style={{ marginTop: 0 }}>
        One line per asset — just name, type and today's value. You can refine each one later
        (locality &amp; size for properties, rent, the acquisition story).
      </p>
      <form onSubmit={submit}>
        {rows.map((r, i) => (
          <div key={i} className="qa-row">
            <input value={r.name} placeholder={i === 0 ? "e.g. Jubilee Hills flat" : "Name"} onChange={(e) => upd(i, { name: e.target.value })} />
            <select value={r.assetClass} onChange={(e) => upd(i, { assetClass: e.target.value as AssetClass })}>
              {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input inputMode="numeric" value={r.value} placeholder="Value ₹" onChange={(e) => upd(i, { value: e.target.value })} />
          </div>
        ))}
        <button type="button" className="btn ghost small" onClick={() => setRows((rs) => [...rs, blank()])}>+ Another row</button>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add them all"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
