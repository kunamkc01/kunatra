"use client";
import { useState } from "react";
import { api, type Asset, type AssetClass } from "@/lib/api";
import { Sheet } from "./Sheet";

const CLASSES: { value: AssetClass; label: string; liquidDefault: boolean }[] = [
  { value: "real_estate", label: "Real estate", liquidDefault: false },
  { value: "mutual_fund", label: "Mutual fund", liquidDefault: true },
  { value: "sip", label: "SIP", liquidDefault: true },
  { value: "equity", label: "Equity / stocks", liquidDefault: true },
  { value: "epf", label: "EPF", liquidDefault: false },
  { value: "ppf", label: "PPF", liquidDefault: false },
  { value: "cash", label: "Cash & savings", liquidDefault: true },
  { value: "gold", label: "Gold", liquidDefault: false },
  { value: "insurance", label: "Insurance", liquidDefault: false },
  { value: "other", label: "Other", liquidDefault: false },
];

export function AssetSheet({
  householdId, existing, onClose, onSaved,
}: {
  householdId: string;
  existing?: Asset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(existing?.assetClass ?? "cash");
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [liquid, setLiquid] = useState<boolean>(
    existing?.liquid ?? CLASSES.find((c) => c.value === "cash")!.liquidDefault
  );
  const re = existing?.realEstate;
  const [address, setAddress] = useState(re?.address ?? "");
  const [sqft, setSqft] = useState(re?.sqft != null ? String(re.sqft) : "");
  const [undividedShare, setUndividedShare] = useState(re?.undividedShare ?? "");
  const [ptin, setPtin] = useState(re?.ptin ?? "");
  const [carPark, setCarPark] = useState(re?.carPark ?? "");
  const [carParkSize, setCarParkSize] = useState(re?.carParkSize ?? "");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function changeClass(c: AssetClass) {
    setAssetClass(c);
    // Only auto-set liquidity for a new asset, so edits don't get overwritten.
    if (!existing) setLiquid(CLASSES.find((x) => x.value === c)!.liquidDefault);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body: Partial<Asset> = {
      name: name.trim(),
      assetClass,
      value: Number(value),
      liquid,
      ...(assetClass === "real_estate"
        ? {
            realEstate: {
              address, sqft: sqft ? Number(sqft) : null, undividedShare,
              ptin, carPark, carParkSize,
            },
          }
        : {}),
    };
    try {
      if (existing) await api.updateAsset(existing.id, body);
      else await api.createAsset(householdId, body);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit asset" : "Add an asset"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home (2BHK)" autoFocus />
        </div>
        <div className="row2">
          <div className="field">
            <label>Type</label>
            <select value={assetClass} onChange={(e) => changeClass(e.target.value as AssetClass)}>
              {CLASSES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Current value (₹)</label>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="8500000" />
          </div>
        </div>
        <div className="field">
          <label className="checkbox">
            <input type="checkbox" checked={liquid} onChange={(e) => setLiquid(e.target.checked)} />
            Reachable in a hurry (counts toward emergency runway)
          </label>
        </div>

        {assetClass === "real_estate" && (
          <>
            <div className="field">
              <label>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Flat / street / city" />
            </div>
            <div className="row2">
              <div className="field">
                <label>Area (sq ft)</label>
                <input inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} placeholder="1450" />
              </div>
              <div className="field">
                <label>Undivided share</label>
                <input value={undividedShare} onChange={(e) => setUndividedShare(e.target.value)} placeholder="3.2%" />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label>PTIN</label>
                <input value={ptin} onChange={(e) => setPtin(e.target.value)} placeholder="Property tax ID" />
              </div>
              <div className="field">
                <label>Car park</label>
                <input value={carPark} onChange={(e) => setCarPark(e.target.value)} placeholder="e.g. B-12" />
              </div>
            </div>
            <div className="field">
              <label>Car park size</label>
              <input value={carParkSize} onChange={(e) => setCarParkSize(e.target.value)} placeholder="e.g. Covered, 1 slot" />
            </div>
          </>
        )}

        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}
