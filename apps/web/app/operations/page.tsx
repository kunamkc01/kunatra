"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api, currentHouseholdId,
  type Asset, type Vendor, type WorkOrder, type Inspection, type WorkOrderStatus,
} from "@/lib/api";
import { inr } from "@/lib/format";
import { TopBar } from "@/components/TopBar";
import { WorkOrderSheet } from "@/components/WorkOrderSheet";
import { VendorSheet } from "@/components/VendorSheet";
import { InspectionSheet } from "@/components/InspectionSheet";

type Tab = "work" | "vendors" | "inspections";
const CAT_LABEL: Record<string, string> = { repair: "Repair", maintenance: "Maintenance", amc: "AMC", improvement: "Improvement", other: "Other" };

export default function Operations() {
  const [ready, setReady] = useState(false);
  const [hhId, setHhId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("work");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [woSheet, setWoSheet] = useState<{ open: boolean; edit?: WorkOrder | null }>({ open: false });
  const [vendorSheet, setVendorSheet] = useState<{ open: boolean; edit?: Vendor | null }>({ open: false });
  const [inspSheet, setInspSheet] = useState(false);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try {
      const [a, v, w, i] = await Promise.all([
        api.listAssets(id), api.listVendors(id), api.listWorkOrders(id), api.listInspections(id),
      ]);
      setAssets(a); setVendors(v); setWorkOrders(w); setInspections(i);
    } catch (e: any) {
      setErr(e.message ?? "Could not load");
    }
  }, []);

  useEffect(() => {
    const id = currentHouseholdId();
    setHhId(id); setReady(true);
    if (id) load(id);
  }, [load]);

  const refresh = () => { if (hhId) load(hhId); };

  async function transition(wo: WorkOrder, status: WorkOrderStatus) {
    try {
      if (status === "done" && wo.actualCost == null) {
        // The closure gate: capture an actual cost before closing.
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

  async function removeWo(wo: WorkOrder) {
    if (!confirm(`Delete work order "${wo.title}"?`)) return;
    await api.deleteWorkOrder(wo.id); refresh();
  }
  async function removeVendor(v: Vendor) {
    if (!confirm(`Delete vendor "${v.name}"?`)) return;
    await api.deleteVendor(v.id); refresh();
  }
  async function removeInspection(i: Inspection) {
    if (!confirm(`Delete this inspection?`)) return;
    await api.deleteInspection(i.id); refresh();
  }

  if (!ready) return <main className="app wide" />;
  if (!hhId) {
    return (
      <main className="app wide">
        <TopBar />
        <div className="empty">No household yet. <Link href="/" className="navlink">Set one up →</Link></div>
      </main>
    );
  }

  const active = workOrders.filter((w) => w.status === "open" || w.status === "in_progress").length;

  return (
    <main className="app wide">
      <TopBar right={<Link href="/" className="navlink">← Mirror</Link>} />

      <div className="sec" style={{ marginTop: 0, fontSize: 20, fontFamily: "var(--serif)", color: "var(--navy)", fontWeight: 600 }}>
        Asset operations
      </div>
      <p className="desc" style={{ margin: "0 4px 12px", color: "var(--slate)", fontSize: 13 }}>
        Keep the upkeep honest — work orders, vendors and inspections that feed back into your sky view.
      </p>

      <div className="tabs">
        <button className={`tab ${tab === "work" ? "active" : ""}`} onClick={() => setTab("work")}>Work orders{active ? ` (${active})` : ""}</button>
        <button className={`tab ${tab === "vendors" ? "active" : ""}`} onClick={() => setTab("vendors")}>Vendors</button>
        <button className={`tab ${tab === "inspections" ? "active" : ""}`} onClick={() => setTab("inspections")}>Inspections</button>
      </div>

      {err && <div className="err" style={{ padding: "0 4px" }}>{err}</div>}

      {/* WORK ORDERS */}
      {tab === "work" && (
        <>
          <div className="sec">Work orders<button className="btn small primary" onClick={() => setWoSheet({ open: true, edit: null })}>+ New</button></div>
          {workOrders.length === 0 && <div className="empty">No work orders. Raise one for a repair or AMC.</div>}
          {workOrders.map((w) => (
            <div className="wo" key={w.id}>
              <div className="h">
                <span className="t">{w.title}</span>
                <span className={`pill s-${w.status}`}>{w.status.replace("_", " ")}</span>
              </div>
              <div className="meta">
                {CAT_LABEL[w.category]}
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

      {/* VENDORS */}
      {tab === "vendors" && (
        <>
          <div className="sec">Vendors<button className="btn small primary" onClick={() => setVendorSheet({ open: true, edit: null })}>+ Add</button></div>
          {vendors.length === 0 && <div className="empty">No vendors yet.</div>}
          {vendors.map((v) => (
            <div className="wo" key={v.id}>
              <div className="h">
                <span className="t">{v.name}</span>
                {v.category && <span className="pill">{v.category}</span>}
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

      {/* INSPECTIONS */}
      {tab === "inspections" && (
        <>
          <div className="sec">Inspections<button className="btn small primary" onClick={() => setInspSheet(true)}>+ Log</button></div>
          {inspections.length === 0 && <div className="empty">No inspections logged. Run condition checks so decline shows early.</div>}
          {inspections.map((i) => (
            <div className="wo" key={i.id}>
              <div className="h">
                <span className="t">{i.assetName ?? "General"} · {i.inspectedOn}</span>
                <span className={`pill r-${i.rating}`}>{i.rating}</span>
              </div>
              {i.notes && <div className="meta">{i.notes}</div>}
              <div className="acts">
                <button className="btn ghost small danger" onClick={() => removeInspection(i)}>Delete</button>
              </div>
            </div>
          ))}
        </>
      )}

      {woSheet.open && hhId && (
        <WorkOrderSheet householdId={hhId} existing={woSheet.edit} assets={assets} vendors={vendors}
          onClose={() => setWoSheet({ open: false })} onSaved={() => { setWoSheet({ open: false }); refresh(); }} />
      )}
      {vendorSheet.open && hhId && (
        <VendorSheet householdId={hhId} existing={vendorSheet.edit}
          onClose={() => setVendorSheet({ open: false })} onSaved={() => { setVendorSheet({ open: false }); refresh(); }} />
      )}
      {inspSheet && hhId && (
        <InspectionSheet householdId={hhId} assets={assets}
          onClose={() => setInspSheet(false)} onSaved={() => { setInspSheet(false); refresh(); }} />
      )}
    </main>
  );
}
