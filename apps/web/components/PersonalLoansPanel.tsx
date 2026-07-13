"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type PersonalLoanSummary, type PersonalLoan, type InterestFrequency, type LoanDirection } from "@/lib/api";
import { inr } from "@/lib/format";

const FREQ: { value: InterestFrequency; label: string; per: string }[] = [
  { value: "monthly", label: "Monthly", per: "month" },
  { value: "quarterly", label: "Quarterly", per: "quarter" },
  { value: "half_yearly", label: "Half-yearly", per: "half-year" },
  { value: "yearly", label: "Yearly", per: "year" },
];
const perLabel = (f: string) => FREQ.find((x) => x.value === f)?.per ?? "period";

type Draft = { direction: LoanDirection; counterparty: string; principal: string; ratePct: string; frequency: InterestFrequency; startedOn: string };
const emptyDraft = (direction: LoanDirection): Draft => ({ direction, counterparty: "", principal: "", ratePct: "", frequency: "monthly", startedOn: "" });

/** Personal loans given (lent) and taken (borrowed) — folds into net worth; interest shown per its frequency. */
export function PersonalLoansPanel({ householdId, canManage }: { householdId: string; canManage: boolean }) {
  const [s, setS] = useState<PersonalLoanSummary | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api.personalLoans(householdId).then(setS).catch(() => {}), [householdId]);
  useEffect(() => { load(); }, [load]);

  async function save(d: Draft, id: string | null) {
    setErr(null);
    const body = {
      direction: d.direction, counterparty: d.counterparty.trim(),
      principal: d.principal ? Number(d.principal) : 0,
      ratePct: d.ratePct ? Number(d.ratePct) : null,
      frequency: d.frequency, startedOn: d.startedOn || null,
    };
    if (!body.counterparty) { setErr("Who is it with?"); return; }
    try {
      if (id) await api.updatePersonalLoan(id, body);
      else await api.createPersonalLoan(householdId, body);
      setDraft(null); setEditing(null); load();
    } catch (e: any) { setErr(e.message ?? "Could not save"); }
  }
  async function remove(l: PersonalLoan) {
    if (!confirm(`Delete the ${l.direction === "given" ? "loan to" : "loan from"} ${l.counterparty}?`)) return;
    await api.deletePersonalLoan(l.id); load();
  }

  if (!s) return null;
  const has = s.loans.length > 0;

  return (
    <>
      <div className="sec-label">
        <span>Personal loans <span className="muted" style={{ fontWeight: 400 }}>· money you&apos;ve lent or borrowed</span></span>
        {canManage && <button className="btn small primary" onClick={() => { setDraft(emptyDraft("given")); setEditing(null); }}>+ Add</button>}
      </div>

      {has && (
        <div className="sumstrip" style={{ marginBottom: 12 }}>
          <span><span className="k">Lent out</span><span className="v num" style={{ color: "var(--good)" }}>{inr(s.givenPrincipal)}</span></span>
          <span><span className="k">Borrowed</span><span className="v num" style={{ color: "var(--bad)" }}>{inr(s.takenPrincipal)}</span></span>
          <span><span className="k">Net</span><span className="v num">{s.netPrincipal >= 0 ? "+" : "−"}{inr(Math.abs(s.netPrincipal))}</span></span>
          {s.monthlyInterestIn > 0 && <span><span className="k">Interest in</span><span className="v num" style={{ color: "var(--good)" }}>{inr(s.monthlyInterestIn)}<span className="per">/mo</span></span></span>}
          {s.monthlyInterestOut > 0 && <span><span className="k">Interest out</span><span className="v num" style={{ color: "var(--bad)" }}>{inr(s.monthlyInterestOut)}<span className="per">/mo</span></span></span>}
        </div>
      )}

      {!has && !draft && <div className="empty">Lent money to family, or taken a hand loan? Track it here — it counts toward your net worth and its interest shows up.</div>}

      {draft && !editing && <LoanForm draft={draft} setDraft={setDraft} onSave={() => save(draft, null)} onCancel={() => { setDraft(null); setErr(null); }} err={err} />}

      {s.loans.map((l) => (
        <div className="row-item" key={l.id}>
          {editing === l.id && draft ? (
            <LoanForm draft={draft} setDraft={setDraft} onSave={() => save(draft, l.id)} onCancel={() => { setEditing(null); setDraft(null); setErr(null); }} err={err} />
          ) : (
            <>
              <div className="h">
                <span className="t">
                  <span className={`pill ${l.direction === "given" ? "p-good" : "p-bad"}`} style={{ marginRight: 7 }}>{l.direction === "given" ? "lent" : "borrowed"}</span>
                  {l.counterparty}
                </span>
                <span className="tnum" style={{ color: l.direction === "given" ? "var(--good)" : "var(--bad)" }}>{inr(l.principal)}</span>
              </div>
              <div className="meta">
                {l.ratePct != null ? <>{l.ratePct}%/yr · <b style={{ color: "var(--ink)" }}>{inr(l.interestPerPeriod)}</b>/{perLabel(l.frequency)}{l.direction === "given" ? " in" : " out"}</> : "no interest"}
                {l.startedOn ? ` · since ${l.startedOn}` : ""}
              </div>
              {canManage && (
                <div className="acts">
                  <button className="btn ghost small" onClick={() => setPayFor(payFor === l.id ? null : l.id)}>Log payment</button>
                  <button className="btn ghost small" onClick={() => { setEditing(l.id); setDraft({ direction: l.direction, counterparty: l.counterparty, principal: String(l.principal), ratePct: l.ratePct != null ? String(l.ratePct) : "", frequency: l.frequency, startedOn: l.startedOn ?? "" }); }}>Edit</button>
                  <button className="btn ghost small danger" onClick={() => remove(l)}>Delete</button>
                </div>
              )}
              {payFor === l.id && <PaymentLog loan={l} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); load(); }} />}
            </>
          )}
        </div>
      ))}
    </>
  );
}

