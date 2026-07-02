"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type User, type Role, type Member } from "@/lib/api";

const roleName = (r: Role) =>
  r === "owner" ? "Owner"
  : r === "manager" ? "Manager"
  : r === "member" ? "Member"
  : r === "advisor" ? "Advisor"
  : "Operations";
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
  async function resetPw(u: User) {
    const pw = window.prompt(`Set a new password for ${u.email} (they can change it after signing in):`, "");
    if (!pw) return;
    try { await api.resetTeammatePassword(u.id, pw); alert(`Password updated for ${u.email}.`); }
    catch (e: any) { alert(e.message ?? "Could not reset"); }
  }

  if (!ready) return <Shell><div /></Shell>;

  return (
    <Shell>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Team & access</h2>
          <div className="scr-sub">Owners see everything and make the decisions. Managers manage the money on your behalf (but can't change the team). Members manage only their own salary and assets. Operations teammates handle upkeep, with financial totals hidden.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add teammate</button>
      </div>

      {err && <div className="strip bad">{err}</div>}

      {users.map((u) => (
        <div className="row-item" key={u.id}>
          <div className="h">
            <span className="t">{u.fullName || u.email}</span>
            <span className={`pill ${u.role === "owner" ? "p-acc" : u.role === "operations" ? "p-good" : "p-info"}`}>{roleName(u.role)}</span>
          </div>
          <div className="meta">
            {u.email}
            {u.role === "member" && u.memberName ? ` · manages ${u.memberName}` : ""}
            {u.id === user?.id ? " · you" : ""}
          </div>
          {u.id !== user?.id && (
            <div className="acts">
              <button className="btn ghost small" onClick={() => resetPw(u)}>Reset password</button>
              <button className="btn ghost small danger" onClick={() => removeUser(u)}>Remove</button>
            </div>
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

const ROLE_HINT: Record<Role, string> = {
  owner: "Full access, including the team.",
  manager: "Manages the money on your behalf — assets, loans, cash flow, approvals. Can't change the team or delete the household.",
  member: "Manages only their own salary and assets; sees the household read-only.",
  operations: "Upkeep only — work orders, vendors, inspections. Financial totals hidden.",
  advisor: "Sees the money, can't change anything.",
};

function AddTeammate({ householdId, onClose, onSaved }: { householdId: string; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operations");
  const [memberId, setMemberId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listMembers(householdId).then(setMembers).catch(() => setMembers([])); }, [householdId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "member" && !memberId) { setErr("Pick which person this member manages."); return; }
    setBusy(true); setErr(null);
    try {
      await api.createUser(householdId, {
        email: email.trim(),
        password: password || undefined,
        fullName: fullName.trim() || undefined,
        role,
        memberId: role === "member" ? memberId : undefined,
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not add"); setBusy(false);
    }
  }

  // Inline sheet (reuses the modal styles).
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Give someone access</h3>
        <form onSubmit={submit}>
          <div className="field"><label>Name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya" autoFocus /></div>
          <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" /></div>
          <div className="row2">
            <div className="field"><label>Temp password</label><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New logins only — 6+ chars" /></div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member — own salary & assets</option>
                <option value="manager">Manager — manages the money</option>
                <option value="operations">Operations — upkeep only</option>
                <option value="advisor">Advisor — read-only financials</option>
                <option value="owner">Owner — full access</option>
              </select>
            </div>
          </div>
          {role === "member" && (
            <div className="field">
              <label>Which person do they manage?</label>
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Select a person…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <div className="hint">They'll only see and edit this person's salary and assets. Add people on the Assets page first.</div>
            </div>
          )}
          <div className="hint">{ROLE_HINT[role]}</div>
          <div className="hint">Already have an account? Adding them here just grants access to this household — leave the password blank.</div>
          {err && <div className="err">{err}</div>}
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Grant access"}</button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
