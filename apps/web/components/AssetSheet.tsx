"use client";
import { useEffect, useState } from "react";
import { api, type Asset, type AssetClass, type Valuation, type Contribution, type Member } from "@/lib/api";
import { inr } from "@/lib/format";
import { Sheet } from "./Sheet";

const CLASSES: { value: AssetClass; label: string; liquidDefault: boolean }[] = [
  { value: "real_estate", label: "Real estate", liquidDefault: false },
  { value: "mutual_fund", label: "Mutual fund", liquidDefault: true },
  { value: "sip", label: "SIP", liquidDefault: true },
  { value: "equity", label: "Equity / stocks", liquidDefault: true },
  { value: "epf", label: "EPF", liquidDefault: false },
  { value: "ppf", label: "PPF", liquidDefault: false },
  { value: "nps", label: "NPS", liquidDefault: false },
  { value: "fd", label: "Fixed deposit", liquidDefault: false },
  { value: "rd", label: "Recurring deposit", liquidDefault: false },
  { value: "bonds", label: "Bonds", liquidDefault: false },
  { value: "cash", label: "Cash & savings", liquidDefault: true },
  { value: "gold", label: "Gold", liquidDefault: false },
  { value: "insurance", label: "Insurance", liquidDefault: false },
  { value: "other", label: "Other", liquidDefault: false },
];

// Classes where a recurring monthly contribution is common.
const RECURRING = new Set<AssetClass>(["sip", "mutual_fund", "rd", "ppf", "epf", "nps"]);

