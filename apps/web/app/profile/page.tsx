"use client";
import { useEffect, useRef, useState } from "react";
import { api, getUser, setStoredUser, type User, type Member } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { inr } from "@/lib/format";
import { Shell } from "@/components/Shell";

/** Resize a chosen image to a small square data URL (keeps avatars tiny). */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d")!;
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const { user, ready } = useAuth();
  const [me, setMe] = useState<User | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // password
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [pwMsg, setPwMsg] = useState<string | null>(null); const [pwErr, setPwErr] = useState<string | null>(null); const [pwBusy, setPwBusy] = useState(false);

  // household name (owner)
  const [hhName, setHhName] = useState(""); const [hhMsg, setHhMsg] = useState<string | null>(null); const [hhErr, setHhErr] = useState<string | null>(null); const [hhBusy, setHhBusy] = useState(false);

  // your salary & spending (the person linked to this login)
  const [person, setPerson] = useState<Member | null>(null);
  const [gross, setGross] = useState(""); const [tds, setTds] = useState(""); const [spend, setSpend] = useState("");
  const [payMsg, setPayMsg] = useState<string | null>(null); const [payErr, setPayErr] = useState<string | null>(null); const [payBusy, setPayBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api.me().then((u) => { setMe(u); setFullName(u.fullName ?? ""); setPhone(u.phone ?? ""); setAvatar(u.avatar ?? null); }).catch(() => setMe(getUser()));
  }, [ready]);

  useEffect(() => {
    if (!ready || !user || user.role !== "owner") return;
    api.getHousehold(user.householdId).then((h) => setHhName(h.displayName)).catch(() => {});
  }, [ready, user]);

  // Load the person this login is linked to (owners and members have one).
  useEffect(() => {
    if (!ready || !user?.memberId) return;
    api.listMembers(user.householdId).then((ms) => {
      const p = ms.find((m) => m.id === user.memberId) ?? null;
      setPerson(p);
      if (p) {
        setGross(p.monthlyGross != null ? String(p.monthlyGross) : "");
        setTds(p.monthlyTds != null ? String(p.monthlyTds) : "");
        setSpend(p.monthlyExpenses != null ? String(p.monthlyExpenses) : "");
      }
    }).catch(() => {});
  }, [ready, user]);

  async function savePay(e: React.FormEvent) {
    e.preventDefault();
    if (!person) return;
    setPayBusy(true); setPayErr(null); setPayMsg(null);
    try {
      await api.updateMember(person.id, {
        monthlyGross: gross ? Number(gross) : null,
        monthlyTds: tds ? Number(tds) : null,
        monthlyExpenses: spend ? Number(spend) : null,
      });
      setPayMsg("Saved ✓");
    } catch (e: any) { setPayErr(e.message ?? "Could not save"); }
    finally { setPayBusy(false); }
  }

  async function saveHousehold(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setHhBusy(true); setHhErr(null); setHhMsg(null);
    try {
      await api.updateHousehold(user.householdId, { displayName: hhName.trim() });
      // Refresh the session so the top-bar label and the household switcher update.
      const refreshed = await api.me();
      setMe(refreshed); setStoredUser(refreshed);
      setHhMsg("Saved ✓");
    } catch (e: any) { setHhErr(e.message ?? "Could not save"); }
    finally { setHhBusy(false); }
  }

  async function persist(patch: { fullName?: string; avatar?: string | null; phone?: string | null }) {
    setErr(null); setSavedMsg(null);
    try {
      const u = await api.updateProfile(patch);
      setMe(u); setStoredUser(u); setSavedMsg("Saved ✓");
    } catch (e: any) { setErr(e.message ?? "Could not save"); }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataUrl = await fileToAvatar(f);
      setAvatar(dataUrl);
      await persist({ avatar: dataUrl });
    } catch { setErr("Could not read that image"); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true); setPwErr(null); setPwMsg(null);
    try {
      await api.changePassword({ currentPassword: cur, newPassword: nw });
      setCur(""); setNw(""); setPwMsg("Password changed ✓");
    } catch (e: any) { setPwErr(e.message ?? "Could not change password"); }
    finally { setPwBusy(false); }
  }

  if (!ready || !me) return <Shell><div /></Shell>;
  const initial = (me.fullName || me.email).charAt(0).toUpperCase();

  return (
    <Shell office={undefined}>
      <div className="scr-head"><div><h2 className="scr-title">Your profile</h2><div className="scr-sub">{me.email} · {me.role}</div></div></div>

      {err && <div className="strip bad">{err}</div>}

      <div className="panel">
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {avatar
            ? <img className="avatar-lg" src={avatar} alt="" />
            : <span className="avatar-lg avatar-fallback" style={{ fontSize: 28 }}>{initial}</span>}
          <div>
            <button className="btn small" type="button" onClick={() => fileRef.current?.click()}>Change picture</button>
            {avatar && <button className="btn ghost small danger" type="button" onClick={() => { setAvatar(null); persist({ avatar: null }); }}>Remove</button>}
            <div className="hint" style={{ marginTop: 6 }}>A square image works best; it's shrunk to a small thumbnail.</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickFile} />
          </div>
        </div>
        <div className="row2" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Name</label>
            <input value={fullName} onChange={(e) => { setFullName(e.target.value); setSavedMsg(null); }} placeholder="Your name" />
          </div>
          <div className="field">
            <label>Mobile number</label>
            <input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setSavedMsg(null); }} placeholder="+91 98765 43210" />
            <div className="hint">In full international format (+91…) for SMS alerts.</div>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary small" type="button" onClick={() => persist({ fullName, phone })}>Save profile</button>
          {savedMsg && <span style={{ color: "var(--good)", fontSize: 12.5 }}>{savedMsg}</span>}
        </div>
      </div>

      {person && (
        <form className="panel" onSubmit={savePay}>
          <h3>Your salary &amp; spending</h3>
          <p className="desc">
            For <b style={{ color: "var(--ink)" }}>{me.households?.find((h) => h.householdId === me.householdId)?.householdName ?? "this household"}</b> only —
            your income and personal spend live on you and roll up into this household's totals, surplus and runway.
            {(me.households?.length ?? 0) > 1 ? " Switch household (top-right menu) to edit your figures elsewhere." : ""}
          </p>
          <div className="row2">
            <div className="field">
              <label>Gross salary (₹/month)</label>
              <input inputMode="numeric" value={gross} onChange={(e) => { setGross(e.target.value); setPayMsg(null); }} placeholder="250000" />
            </div>
            <div className="field">
              <label>TDS (₹/month)</label>
              <input inputMode="numeric" value={tds} onChange={(e) => { setTds(e.target.value); setPayMsg(null); }} placeholder="tax deducted" />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Personal expenses (₹/month)</label>
              <input inputMode="numeric" value={spend} onChange={(e) => { setSpend(e.target.value); setPayMsg(null); }} placeholder="your own monthly spend" />
            </div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <div className="hint">
                {gross ? <>Take-home <b style={{ color: "var(--ink)" }}>{inr(Number(gross) - (tds ? Number(tds) : 0))}</b>/mo</> : "Enter your gross salary and TDS."}
                {gross && spend ? <> · keeps <b style={{ color: "var(--ink)" }}>{inr(Number(gross) - (tds ? Number(tds) : 0) - Number(spend))}</b> after personal spend</> : null}
              </div>
            </div>
          </div>
          {payErr && <div className="err">{payErr}</div>}
          <div className="actions">
            <button className="btn primary small" type="submit" disabled={payBusy}>{payBusy ? "…" : "Save salary & spending"}</button>
            {payMsg && <span style={{ color: "var(--good)", fontSize: 12.5 }}>{payMsg}</span>}
          </div>
        </form>
      )}

      {me.role === "owner" && (
        <form className="panel" onSubmit={saveHousehold}>
          <h3>Household</h3>
          <div className="field">
            <label>Household name</label>
            <input value={hhName} onChange={(e) => { setHhName(e.target.value); setHhMsg(null); }} placeholder="e.g. The Kunam family" />
            <div className="hint">This is the name shown in the top bar and the household switcher.</div>
          </div>
          {hhErr && <div className="err">{hhErr}</div>}
          <div className="actions">
            <button className="btn primary small" type="submit" disabled={hhBusy || !hhName.trim()}>{hhBusy ? "…" : "Save household"}</button>
            {hhMsg && <span style={{ color: "var(--good)", fontSize: 12.5 }}>{hhMsg}</span>}
          </div>
        </form>
      )}

      <form className="panel" onSubmit={changePassword}>
        <h3>Change password</h3>
        <div className="row2">
          <div className="field"><label>Current password</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="field"><label>New password</label><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} placeholder="At least 6 characters" /></div>
        </div>
        {pwErr && <div className="err">{pwErr}</div>}
        <div className="actions">
          <button className="btn primary small" type="submit" disabled={pwBusy || !cur || !nw}>{pwBusy ? "…" : "Change password"}</button>
          {pwMsg && <span style={{ color: "var(--good)", fontSize: 12.5 }}>{pwMsg}</span>}
        </div>
      </form>
    </Shell>
  );
}