function LoanForm({ draft, setDraft, onSave, onCancel, err }: {
  draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; err: string | null;
}) {
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v });
  const preview = draft.principal && draft.ratePct
    ? inr((Number(draft.principal) * (Number(draft.ratePct) / 100)) / (FREQ.find((f) => f.value === draft.frequency)!.value === "monthly" ? 12 : draft.frequency === "quarterly" ? 4 : draft.frequency === "half_yearly" ? 2 : 1))
    : null;
  return (
    <div>
      <div className="row2">
        <div className="field">
          <label>Direction</label>
          <select value={draft.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="given">I lent it out</option>
            <option value="taken">I borrowed it</option>
          </select>
        </div>
        <div className="field"><label>With whom?</label><input value={draft.counterparty} onChange={(e) => set("counterparty", e.target.value)} placeholder="e.g. Cousin Ravi" /></div>
      </div>
      <div className="row2">
        <div className="field"><label>Principal (₹)</label><input inputMode="numeric" value={draft.principal} onChange={(e) => set("principal", e.target.value)} placeholder="500000" /></div>
        <div className="field"><label>Interest rate (%/yr)</label><input inputMode="decimal" value={draft.ratePct} onChange={(e) => set("ratePct", e.target.value)} placeholder="12" /></div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Interest paid</label>
          <select value={draft.frequency} onChange={(e) => set("frequency", e.target.value)}>
            {FREQ.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Since (optional)</label><input type="date" value={draft.startedOn} onChange={(e) => set("startedOn", e.target.value)} /></div>
      </div>
      {preview && <div className="hint" style={{ marginBottom: 8 }}>≈ {preview} interest per {perLabel(draft.frequency)}.</div>}
      {err && <div className="err">{err}</div>}
      <div className="actions">
        <button className="btn primary small" onClick={onSave}>Save</button>
        <button className="btn ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PaymentLog({ loan, onClose, onSaved }: { loan: PersonalLoan; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(loan.interestPerPeriod || ""));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ id: string; paidOn: string; amount: number }[] | null>(null);
  useEffect(() => { api.listPersonalLoanPayments(loan.id).then(setRows).catch(() => setRows([])); }, [loan.id]);
  async function save() {
    setBusy(true);
    try { await api.addPersonalLoanPayment(loan.id, { paidOn, amount: amount ? Number(amount) : 0, kind: "interest" }); onSaved(); }
    finally { setBusy(false); }
  }
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="hint" style={{ marginBottom: 6 }}>Log the interest actually {loan.direction === "given" ? "received" : "paid"} (leave the auto figure, or enter what really moved).</div>
      <div className="row2">
        <div className="field"><label>Amount (₹)</label><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>On</label><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
      </div>
      <div className="actions">
        <button className="btn primary small" onClick={save} disabled={busy}>Log it</button>
        <button className="btn ghost small" onClick={onClose}>Close</button>
      </div>
      {rows && rows.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--slate)" }}>
          {rows.slice(0, 6).map((p) => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>{p.paidOn}</span><span className="tnum">{inr(p.amount)}</span></div>)}
        </div>
      )}
    </div>
  );
}
