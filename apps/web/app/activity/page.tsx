"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type AuditEntry } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Activity() {
  const { user, ready } = useAuth({ requireRole: "owner" });
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try { setEntries(await api.listAudit(id)); }
    catch (e: any) { setErr(e.message ?? "Could not load"); }
  }, []);

  useEffect(() => { if (ready && user) load(user.householdId); }, [ready, user, load]);

  if (!ready) return <Shell><div /></Shell>;

  return (
    <Shell>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Activity</h2>
          <div className="scr-sub">Every change records who did it and when — so delegation stays safe and nothing is silent.</div>
        </div>
      </div>

      {err && <div className="strip bad">{err}</div>}
      {entries.length === 0 && <div className="empty">No activity yet.</div>}

      <div className="scroll">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Did</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{when(e.createdAt)}</td>
                <td>
                  <span style={{ fontWeight: 500 }}>{e.actorEmail ?? "—"}</span>
                  {e.actorRole && <span className={`pill ${e.actorRole === "owner" ? "p-acc" : "p-good"}`} style={{ marginLeft: 6 }}>{e.actorRole}</span>}
                </td>
                <td>
                  {e.action} {e.entityType}
                  {e.label ? <span className="muted"> · {e.label}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
