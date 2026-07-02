"use client";
import { useEffect, useRef, useState } from "react";
import { api, getUser, setStoredUser, type User } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
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
  const [avatar, setAvatar] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // password
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [pwMsg, setPwMsg] = useState<string | null>(null); const [pwErr, setPwErr] = useState<string | null>(null); const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api.me().then((u) => { setMe(u); setFullName(u.fullName ?? ""); setAvatar(u.avatar ?? null); }).catch(() => setMe(getUser()));
  }, [ready]);

  async function persist(patch: { fullName?: string; avatar?: string | null }) {
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
        <div className="field" style={{ marginTop: 16 }}>
          <label>Name</label>
          <input value={fullName} onChange={(e) => { setFullName(e.target.value); setSavedMsg(null); }} placeholder="Your name" />
        </div>
        <div className="actions">
          <button className="btn primary small" type="button" onClick={() => persist({ fullName })}>Save profile</button>
          {savedMsg && <span style={{ color: "var(--good)", fontSize: 12.5 }}>{savedMsg}</span>}
        </div>
      </div>

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
