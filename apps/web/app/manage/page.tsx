"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Asset, type AssetClass, type Loan, type Household, type Member, type PropertyPulse } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr, assetClassLabel } from "@/lib/format";
import { Shell } from "@/components/Shell";
import { AssetSheet } from "@/components/AssetSheet";
import { LoanSheet } from "@/components/LoanSheet";
import { MemberSheet } from "@/components/MemberSheet";
import { QuickAddSheet } from "@/components/QuickAddSheet";

export default function Assets() {
  const { user, ready } = useAuth();
  const role = user?.role;
  const isOwner = role === "owner";
  const canManageMoney = role === "owner" || role === "manager"; // loans, members, cash flow
  const canSeeFinancials = role !== "operations"; // everyone but operations
  const canEditAssets = role === "owner" || role === "manager" || role === "operations" || role === "member"; // not advisor (read-only)
  const hhId = user?.householdId ?? null;
  const [household, setHousehold] = useState<Household | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Record<string, PropertyPulse>>({});

  const [assetSheet, setAssetSheet] = useState<{ open: boolean; edit?: Asset | null; presetClass?: AssetClass; presetRented?: boolean }>({ open: false });
  const [loanSheet, setLoanSheet] = useState<{ open: boolean; edit?: Loan | null }>({ open: false });
  const [memberSheet, setMemberSheet] = useState<{ open: boolean; edit?: Member | null }>({ open: false });
  const [quickAdd, setQuickAdd] = useState(false);

  const load = useCallback(async (id: string, financials: boolean) => {
    setErr(null);
    try {
      const [hh, a, m] = await Promise.all([api.getHousehold(id), api.listAssets(id), api.listMembers(id)]);
      setHousehold(hh); setAssets(a); setMembers(m);
      api.propertyPulse(id).then((ps) => setPulses(Object.fromEntries(ps.map((p) => [p.assetId, p])))).catch(() => {});
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
  const properties = topLevel.filter((a) => a.assetClass === "real_estate");
  const others = topLevel.filter((a) => a.assetClass !== "real_estate");
  const propTotal = properties.reduce((s, a) => s + a.value, 0);
  const liquidTotal = others.reduce((s, a) => s + (a.liquid ? a.value : 0), 0);
  const rentedProps = properties.filter((a) => (a.monthlyRent ?? 0) > 0);
  const needsYou = properties.filter((a) => {
    const p = pulses[a.id];
    return p ? p.rentStatus === "due" || p.openRequests > 0 : false;
  }).length;

  if (!ready) return <Shell><div /></Shell>;
  if (!hhId) {
    return (
      <Shell>
        <div className="empty">No household yet. <Link href="/" style={{ color: "var(--accent)" }}>Set one up →</Link></div>
      </Shell>
    );
  }

  // Compact row for the non-property "everything else" table.
  const renderOtherRow = (a: Asset, nested = false) => {
    const loan = securedFor(a.id);
    return (
      <tr key={a.id} style={nested ? { background: "var(--tint)" } : undefined}>
        <td style={{ paddingLeft: nested ? 26 : 8 }}>
          {nested && <span className="muted">↳ </span>}
          <Link href={`/assets/view?id=${a.id}`} className="asset-link" style={{ fontWeight: 500 }}>{a.name}</Link>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{assetClassLabel(a.assetClass)}{a.acquiredHow && a.acquiredYear ? ` · ${a.acquiredHow} ${a.acquiredYear}` : ""}{a.memberId ? ` · ${memberName(a.memberId) ?? "member"}` : ""}</div>
        </td>
        <td className="tnum">{inr(a.value)}</td>
        {canSeeFinancials && <td style={{ whiteSpace: "nowrap", fontSize: 11.5 }}>
          {loan > 0 ? <span style={{ color: "var(--bad)" }}>loan {inr(loan)}</span> : <span className="pill p-muted">{a.liquid ? "liquid" : "owned"}</span>}
        </td>}
        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
          {canEditAssets && <button className="btn ghost small" onClick={() => setAssetSheet({ open: true, edit: a })}>Edit</button>}
          {(canManageMoney || (role === "member" && a.memberId === user?.memberId)) && <button className="btn ghost small danger" onClick={() => removeAsset(a)}>Delete</button>}
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
        {canEditAssets && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => setQuickAdd(true)} title="Several at once — name, type, value">Quick add</button>
            <button className="btn primary" onClick={() => setAssetSheet({ open: true, edit: null })}>+ Add asset</button>
          </div>
        )}
      </div>

      {err && <div className="strip bad">{err}</div>}

      {topLevel.length === 0 && (
        canEditAssets ? (
          <div style={{ padding: "6px 2px 4px" }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>What do you own? Start with one:</div>
            <div className="starters">
              {([
                { ic: "🏠", t: "Home I live in", s: "house or flat", c: "real_estate" as AssetClass },
                { ic: "🏢", t: "Property I rent out", s: "earns rent", c: "real_estate" as AssetClass, rented: true },
                { ic: "📈", t: "Mutual funds / SIP", s: "recurring investing", c: "sip" as AssetClass },
                { ic: "🏦", t: "Fixed deposit", s: "FD / bonds", c: "fd" as AssetClass },
                { ic: "🪙", t: "Gold", s: "jewellery, coins, SGB", c: "gold" as AssetClass },
                { ic: "💵", t: "Cash & savings", s: "bank balances", c: "cash" as AssetClass },
              ]).map((x) => (
                <button key={x.t} type="button" className="starter"
                  onClick={() => setAssetSheet({ open: true, edit: null, presetClass: x.c, presetRented: x.rented })}>
                  <span className="ic">{x.ic}</span>
                  <span className="t">{x.t}</span>
                  <span className="s">{x.s}</span>
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>Each one takes under a minute — tell the story of how you got it, and the math follows.</div>
          </div>
        ) : <div className="empty">No assets yet.</div>
      )}

      {/* summary strip — the household's property pulse at a glance */}
      {canSeeFinancials && properties.length > 0 && (
        <div className="sumstrip">
          <span><span className="k">Properties</span><span className="v num">{inr(propTotal)}</span></span>
          {rentedProps.length > 0 && <span><span className="k">Net rent</span><span className="v num">{inr(netRent)}<span className="per">/mo</span></span></span>}
          {rentedProps.length > 0 && <span><span className="k">Occupied</span><span className="v num">{rentedProps.filter((a) => (pulses[a.id]?.rentStatus ?? null) !== null || a.tenantName).length} of {rentedProps.length}</span></span>}
          {totalEmi > 0 && <span><span className="k">EMI</span><span className="v num">{inr(totalEmi)}<span className="per">/mo</span></span></span>}
          <span><span className="k">Needs you</span><span className="v num" style={{ color: needsYou > 0 ? "var(--warn)" : "var(--ink)" }}>{needsYou}</span></span>
        </div>
      )}

      {/* properties as cards — a place with a story and a pulse, not a line item */}
      {properties.length > 0 && (
        <>
          <div className="sec-label" style={{ marginTop: 4 }}>Properties · {inr(propTotal)}</div>
          <div className="pgrid">
            {properties.map((a) => (
              <PropertyCard key={a.id} asset={a} pulse={pulses[a.id]} loan={securedFor(a.id)}
                ownerName={a.memberId ? memberName(a.memberId) ?? null : null}
                canSee={canSeeFinancials} canEdit={canEditAssets}
                onEdit={() => setAssetSheet({ open: true, edit: a })} />
            ))}
          </div>
        </>
      )}

      {/* everything else, compactly */}
      {others.length > 0 && (
        <>
          <div className="sec-label">
            <span>Everything else · {inr(others.reduce((s, a) => s + a.value, 0))}</span>
            {canSeeFinancials && liquidTotal > 0 && <span className="hint" style={{ fontWeight: 400 }}>{inr(liquidTotal)} reachable within a week</span>}
          </div>
          <div className="scroll">
            <table>
              <tbody>
                {others.flatMap((a) => [renderOtherRow(a), ...childrenOf(a.id).map((c) => renderOtherRow(c, true))])}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canSeeFinancials && (
        <>
          {/* Family members */}
          <div className="sec-label">Family members{canManageMoney && <button className="btn small primary" onClick={() => setMemberSheet({ open: true, edit: null })}>+ Add member</button>}</div>
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
                {m.monthlyExpenses != null ? ` · spends ${inr(m.monthlyExpenses)}/mo` : ""}
              </div>
              {(canManageMoney || (role === "member" && m.id === user?.memberId)) && (
                <div className="acts">
                  <button className="btn ghost small" onClick={() => setMemberSheet({ open: true, edit: m })}>Edit</button>
                  {canManageMoney && <button className="btn ghost small danger" onClick={() => removeMember(m)}>Remove</button>}
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
          <div className="sec-label">Loans{canManageMoney && <button className="btn small primary" onClick={() => setLoanSheet({ open: true, edit: null })}>+ Add loan</button>}</div>
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
              {canManageMoney && (
                <div className="acts">
                  <button className="btn ghost small" onClick={() => setLoanSheet({ open: true, edit: l })}>Edit</button>
                  <button className="btn ghost small danger" onClick={() => removeLoan(l)}>Delete</button>
                </div>
              )}
            </div>
          ))}

          {/* Cash flow */}
          <CashflowPanel household={household} onSaved={refresh} readOnly={!canManageMoney}
            totals={{ salary: salaryNet, rent: netRent, personal: members.reduce((s, m) => s + (m.monthlyExpenses ?? 0), 0) }} />
        </>
      )}

      <div className="explain">
        {canManageMoney
          ? "LTV is on current market value; equity is value minus the loan secured on that asset. Solar, lifts and UPS can be recorded as components of the property they serve — their cost rolls up to the parent."
          : role === "member"
            ? "Your view — your own salary and assets, plus the household picture read-only. You can add and edit the assets attributed to you; loans and cash flow stay with the owner."
            : role === "advisor"
              ? "Advisor view — the full financial picture, read-only. You can see net worth, loans, LTV and returns, but changes stay with the owner."
              : "You have operational access: keep the asset register and property details current. Financial totals, loans and cash flow are the owner's view."}
      </div>

      {quickAdd && hhId && (
        <QuickAddSheet householdId={hhId} onClose={() => setQuickAdd(false)}
          onSaved={() => { setQuickAdd(false); refresh(); }} />
      )}
      {assetSheet.open && hhId && (
        <AssetSheet householdId={hhId} existing={assetSheet.edit} presetClass={assetSheet.presetClass} presetRented={assetSheet.presetRented} members={members} onClose={() => setAssetSheet({ open: false })} onSaved={() => { setAssetSheet({ open: false }); refresh(); }} onChanged={refresh} />
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

const RENT_DOT: Record<string, string> = { collected: "d-good", due: "d-warn", waived: "d-mut", none: "d-none" };

/** A property as a place with a story and a pulse — the register's centrepiece. */
function PropertyCard({ asset: a, pulse, loan, ownerName, canSee, canEdit, onEdit }: {
  asset: Asset; pulse?: PropertyPulse; loan: number; ownerName: string | null;
  canSee: boolean; canEdit: boolean; onEdit: () => void;
}) {
  const re = a.realEstate;
  const rented = (a.monthlyRent ?? 0) > 0;
  const ltv = a.value > 0 && loan > 0 ? (loan / a.value) * 100 : null;
  const drift = canSee && pulse?.aiMid != null && a.value > 0 ? ((pulse.aiMid - a.value) / a.value) * 100 : null;
  const needsSize = !(re?.city && re?.sqft);
  const place = [re?.locality, re?.city].filter(Boolean).join(", ");
  const how = a.acquiredHow ? a.acquiredHow.charAt(0).toUpperCase() + a.acquiredHow.slice(1) : null;
  const story = [place, how && a.acquiredYear ? `${how} ${a.acquiredYear}` : rented ? "Rented out" : "Home"].filter(Boolean).join(" · ");
  const attn = pulse ? pulse.rentStatus === "due" || pulse.openRequests > 0 : false;

  return (
    <div className={`pcard${attn ? " attn" : ""}`}>
      <Link href={`/assets/view?id=${a.id}`} className="pcard-cover">
        {pulse?.photoDataUrl
          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={pulse.photoDataUrl} alt="" />
          : <div className="mono-tile">{a.name.trim().charAt(0).toUpperCase()}</div>}
        {ownerName && <span className="pcard-owner" title={ownerName}>{ownerName.charAt(0).toUpperCase()}</span>}
      </Link>
      <div className="pcard-bd">
        <Link href={`/assets/view?id=${a.id}`} className="pcard-nm">{a.name}</Link>
        {story && <div className="pcard-story">{story}</div>}
        {canSee && (
          <div className="pcard-vrow">
            <span className="pcard-vl num">{inr(a.value)}</span>
            {drift != null && Math.abs(drift) >= 1
              ? <span className="pill p-seal" title={`AI estimate ${inr(pulse!.aiMid!)}`}>AI {drift >= 0 ? "+" : ""}{drift.toFixed(0)}%</span>
              : ltv != null ? <span className="sub">equity {inr(a.value - loan)}</span> : <span className="sub">owned</span>}
          </div>
        )}
        {rented && pulse && (
          <div className="rentdots" title="Rent — last 6 months">
            {pulse.rentDots.map((d) => <i key={d.month} className={RENT_DOT[d.status]} />)}
            <span className="cap">rent, 6 mo</span>
          </div>
        )}
        <div className="pcard-chips">
          {rented && pulse?.rentStatus === "collected" && <span className="pill p-good">rent ✓</span>}
          {rented && pulse?.rentStatus === "due" && <span className="pill p-warn">rent due</span>}
          {rented && !pulse?.rentStatus && <span className="pill p-muted">rented</span>}
          {!rented && <span className="pill p-muted">self-occupied</span>}
          {canSee && loan > 0 && <span className="pill p-warn">loan {inr(loan)}{ltv != null ? ` · ${ltv.toFixed(0)}%` : ""}</span>}
          {pulse && pulse.openRequests > 0 && <span className="pill p-acc">{pulse.openRequests} request{pulse.openRequests > 1 ? "s" : ""}</span>}
          {pulse && pulse.docCount > 0 && <span className="pill p-info">📄 {pulse.docCount}</span>}
          {canEdit && needsSize && <button className="pill p-warn chip-btn" onClick={onEdit} title="City, locality and size unlock the free AI estimate">add size → AI estimate</button>}
        </div>
      </div>
    </div>
  );
}

function CashflowPanel({ household, onSaved, readOnly = false, totals }: {
  household: Household | null; onSaved: () => void; readOnly?: boolean;
  totals: { salary: number; rent: number; personal: number };
}) {
  const [essential, setEssential] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEssential(household?.monthlyEssential != null ? String(household.monthlyEssential) : "");
  }, [household]);

  if (!household) return null;

  const shared = essential ? Number(essential) : 0;
  const spending = shared + totals.personal;
  const income = totals.salary + totals.rent;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setSaved(false);
    try {
      await api.updateHousehold(household!.id, { monthlyEssential: essential ? Number(essential) : null });
      setSaved(true); onSaved();
    } finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={save} style={{ marginTop: 18 }}>
      <h3>Monthly cash flow</h3>
      <p className="desc">
        Every person carries their own salary and spending (set on the member). The household holds only the
        shared bills — rent, groceries, utilities. Kunatra adds it all up.
      </p>
      <div className="row2">
        <div className="field">
          <label>Shared essentials (₹/mo)</label>
          <input inputMode="numeric" value={essential} disabled={readOnly} onChange={(e) => { setEssential(e.target.value); setSaved(false); }} placeholder="rent, groceries, utilities…" />
        </div>
        <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
          <div className="hint">
            Total salary <b style={{ color: "var(--ink)" }}>{inr(totals.salary)}</b>/mo{totals.rent > 0 ? <> + rent <b style={{ color: "var(--ink)" }}>{inr(totals.rent)}</b></> : null} ·
            spending <b style={{ color: "var(--ink)" }}>{inr(spending)}</b>/mo{totals.personal > 0 ? ` (${inr(shared)} shared + ${inr(totals.personal)} personal)` : ""}
            {income > 0 ? <> · keeps <b style={{ color: income - spending >= 0 ? "var(--good)" : "var(--bad)" }}>{inr(income - spending)}</b> before EMIs</> : null}
          </div>
        </div>
      </div>
      {!readOnly && (
        <div className="actions">
          <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {saved && <span style={{ color: "var(--good)", fontSize: 12.5 }}>Saved ✓</span>}
        </div>
      )}
    </form>
  );
}
