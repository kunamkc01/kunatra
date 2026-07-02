"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api.forgotPassword(email.trim()); setSent(true); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-brand"><span className="mark">K</span><span className="wordmark">Kunatra</span></div>
      <div className="auth-card">
        <h2>Reset your password</h2>
        {sent ? (
          <>
            <p className="desc">If an account exists for <b>{email}</b>, a reset link is on its way. (No email server is wired up in local dev — the link is printed in the API console.)</p>
            <Link href="/login" className="btn">Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="desc">Enter your email and we'll send a link to set a new password.</p>
            <form onSubmit={submit}>
              <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus /></div>
              <div className="actions"><button className="btn primary" type="submit" disabled={busy || !email}>{busy ? "…" : "Send reset link"}</button></div>
            </form>
            <div className="auth-toggle"><Link href="/login" style={{ color: "var(--accent)", fontWeight: 500 }}>Back to sign in</Link></div>
          </>
        )}
      </div>
    </div>
  );
}
