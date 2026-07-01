"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type User, type Role } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";

export default function Team() {
  const { user, ready } = useAuth({ requireRole: "owner" });
  const [users, setUsers] = useState<User[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (id: string) => {
    setErr(null);
    try { setUsers(await api.listUsers(id)); }
    catch (e: any) { setErr(e.message ?? "Could not load"); }
  }, []);

  useEffect(() => { if (ready && user) load(user.householdId); }, [ready, user, load]);

  async function removeUser(u: User) {
    if (!confirm(`Remove ${u.email}? They'll lose access immediately.`)) return;
    try { await api.deleteUser(u.id); if (user) load(user.householdId); }
    catch (e: any) { alert(e.message ?? "Could not remove"); }
  }

  if (!ready) return <Shell><div /></Shell>;

  return (
    <Shell>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Team & access</h2>
          <div className="scr-sub">Owners see everything and make the decisions. Operations teammates handle upkeep — assets, work orders, vendors and inspections — with financial totals hidden.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add teammate</button>
      </div>

      {err && <div className="strip bad">{err}</div>}

      {users.map((u) => (
        <div className="row-item" key={u.id}>
          <div className="h">
            <span className="t">{u.fullName || u.email}</span>
            <span className={`pill ${u.role === "owner" ? "p-acc" : "p-good"}`}>{u.role}</span>
          </div>
          <div className="meta">
            {u.email}
            {u.id === user?.id ? " · you" : ""}
          </div>
          {u.id !== user?.id && (
            <div className="acts"><button className="btn ghost small danger" onClick={() => removeUser(u)}>Remove</button></div>
          )}
        </div>
      ))}

      <div className="explain">
        Operations teammates work at the asset level, not the net-worth level. Buying, selling, borrowing, cash-flow and
        team changes stay with owners. Everyone only ever sees this household's data.
      </div>

      {adding && user && (
        <AddTeammate householdId={user.householdId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(user.householdId); }} />
      )}
    </Shell>
  );
}

function AddTeammate({ householdId, onClose, onSaved }: { householdId: string; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operations");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createUser(householdId, { email: email.trim(), password, fullName: fullName.trim() || undefined, role });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not add"); setBusy(false);
    }
  }

  // Inline sheet (reuses the modal styles).
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Add a teammate</h3>
        <form onSubmit={submit}>
          <div className="field"><label>Name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ravi (operations)" autoFocus /></div>
          <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" /></div>
          <div className="row2">
            <div className="field"><label>Temp password</label><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="operations">Operations</option>
                <option value="owner">Owner</option>
              </select>
              <div className="hint">Operations: upkeep only, no financials</div>
            </div>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add teammate"}</button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
