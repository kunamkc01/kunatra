"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type Asset, type Vendor, type WorkOrder, type Inspection, type Household, type OperationsSummary, type WorkOrderStatus, type ComplianceItem, type Approval,
} from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr } from "@/lib/format";
import { Shell } from "@/components/Shell";
import { WorkOrderSheet } from "@/components/WorkOrderSheet";
import { VendorSheet } from "@/components/VendorSheet";
import { InspectionSheet } from "@/components/InspectionSheet";
import { ComplianceSheet } from "@/components/ComplianceSheet";
import { ApprovalSheet } from "@/components/ApprovalSheet";

type Tab = "work" | "vendors" | "inspections" | "compliance" | "requests";
const APPROVAL_PILL: Record<string, string> = { pending: "p-warn", approved: "p-good", rejected: "p-bad" };
const KIND_LABEL: Record<string, string> = { property_tax: "Property tax", insurance: "Insurance", amc: "AMC", inspection: "Inspection", renewal: "Renewal", other: "Other" };
function dueClass(dueOn: string): { pill: string; text: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueOn}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { pill: "p-bad", text: `${-days}d overdue` };
  if (days <= 30) return { pill: "p-warn", text: days === 0 ? "due today" : `in ${days}d` };
  return { pill: "p-good", text: `in ${days}d` };
}
const CAT_LABEL: Record<string, string> = { repair: "Repair", maintenance: "Maintenance", amc: "AMC", improvement: "Improvement", other: "Other" };
const WO_PILL: Record<string, string> = { open: "p-warn", in_progress: "p-acc", done: "p-good", cancelled: "p-muted" };
const RATING_PILL: Record<string, string> = { good: "p-good", fair: "p-warn", poor: "p-bad" };
const RATING_TILE: Record<string, string> = { good: "g", fair: "w", poor: "b" };