export function AssetSheet({
  householdId, existing, members, onClose, onSaved, onChanged,
}: {
  householdId: string;
  existing?: Asset | null;
  members?: Member[];
  onClose: () => void;
  onSaved: () => void;
  onChanged?: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(existing?.assetClass ?? "cash");
  const [memberId, setMemberId] = useState(existing?.memberId ?? "");
  const [monthlyRent, setMonthlyRent] = useState(existing?.monthlyRent != null ? String(existing.monthlyRent) : "");
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [liquid, setLiquid] = useState<boolean>(
    existing?.liquid ?? CLASSES.find((c) => c.value === "cash")!.liquidDefault
  );
  const [costBasis, setCostBasis] = useState(existing?.costBasis != null ? String(existing.costBasis) : "");
  const [monthlyContribution, setMonthly] = useState(existing?.monthlyContribution != null ? String(existing.monthlyContribution) : "");
  const re = existing?.realEstate;
  const [address, setAddress] = useState(re?.address ?? "");
  const [sqft, setSqft] = useState(re?.sqft != null ? String(re.sqft) : "");
  const [undividedShare, setUndividedShare] = useState(re?.undividedShare ?? "");
  const [ptin, setPtin] = useState(re?.ptin ?? "");
  const [carPark, setCarPark] = useState(re?.carPark ?? "");
  const [carParkSize, setCarParkSize] = useState(re?.carParkSize ?? "");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Valuation history (edit mode) — recording appreciation over time.
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [valAmount, setValAmount] = useState("");
  const [valDate, setValDate] = useState("");
  const [valBusy, setValBusy] = useState(false);

  const loadValuations = () => { if (existing) api.listValuations(existing.id).then(setValuations).catch(() => {}); };
  useEffect(loadValuations, [existing?.id]);

  async function addValuation() {
    if (!existing || !valAmount || !valDate) return;
    setValBusy(true);
    try {
      const v = await api.addValuation(existing.id, { value: Number(valAmount), asOf: valDate });
      setValAmount(""); setValDate("");
      loadValuations();
      // If this is the latest, reflect it in the current-value field.
      if (valuations.every((x) => x.asOf <= v.asOf)) setValue(String(v.value));
      onChanged?.();
    } catch (e: any) {
      setErr(e.message ?? "Could not record valuation");
    } finally { setValBusy(false); }
  }

  async function removeValuation(id: string) {
    await api.deleteValuation(id);
    loadValuations();
    onChanged?.();
  }

  // Contribution ledger (edit mode) — drives XIRR.
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState("");
  const [sipAmount, setSipAmount] = useState("");
  const [sipStart, setSipStart] = useState("");
  const [contribBusy, setContribBusy] = useState(false);

  const loadContribs = () => { if (existing) api.listContributions(existing.id).then(setContribs).catch(() => {}); };
  useEffect(loadContribs, [existing?.id]);

  async function addContribution() {
    if (!existing || !contribAmount || !contribDate) return;
    setContribBusy(true);
    try {
      await api.addContribution(existing.id, { amount: Number(contribAmount), on: contribDate });
      setContribAmount(""); setContribDate(""); loadContribs(); onChanged?.();
    } catch (e: any) { setErr(e.message ?? "Could not add contribution"); }
    finally { setContribBusy(false); }
  }

  async function generateSip() {
    if (!existing || !sipAmount || !sipStart) return;
    setContribBusy(true);
    try {
      const r = await api.addSipSchedule(existing.id, { amount: Number(sipAmount), startOn: sipStart });
      setSipAmount(""); setSipStart(""); loadContribs(); onChanged?.();
      alert(`Added ${r.added} monthly contributions.`);
    } catch (e: any) { setErr(e.message ?? "Could not generate schedule"); }
    finally { setContribBusy(false); }
  }

  async function removeContribution(id: string) {
    await api.deleteContribution(id); loadContribs(); onChanged?.();
  }

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
      memberId: memberId || null,
      monthlyRent: monthlyRent ? Number(monthlyRent) : null,
      costBasis: costBasis ? Number(costBasis) : null,
      monthlyContribution: monthlyContribution ? Number(monthlyContribution) : null,
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

        {members && members.length > 0 && (
          <div className="field">
            <label>Belongs to</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Household / joint</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

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
            <div className="row2">
              <div className="field">
                <label>Car park size</label>
                <input value={carParkSize} onChange={(e) => setCarParkSize(e.target.value)} placeholder="e.g. Covered, 1 slot" />
              </div>
              <div className="field">
                <label>Monthly rent (if let)</label>
                <input inputMode="numeric" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} placeholder="e.g. 35000" />
                <div className="hint">Drives rent-vs-EMI (DSCR)</div>
              </div>
            </div>
          </>
        )}

        {assetClass !== "cash" && (
          <div className="row2">
            <div className="field">
              <label>Amount invested (cost basis)</label>
              <input inputMode="numeric" value={costBasis} onChange={(e) => setCostBasis(e.target.value)} placeholder="optional" />
              <div className="hint">Drives your gain vs current value</div>
            </div>
            {RECURRING.has(assetClass) && (
              <div className="field">
                <label>Monthly contribution</label>
                <input inputMode="numeric" value={monthlyContribution} onChange={(e) => setMonthly(e.target.value)} placeholder="e.g. 15000" />
                <div className="hint">Recurring SIP/RD/PPF…</div>
              </div>
            )}
          </div>
        )}

        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>

      {existing && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="sec-label" style={{ margin: "0 0 8px" }}>Value history</div>
          <div className="row2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>New value (₹)</label>
              <input inputMode="numeric" value={valAmount} onChange={(e) => setValAmount(e.target.value)} placeholder="550000" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>As of</label>
              <input type="date" value={valDate} onChange={(e) => setValDate(e.target.value)} />
            </div>
          </div>
          <div className="actions" style={{ marginBottom: 8 }}>
            <button className="btn small" type="button" onClick={addValuation} disabled={valBusy || !valAmount || !valDate}>Record value</button>
          </div>
          {valuations.length === 0 && <div className="hint">No valuations recorded — the latest becomes the current value.</div>}
          {valuations.map((v) => (
            <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="tnum">{inr(v.value)}</span>
              <span className="muted" style={{ fontSize: 12 }}>{v.asOf}{v.source ? ` · ${v.source}` : ""}</span>
              <button className="btn ghost small danger" type="button" onClick={() => removeValuation(v.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {existing && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="sec-label" style={{ margin: "0 0 4px" }}>Contributions (for XIRR)</div>
          <div className="hint" style={{ marginBottom: 8 }}>Dated money in/out powers your annualized return. Use the SIP generator for recurring investments.</div>
          <div className="row2">
            <div className="field" style={{ marginBottom: 6 }}>
              <label>Amount (₹)</label>
              <input inputMode="numeric" value={contribAmount} onChange={(e) => setContribAmount(e.target.value)} placeholder="100000 (− to withdraw)" />
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <label>On</label>
              <input type="date" value={contribDate} onChange={(e) => setContribDate(e.target.value)} />
            </div>
          </div>
          <div className="actions" style={{ marginBottom: 10 }}>
            <button className="btn small" type="button" onClick={addContribution} disabled={contribBusy || !contribAmount || !contribDate}>Add contribution</button>
          </div>

          <div className="row2">
            <div className="field" style={{ marginBottom: 6 }}>
              <label>SIP amount /mo (₹)</label>
              <input inputMode="numeric" value={sipAmount} onChange={(e) => setSipAmount(e.target.value)} placeholder="15000" />
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <label>Starting</label>
              <input type="date" value={sipStart} onChange={(e) => setSipStart(e.target.value)} />
            </div>
          </div>
          <div className="actions" style={{ marginBottom: 8 }}>
            <button className="btn small" type="button" onClick={generateSip} disabled={contribBusy || !sipAmount || !sipStart}>Generate monthly SIP → today</button>
          </div>

          {contribs.length === 0 && <div className="hint">No contributions recorded yet.</div>}
          {contribs.length > 0 && <div className="hint" style={{ marginBottom: 4 }}>{contribs.length} contribution{contribs.length === 1 ? "" : "s"}</div>}
          {contribs.slice(0, 6).map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="tnum" style={{ color: c.amount < 0 ? "var(--good)" : "var(--ink)" }}>{c.amount < 0 ? "−" : ""}{inr(Math.abs(c.amount))}</span>
              <span className="muted" style={{ fontSize: 12 }}>{c.on}{c.note ? ` · ${c.note}` : ""}</span>
              <button className="btn ghost small danger" type="button" onClick={() => removeContribution(c.id)}>✕</button>
            </div>
          ))}
          {contribs.length > 6 && <div className="hint" style={{ marginTop: 4 }}>…and {contribs.length - 6} more</div>}
        </div>
      )}
    </Sheet>
  );
}
