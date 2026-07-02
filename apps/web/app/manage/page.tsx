"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Asset, type Loan, type Household, type Member } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr, assetClassLabel } from "@/lib/format";
import { Shell } from "@/components/Shell";
import { AssetSheet } from "@/components/AssetSheet";
import { LoanSheet } from "@/components/LoanSheet";
import { MemberSheet } from "@/components/MemberSheet";

export default function Assets() {
  const { user, ready } = useAuth();
  const role = user?.role;
  const isOwner = role === "owner";
  const canSeeFinancials = role !== "operations"; // owner + advisor
  const canEditAssets = role === "owner" || role === "operations"; // not advisor (read-only)
  const hhId = user?.householdId ?? null;
  const [household, setHousehold] = useState<Household | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [assetSheet, setAssetSheet] = useState<{ open: boolean; edit?: Asset | null }>({ open: false });
  const [loanSheet, setLoanSheet] = useState<{ open: boolean; edit?: Loan | null }>({ open: false });
  const [memberSheet, setMemberSheet] = useState<{ open: boolean; edit?: Member | null }>({ open: false });

  const load = useCallback(async (id: string, financials: boolean) => {
    setErr(null);
    try {
      const [hh, a, m] = await Promise.all([api.getHousehold(id), api.listAssets(id), api.listMembers(id)]);
      setHousehold(hh); setAssets(a); setMembers(m);
      // Loans are visible to owners + advisors (the API forbids them for operations).
      setLoans(financials ? await api.listLoans(id) : []);
    } catch (e: any) {
      setErr(e.message ?? "Could not load");
    }
  }, []);

  useEffect(() => {
    if (ready && user) load(user.householdId, user.role !== "operations");
  }, [ready, user, load]);

  const refresh = () => { if (hhId) load(hhId, canSeeFinancials); };

  async function removeAsset(a: Asset) {
    if (!confirm(`Delete "${a.name}"? Any loan secured against it becomes unsecured.`)) return;
    await api.deleteAsset(a.id); refresh();
  }
  async function removeLoan(l: Loan) {
    if (!confirm(`Delete "${l.name}"?`)) return;
    await api.deleteLoan(l.id); refresh();
  }

  const securedFor = (assetId: string) => loans.filter((l) => l.securedAssetId === assetId).reduce((s, l) => s + l.outstanding, 0);
  const gross = assets.reduce((s, a) => s + a.value, 0);
  const totalEmi = loans.reduce((s, l) => s + l.emiMonthly, 0);
  // Income: net salary (members, else household take-home) + net rent.
  const memberNet = members.reduce((s, m) => s + (m.monthlyNet ?? 0), 0);
  const hasMembersIncome = members.some((m) => m.monthlyNet != null);
  const salaryNet = hasMembersIncome ? memberNet : (household?.monthlyTakeHome ?? 0);
  const netRent = assets.reduce((s, a) => s + Math.max(0, (a.monthlyRent ?? 0) - (a.rentTds ?? 0)), 0);
  const income = salaryNet + netRent;
  const assetName = (id: string | null) => assets.find((a) => a.id === id)?.name;
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name;
  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.name}? Their assets and loans become household/joint.`)) return;
    await api.deleteMember(m.id); refresh();
  }

  // Top-level assets vs nested components (parent_asset_id).
  const topLevel = assets.filter((a) => !a.parentAssetId);
  const childrenOf = (id: string) => assets.filter((a) => a.parentAssetId === id);

  if (!ready) return <Shell><div /></Shell>;
  if (!hhId) {
    return (
      <Shell>
        <div className="empty">No household yet. <Link href="/" style={{ color: "var(--accent)" }}>Set one up →</Link></div>
      </Shell>
    );
  }

  const cols = canSeeFinancials ? 6 : 3;
  const renderAssetRow = (a: Asset, nested = false) => {
    const loan = securedFor(a.id);
    const equity = a.value - loan;
    const ltv = a.value > 0 && loan > 0 ? (loan / a.value) * 100 : null;
    return (
      <tr key={a.id} style={nested ? { background: "var(--tint)" } : undefined}>
        <td style={{ paddingLeft: nested ? 26 : 8 }}>
          {nested && <span className="muted">↳ </span>}
          <span style={{ fontWeight: 500 }}>{a.name}</span>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{assetClassLabel(a.assetClass)}{a.acquiredHow && a.acquiredYear ? ` · ${a.acquiredHow} ${a.acquiredYear}` : ""}{a.liquid ? " · liquid" : ""}{a.memberId ? ` · ${memberName(a.memberId) ?? "member"}` : ""}{a.realEstate?.address ? ` · ${a.realEstate.address}` : ""}</div>
        </td>
        <td className="tnum">{inr(a.value)}</td>
        {canSeeFinancials && <td className="tnum" style={{ color: loan > 0 ? "var(--bad)" : "var(--muted)" }}>{loan > 0 ? inr(loan) : "—"}</td>}
        {canSeeFinancials && <td className="tnum">{inr(equity)}</td>}
        {canSeeFinancials && (
          <td className="tnum" style={{ color: ltv != null ? (ltv >= 80 ? "var(--bad)" : ltv >= 60 ? "var(--warn)" : "var(--ink)") : "var(--muted)" }}>
            {ltv != null ? `${ltv.toFixed(0)}%` : "owned"}
          </td>
        )}
        <td style={{ whiteSpace: "nowrap" }}>
          {canEditAssets && <button className="btn ghost small" onClick={() => setAssetSheet({ open: true, edit: a })}>Edit</button>}
          {isOwner && <button className="btn ghost small danger" onClick={() => removeAsset(a)}>Delete</button>}
          {!canEditAssets && <span className="muted" style={{ fontSize: 12 }}>view</span>}
        </td>
      </tr>
    );
  };

  return (
    <Shell office={household?.displayName}>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Asset register</h2>
          <div className="scr-sub">Properties at the top level · loans netted per asset</div>
        </div>
        {canEditAssets && <button className="btn primary" onClick={() => setAssetSheet({ open: true, edit: null })}>+ Add asset</button>}
      </div>

      {err && <div className="strip bad">{err}</div>}

      {canSeeFinancials && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>Debt service</div>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <div className="tile"><div className="tl">Gross assets</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(gross)}</div></div>
            <div className="tile b"><div className="tl">Total EMI</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{inr(totalEmi)}<span style={{ fontSize: 12, color: "var(--muted)" }}>/mo</span></div></div>
            <div className="tile"><div className="tl">EMI vs income</div><div className="tv num" style={{ fontSize: 21, marginTop: 4 }}>{income ? `${((totalEmi / income) * 100).toFixed(0)}%` : "—"}</div></div>
          </div>
        </>
      )}

      <div className="scroll">
        <table>
          <thead><tr><th style={{ width: "34%" }}>Asset</th><th>Market value</th>{canSeeFinancials && <><th>Loan</th><th>Equity</th><th>LTV</th></>}<th></th></tr></thead>
          <tbody>
            {topLevel.length === 0 && <tr><td colSpan={cols} className="empty">No assets yet — add your home, funds, savings…</td></tr>}
            {topLevel.flatMap((a) => [renderAssetRow(a), ...childrenOf(a.id).map((c) => renderAssetRow(c, true))])}
          </tbody>
        </table>
      </div>

      {canSeeFinancials && (
        <>
          {/* Family members */}
          <div className="sec-label">Family members{isOwner && <button className="btn small primary" onClick={() => setMemberSheet({ open: true, edit: null })}>+ Add member</button>}</div>
          {members.length === 0 && <div className="empty">Add earners to aggregate the household income and see each person's own net worth.</div>}
          {members.map((m) => (
            <div className="row-item" key={m.id}>
              <div className="h">
                <span className="t">{m.name}</span>
                <span className="tnum">{m.monthlyNet != null ? `${inr(m.monthlyNet)}/mo net` : "no income set"}</span>
              </div>
              <div className="meta">
                {assets.filter((a) => a.memberId === m.id).length} asset(s)
                {m.monthlyGross != null ? ` · gross ${inr(m.monthlyGross)}${m.monthlyTds ? ` − TDS ${inr(m.monthlyTds)}` : ""}` : ""}
              </div>
              {isOwner && (
                <div className="acts">
                  <button className="btn ghost small" onClick={() => setMemberSheet({ open: true, edit: m })}>Edit</button>
                  <button className="btn ghost small danger" onClick={() => removeMember(m)}>Remove</button>
                </div>
              )}
            </div>
          ))}
          {hasMembersIncome && (
            <div className="hint" style={{ margin: "2px 4px 0" }}>
              Household take-home = {inr(memberNet)}/mo net (sum of members).
            </div>
          )}

          {/* Loans */}
          <div className="sec-label">Loans{isOwner && <button className="btn small primary" onClick={() => setLoanSheet({ open: true, edit: null })}>+ Add loan</button>}</div>
          {loans.length === 0 && <div className="empty">No loans — or add one to see your leverage.</div>}
          {loans.map((l) => (
            <div className="row-item" key={l.id}>
              <div className="h">
                <span className="t">{l.name}</span>
                <span className="tnum" style={{ color: "var(--bad)" }}>{inr(l.outstanding)}</span>
              </div>
              <div className="meta">
                EMI {inr(l.emiMonthly)}/mo{l.ratePct != null ? ` · ${l.ratePct}%` : ""}
                {l.securedAssetId ? ` · against ${assetName(l.securedAssetId) ?? "an asset"}` : " · unsecured"}
              </div>
              {isOwner && (
                <div className="acts">
                  <button className="btn ghost small" onClick={() => setLoanSheet({ open: true, edit: l })}>Edit</button>
                  <button className="btn ghost small danger" onClick={() => removeLoan(l)}>Delete</button>
                </div>
              )}
            </div>
          ))}

          {/* Cash flow */}
          <CashflowPanel household={household} onSaved={refresh} readOnly={!isOwner} membersDriveIncome={hasMembersIncome} />
        </>
      )}

      <div className="explain">
        {isOwner
          ? "LTV is on current market value; equity is value minus the loan secured on that asset. Solar, lifts and UPS can be recorded as components of the property they serve — their cost rolls up to the parent."
          : role === "advisor"
            ? "Advisor view — the full financial picture, read-only. You can see net worth, loans, LTV and returns, but changes stay with the owner."
            : "You have operational access: keep the asset register and property details current. Financial totals, loans and cash flow are the owner's view."}
      </div>

      {assetSheet.open && hhId && (
        <AssetSheet householdId={hhId} existing={assetSheet.edit} members={members} onClose={() => setAssetSheet({ open: false })} onSaved={() => { setAssetSheet({ open: false }); refresh(); }} onChanged={refresh} />
      )}
      {loanSheet.open && hhId && (
        <LoanSheet householdId={hhId} existing={loanSheet.edit} assets={assets} members={members} onClose={() => setLoanSheet({ open: false })} onSaved={() => { setLoanSheet({ open: false }); refresh(); }} />
      )}
      {memberSheet.open && hhId && (
        <MemberSheet householdId={hhId} existing={memberSheet.edit} onClose={() => setMemberSheet({ open: false })} onSaved={() => { setMemberSheet({ open: false }); refresh(); }} />
      )}
    </Shell>
  );
}

function CashflowPanel({ household, onSaved, readOnly = false, membersDriveIncome = false }: { household: Household | null; onSaved: () => void; readOnly?: boolean; membersDriveIncome?: boolean }) {
  const [takeHome, setTakeHome] = useState("");
  const [essential, setEssential] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTakeHome(household?.monthlyTakeHome != null ? String(household.monthlyTakeHome) : "");
    setEssential(household?.monthlyEssential != null ? String(household.monthlyEssential) : "");
  }, [household]);

  if (!household) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setSaved(false);
    try {
      await api.updateHousehold(household!.id, {
        monthlyEssential: essential ? Number(essential) : null,
        ...(membersDriveIncome ? {} : { monthlyTakeHome: takeHome ? Number(takeHome) : null }),
      });
      setSaved(true); onSaved();
    } finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={save} style={{ marginTop: 18 }}>
      <h3>Monthly spending</h3>
      <p className="desc">
        {membersDriveIncome
          ? "Income comes from your members (salary) and let properties (rent). Set your household essentials here — it drives runway and surplus."
          : "Your take-home and essentials — drives EMI-strain, runway and surplus. Add family members to split salary out per person."}
      </p>
      <div className="row2">
        {!membersDriveIncome && (
          <div className="field"><label>Take-home (₹)</label><input inputMode="numeric" value={takeHome} disabled={readOnly} onChange={(e) => { setTakeHome(e.target.value); setSaved(false); }} placeholder="140000" /></div>
        )}
        <div className="field"><label>Essentials (₹/mo)</label><input inputMode="numeric" value={essential} disabled={readOnly} onChange={(e) => { setEssential(e.target.value); setSaved(false); }} placeholder="50000" /></div>
      </div>
      {!readOnly && (
        <div className="actions">
          <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save cash flow"}</button>
          {saved && <span style={{ color: "var(--good)", fontSize: 12.5 }}>Saved ✓</span>}
        </div>
      )}
    </form>
  );
}
