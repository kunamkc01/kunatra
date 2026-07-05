"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4100";
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const month = (iso: string) => new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const PILL: Record<string, string> = { open: "p-warn", in_progress: "p-acc", done: "p-good", cancelled: "p-muted" };

/** The tenant portal — one property, via a private magic link. No account. */
export default function TenantPage() {
  return (
    <Suspense fallback={<div />}>
      <TenantView />
    </Suspense>
  );
}

function TenantView() {
  const token = useSearchParams().get("t") ?? "";
  const [me, setMe] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", "x-tenant-token": token, ...(init?.headers ?? {}) } });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.message ?? "This link is not valid — ask your landlord for a new one.");
    }
    return res.json();
  }, [token]);

  const load = useCallback(async () => {
    try {
      const [m, r, rc, d] = await Promise.all([
        call("/api/tenant/me"), call("/api/tenant/requests"), call("/api/tenant/receipts"), call("/api/tenant/documents"),
      ]);
      setMe(m); setRequests(r); setReceipts(rc); setDocs(d); setErr(null);
    } catch (e: any) { setErr(e.message); }
  }, [call]);

  useEffect(() => { if (token) load(); else setErr("This link is missing its key — use the exact link you were sent."); }, [token, load]);

  async function raise(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setSent(false);
    try {
      await call("/api/tenant/requests", { method: "POST", body: JSON.stringify({ title: title.trim(), notes: notes.trim() || undefined }) });
      setTitle(""); setNotes(""); setSent(true); load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function download(doc: any) {
    const res = await fetch(`${BASE}/api/tenant/documents/${doc.id}/download`, { headers: { "x-tenant-token": token } });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = doc.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div className="app" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="topbar">
        <div className="brand">
          <span className="mark">K</span>
          <span className="wordmark">Kunatra</span>
          <span className="office">tenant portal</span>
        </div>
      </div>
      <div className="content">
        {err && <div className="strip bad"><span>{err}</span></div>}
        {me && (
          <>
            <div className="scr-head">
              <div>
                <h2 className="scr-title">{me.property.name}</h2>
                <div className="scr-sub">
                  {[me.property.address, me.property.locality, me.property.city].filter(Boolean).join(", ") || "Your rented home"}
                  {me.monthlyRent != null ? ` · rent ${inr(me.monthlyRent)}/mo` : ""} · hello, {me.tenantName}
                </div>
              </div>
            </div>

            <div className="panel">
              <h3>Something needs fixing?</h3>
              <form onSubmit={raise}>
                <div className="field">
                  <label>What's the problem?</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kitchen tap is leaking" />
                </div>
                <div className="field">
                  <label>Details (optional)</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Since when, how urgent…" />
                </div>
                <div className="actions">
                  <button className="btn primary small" type="submit" disabled={busy || !title.trim()}>{busy ? "Sending…" : "Send to landlord"}</button>
                  {sent && <span style={{ color: "var(--good)", fontSize: 12.5 }}>Sent — your landlord has been notified ✓</span>}
                </div>
              </form>
            </div>

            {requests.length > 0 && (
              <>
                <div className="sec-label">Your requests</div>
                {requests.map((r) => (
                  <div className="row-item" key={r.id}>
                    <div className="h">
                      <span className="t">{r.title}</span>
                      <span className={`pill ${PILL[r.status] ?? "p-info"}`}>{String(r.status).replace("_", " ")}</span>
                    </div>
                    <div className="meta">
                      raised {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      {r.scheduledFor ? ` · scheduled ${r.scheduledFor}` : ""}
                    </div>
                  </div>
                ))}
              </>
            )}

            {receipts.length > 0 && (
              <>
                <div className="sec-label">Rent receipts</div>
                {receipts.map((r) => (
                  <div className="row-item" key={r.id}>
                    <div className="h">
                      <span className="t">{month(r.periodMonth)} · {inr(r.amount)}</span>
                      <a className="btn ghost small" style={{ textDecoration: "none" }} href={`/receipts/view?id=${r.id}&t=${token}`}>Receipt</a>
                    </div>
                    <div className="meta">received {r.collectedOn ?? "—"}</div>
                  </div>
                ))}
                <div className="hint" style={{ margin: "6px 4px" }}>Open a receipt → Print / Save as PDF, for your HRA claim.</div>
              </>
            )}

            {docs.length > 0 && (
              <>
                <div className="sec-label">Your agreement</div>
                {docs.map((d) => (
                  <div className="row-item" key={d.id}>
                    <div className="h">
                      <span className="t">{d.filename}</span>
                      <button className="btn ghost small" onClick={() => download(d)}>Download</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        <p className="foot" style={{ marginTop: 24 }}>Powered by Kunatra · this private link shows only your home — keep it to yourself.</p>
      </div>
    </div>
  );
}