export default function Operations() {
  const { user, ready } = useAuth();
  const hhId = user?.householdId ?? null;
  const isOwner = user?.role === "owner";
  const [household, setHousehold] = useState<Household | null>(null);
  const [tab, setTab] = useState<Tab>("work");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [compliance, setCompliance] = useState<ComplianceItem[]>([]);
  const [requests, setRequests] = useState<Approval[]>([]);
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [woSheet, setWoSheet] = useState<{ open: boolean; edit?: WorkOrder | null }>({ open: false });
  const [vendorSheet, setVendorSheet] = useState<{ open: boolean; edit?: Vendor | null }>({ open: false });
  const [inspSheet, setInspSheet] = useState(false);
  const [compSheet, setCompSheet] = useState(false);
  const [reqSheet, setReqSheet] = useState(false);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [hh, a, v, w, i, s, c, r] = await Promise.all([
        api.getHousehold(id), api.listAssets(id), api.listVendors(id), api.listWorkOrders(id), api.listInspections(id), api.operationsSummary(id), api.listCompliance(id), api.listApprovals(id),
      ]);
      setHousehold(hh); setAssets(a); setVendors(v); setWorkOrders(w); setInspections(i); setSummary(s); setCompliance(c); setRequests(r);
    } catch (e: any) {
      setErr(e.message ?? "Could not load");
    }
  }, []);

  useEffect(() => {
    if (ready && user) load(user.householdId);
  }, [ready, user, load]);

  const refresh = () => { if (hhId) load(hhId); };

  async function transition(wo: WorkOrder, status: WorkOrderStatus) {
    try {
      if (status === "done" && wo.actualCost == null) {
        const entered = window.prompt(`Actual cost for "${wo.title}" (₹)?`, wo.estimatedCost != null ? String(wo.estimatedCost) : "");
        if (entered == null) return;
        const cost = Number(entered);
        if (!Number.isFinite(cost) || cost < 0) { alert("Enter a valid amount."); return; }
        await api.updateWorkOrder(wo.id, { status: "done", actualCost: cost });
      } else {
        await api.updateWorkOrder(wo.id, { status });
      }
      refresh();
    } catch (e: any) {
      alert(e.message ?? "Could not update");
    }
  }

  async function removeWo(wo: WorkOrder) { if (confirm(`Delete work order "${wo.title}"?`)) { await api.deleteWorkOrder(wo.id); refresh(); } }
  async function removeVendor(v: Vendor) { if (confirm(`Delete vendor "${v.name}"?`)) { await api.deleteVendor(v.id); refresh(); } }
  async function removeInspection(i: Inspection) { if (confirm(`Delete this inspection?`)) { await api.deleteInspection(i.id); refresh(); } }
  async function completeCompliance(c: ComplianceItem) {
    const msg = c.recurrence === "none" ? `Mark "${c.title}" done? It will be removed.` : `Mark "${c.title}" done and roll it to the next ${c.recurrence.replace("ly", "")}?`;
    if (!confirm(msg)) return;
    await api.completeCompliance(c.id); refresh();
  }
  async function removeCompliance(c: ComplianceItem) { if (confirm(`Delete "${c.title}"?`)) { await api.deleteCompliance(c.id); refresh(); } }
  async function decide(r: Approval, decision: "approved" | "rejected") {
    const note = window.prompt(`${decision === "approved" ? "Approve" : "Reject"} "${r.title}"? Add a note (optional):`, "");
    if (note === null) return;
    try { await api.decideApproval(r.id, { decision, note: note || undefined }); refresh(); }
    catch (e: any) { alert(e.message ?? "Could not decide"); }
  }
  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  if (!ready) return <Shell><div /></Shell>;
  if (!hhId) {
    return <Shell><div className="empty">No household yet. <Link href="/" style={{ color: "var(--accent)" }}>Set one up →</Link></div></Shell>;
  }

  return (
    <Shell office={household?.displayName}>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Operations today</h2>
          <div className="scr-sub">Keep the upkeep honest — work orders, vendors and inspections that feed back into your sky view.</div>
        </div>
      </div>

      {err && <div className="strip bad">{err}</div>}

      {summary && (
        <div className="tiles" style={{ marginBottom: 20 }}>
          <div className={`tile ${summary.workOrders.active > 0 ? "w" : "g"}`}><div className="tv num">{summary.workOrders.active}</div><div className="tl">Open work orders</div></div>
          <div className="tile acc"><div className="tv num">{summary.workOrders.inProgress}</div><div className="tl">In progress</div></div>
          <div className="tile"><div className="tv num" style={{ fontSize: 22 }}>{inr(summary.maintenanceSpendYtd)}</div><div className="tl">Maintenance (YTD)</div></div>
          <div className="tile"><div className="tv num">{summary.vendors}</div><div className="tl">Vendors</div></div>
          <div className={`tile ${summary.lastInspection ? RATING_TILE[summary.lastInspection.rating] : ""}`}>
            <div className="tv num" style={{ fontSize: 20, textTransform: "capitalize" }}>{summary.lastInspection ? summary.lastInspection.rating : "—"}</div>
            <div className="tl">Last inspection</div>
          </div>
        </div>
      )}

      <div className="subtabs">
        <button className={`subtab ${tab === "work" ? "active" : ""}`} onClick={() => setTab("work")}>Work orders</button>
        <button className={`subtab ${tab === "vendors" ? "active" : ""}`} onClick={() => setTab("vendors")}>Vendors</button>
        <button className={`subtab ${tab === "inspections" ? "active" : ""}`} onClick={() => setTab("inspections")}>Inspections</button>
        <button className={`subtab ${tab === "compliance" ? "active" : ""}`} onClick={() => setTab("compliance")}>Compliance</button>
        <button className={`subtab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>Requests{pendingRequests ? ` (${pendingRequests})` : ""}</button>
      </div>

      {tab === "work" && (
        <>
          <div className="sec-label">Work orders<button className="btn small primary" onClick={() => setWoSheet({ open: true, edit: null })}>+ New</button></div>
          {workOrders.length === 0 && <div className="empty">No work orders. Raise one for a repair or AMC.</div>}
          {workOrders.map((w) => (
            <div className="row-item" key={w.id}>
              <div className="h">
                <span className="t">{w.title}</span>
                <span className={`pill ${WO_PILL[w.status]}`}>{w.status.replace("_", " ")}</span>
              </div>
              <div className="meta">
                {CAT_LABEL[w.category]}
                {w.recurrence !== "none" ? ` · repeats ${w.recurrence}` : ""}
                {w.assetName ? ` · ${w.assetName}` : ""}
                {w.vendorName ? ` · ${w.vendorName}` : ""}
                {w.scheduledFor ? ` · due ${w.scheduledFor}` : ""}
                {w.actualCost != null ? ` · cost ${inr(w.actualCost)}` : w.estimatedCost != null ? ` · est. ${inr(w.estimatedCost)}` : ""}
              </div>
              <div className="acts">
                {w.status === "open" && <button className="btn small" onClick={() => transition(w, "in_progress")}>Start</button>}
                {w.status === "in_progress" && <button className="btn small primary" onClick={() => transition(w, "done")}>Complete</button>}
                {(w.status === "open" || w.status === "in_progress") && <button className="btn small" onClick={() => transition(w, "cancelled")}>Cancel</button>}
                {w.status === "done" && <button className="btn small" onClick={() => transition(w, "in_progress")}>Reopen</button>}
                {w.status === "cancelled" && <button className="btn small" onClick={() => transition(w, "open")}>Reopen</button>}
                <button className="btn ghost small" onClick={() => setWoSheet({ open: true, edit: w })}>Edit</button>
                <button className="btn ghost small danger" onClick={() => removeWo(w)}>Delete</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "vendors" && (
        <>
          <div className="sec-label">Vendors<button className="btn small primary" onClick={() => setVendorSheet({ open: true, edit: null })}>+ Add</button></div>
          {vendors.length === 0 && <div className="empty">No vendors yet.</div>}
          {vendors.map((v) => (
            <div className="row-item" key={v.id}>
              <div className="h">
                <span className="t">{v.name}</span>
                {v.category && <span className="pill p-acc">{v.category}</span>}
              </div>
              <div className="meta">{v.phone ? `☎ ${v.phone}` : "No phone"}{v.notes ? ` · ${v.notes}` : ""}</div>
              <div className="acts">
                <button className="btn ghost small" onClick={() => setVendorSheet({ open: true, edit: v })}>Edit</button>
                <button className="btn ghost small danger" onClick={() => removeVendor(v)}>Delete</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "inspections" && (
        <>
          <div className="sec-label">Inspections<button className="btn small primary" onClick={() => setInspSheet(true)}>+ Log</button></div>
          {inspections.length === 0 && <div className="empty">No inspections logged. Run condition checks so decline shows early.</div>}
          {inspections.map((i) => (
            <div className="row-item" key={i.id}>
              <div className="h">
                <span className="t">{i.assetName ?? "General"} · {i.inspectedOn}</span>
                <span className={`pill ${RATING_PILL[i.rating]}`}>{i.rating}</span>
              </div>
              {i.notes && <div className="meta">{i.notes}</div>}
              <div className="acts"><button className="btn ghost small danger" onClick={() => removeInspection(i)}>Delete</button></div>
            </div>
          ))}
        </>
      )}

      {tab === "compliance" && (
        <>
          <div className="sec-label">Compliance calendar<button className="btn small primary" onClick={() => setCompSheet(true)}>+ Add due date</button></div>
          {compliance.length === 0 && <div className="empty">No due dates. Add property tax, insurance, AMC or inspection deadlines so nothing slips.</div>}
          {compliance.map((c) => {
            const d = dueClass(c.dueOn);
            return (
              <div className="row-item" key={c.id}>
                <div className="h">
                  <span className="t">{c.title}</span>
                  <span className={`pill ${d.pill}`}>{d.text}</span>
                </div>
                <div className="meta">
                  {KIND_LABEL[c.kind]} · due {c.dueOn}
                  {c.recurrence !== "none" ? ` · ${c.recurrence}` : ""}
                  {c.assetName ? ` · ${c.assetName}` : ""}
                </div>
                <div className="acts">
                  <button className="btn small primary" onClick={() => completeCompliance(c)}>Mark done</button>
                  <button className="btn ghost small danger" onClick={() => removeCompliance(c)}>Delete</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === "requests" && (
        <>
          <div className="sec-label">
            {isOwner ? "Approval requests" : "My requests"}
            <button className="btn small primary" onClick={() => setReqSheet(true)}>+ Raise a request</button>
          </div>
          {requests.length === 0 && <div className="empty">{isOwner ? "No requests. Operations teammates can raise spends/changes for you to approve." : "No requests yet. Propose a spend or change for the owner to approve."}</div>}
          {requests.map((r) => (
            <div className="row-item" key={r.id}>
              <div className="h">
                <span className="t">{r.title}{r.amount != null ? ` · ${inr(r.amount)}` : ""}</span>
                <span className={`pill ${APPROVAL_PILL[r.status]}`}>{r.status}</span>
              </div>
              <div className="meta">
                by {r.requestedBy ?? "—"}
                {r.note ? ` · ${r.note}` : ""}
                {r.status !== "pending" && r.decidedBy ? ` · ${r.status} by ${r.decidedBy}${r.decisionNote ? ` (“${r.decisionNote}”)` : ""}` : ""}
              </div>
              {isOwner && r.status === "pending" && (
                <div className="acts">
                  <button className="btn small primary" onClick={() => decide(r, "approved")}>Approve</button>
                  <button className="btn small danger" onClick={() => decide(r, "rejected")}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {woSheet.open && hhId && (
        <WorkOrderSheet householdId={hhId} existing={woSheet.edit} assets={assets} vendors={vendors} onClose={() => setWoSheet({ open: false })} onSaved={() => { setWoSheet({ open: false }); refresh(); }} />
      )}
      {vendorSheet.open && hhId && (
        <VendorSheet householdId={hhId} existing={vendorSheet.edit} onClose={() => setVendorSheet({ open: false })} onSaved={() => { setVendorSheet({ open: false }); refresh(); }} />
      )}
      {inspSheet && hhId && (
        <InspectionSheet householdId={hhId} assets={assets} onClose={() => setInspSheet(false)} onSaved={() => { setInspSheet(false); refresh(); }} />
      )}
      {compSheet && hhId && (
        <ComplianceSheet householdId={hhId} assets={assets} onClose={() => setCompSheet(false)} onSaved={() => { setCompSheet(false); refresh(); }} />
      )}
      {reqSheet && hhId && (
        <ApprovalSheet householdId={hhId} onClose={() => setReqSheet(false)} onSaved={() => { setReqSheet(false); refresh(); }} />
      )}
    </Shell>
  );
}
