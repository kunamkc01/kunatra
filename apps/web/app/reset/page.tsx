"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Reset() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true); setErr(null);
    try { await api.resetPassword(token, pw); setDone(true); setTimeout(() => router.replace("/login"), 1500); }
    catch (e: any) { setErr(e.message ?? "Could not reset"); setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-brand"><span className="mark">K</span><span className="wordmark">Kunatra</span></div>
      <div className="auth-card">
        <h2>Set a new password</h2>
        {done ? (
          <p className="desc">Password updated — taking you to sign in…</p>
        ) : token === null ? (
          <>
            <p className="desc">This reset link is missing its token. Request a fresh one.</p>
            <Link href="/forgot" className="btn">Request a link</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field"><label>New password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" autoFocus /></div>
            {err && <div className="err">{err}</div>}
            <div className="actions"><button className="btn primary" type="submit" disabled={busy || !pw}>{busy ? "…" : "Set password"}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
