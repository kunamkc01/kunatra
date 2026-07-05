"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type TenantInfo } from "@/lib/api";

/** Owner-side tenant access for a rented property: invite, share link, revoke. */
export function TenantPanel({ assetId }: { assetId: string }) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api.getTenant(assetId).then((t) => { setTenant(t); setLoaded(true); }).catch(() => setLoaded(true)), [assetId]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const t = await api.setTenant(assetId, { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined });
      setTenant(t); setName(""); setEmail(""); setPhone("");
    } catch (e: any) { setErr(e.message ?? "Could not invite"); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!confirm("Revoke this tenant's portal link? Their access stops immediately.")) return;
    try { await api.revokeTenant(assetId); load(); }
    catch (e: any) { setErr(e.message ?? "Could not revoke"); }
  }

  if (!loaded) return null;

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Tenant access</div>
      {tenant && !tenant.revoked ? (
        <>
          <div style={{ fontSize: 13.5 }}>
            <b>{tenant.name}</b>
            <span className="muted">{tenant.email ? ` · ${tenant.email}` : ""}{tenant.phone ? ` · ${tenant.phone}` : ""}</span>
          </div>
          <div className="hint" style={{ margin: "6px 0" }}>
            Their private link lets them raise maintenance requests and download rent receipts — nothing else.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 11, background: "var(--tint)", padding: "4px 8px", borderRadius: 6, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tenant.link}</code>
            <button className="btn ghost small" type="button" onClick={() => { navigator.clipboard.writeText(tenant.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <button className="btn ghost small danger" type="button" onClick={revoke}>Revoke</button>
          </div>
        </>
      ) : (
        <form onSubmit={invite}>
          {tenant?.revoked && <div className="hint" style={{ marginBottom: 6 }}>Previous access was revoked — inviting again issues a fresh link.</div>}
          <div className="row2">
            <div className="field"><label>Tenant name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arjun Mehta" /></div>
            <div className="field"><label>Email (sends them the link)</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" /></div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="btn small primary" type="submit" disabled={busy || !name.trim()}>{busy ? "…" : "Invite tenant"}</button>
            </div>
          </div>
          {err && <div className="err">{err}</div>}
        </form>
      )}
    </div>
  );
}
