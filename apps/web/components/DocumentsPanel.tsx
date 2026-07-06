"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type VaultDocument, type DocKind } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  agreement: "Rental agreement", maintenance_bill: "Maintenance bill", invoice: "Invoice / receipt",
  sale_deed: "Sale deed", title_deed: "Title deed", encumbrance_certificate: "EC",
  allotment_letter: "Allotment letter", occupancy_certificate: "OC", tax_receipt: "Tax receipt",
  insurance: "Insurance", loan_schedule: "Loan schedule", other: "Other",
};
const UPLOAD_KINDS: DocKind[] = ["agreement", "maintenance_bill", "invoice", "sale_deed", "tax_receipt", "insurance", "other"];

const fmtSize = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

/** The vault, per asset: agreements, bills, receipts — private, RBAC-gated. */
export function DocumentsPanel({ assetId, canEdit, flat = false }: { assetId: string; canEdit: boolean; flat?: boolean }) {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [kind, setKind] = useState<DocKind>("agreement");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.listAssetDocuments(assetId).then(setDocs).catch(() => {}), [assetId]);
  useEffect(() => { load(); }, [load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr("Documents are capped at 10MB."); return; }
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(f);
      await api.uploadDocument(assetId, { name: f.name, kind, dataUrl });
      load();
    } catch (e: any) { setErr(e.message ?? "Could not upload"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function download(d: VaultDocument) {
    try {
      const { blob, filename } = await api.downloadDocument(d.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename || d.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { setErr(e.message ?? "Could not download"); }
  }

  async function remove(d: VaultDocument) {
    if (!confirm(`Delete "${d.filename}"? This can't be undone.`)) return;
    try { await api.deleteDocument(d.id); load(); }
    catch (e: any) { setErr(e.message ?? "Could not delete"); }
  }

  return (
    <div style={flat ? undefined : { marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Documents</div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as DocKind)} style={{ maxWidth: 190 }}>
            {UPLOAD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <button className="btn small" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Uploading…" : "+ Upload"}
          </button>
          <span className="hint">PDF or image · up to 10MB · stored privately</span>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={onPick} />
        </div>
      )}
      {err && <div className="err" style={{ marginBottom: 6 }}>{err}</div>}
      {docs.length === 0 && <div className="hint">Rental agreements, maintenance bills, tax receipts — the paperwork lives with the property.</div>}
      {docs.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="pill p-info">{KIND_LABEL[d.kind] ?? d.kind}</span>
          <button type="button" onClick={() => download(d)}
            style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--accent)", textAlign: "left", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.filename}
          </button>
          <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
            {fmtSize(d.size)} · {new Date(d.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </span>
          {canEdit && <button className="btn ghost small danger" type="button" onClick={() => remove(d)}>✕</button>}
        </div>
      ))}
    </div>
  );
}
