"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession, getUser } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [takeHome, setTakeHome] = useState("");
  const [essential, setEssential] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already signed in? Skip the form.
  useEffect(() => {
    const u = getUser();
    if (u) router.replace(u.role === "operations" ? "/operations" : "/");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const session =
        mode === "login"
          ? await api.login({ email: email.trim(), password })
          : await api.register({
              email: email.trim(), password, fullName: fullName.trim() || undefined,
              householdName: householdName.trim() || undefined,
              monthlyTakeHome: takeHome ? Number(takeHome) : undefined,
              monthlyEssential: essential ? Number(essential) : undefined,
            });
      saveSession(session);
      router.replace(session.user.role === "operations" ? "/operations" : "/");
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-brand">
        <span className="mark">K</span>
        <span className="wordmark">Kunatra</span>
      </div>
      <div className="auth-card">
        <h2>{mode === "login" ? "Sign in" : "Create your account"}</h2>
        <p className="desc">
          {mode === "login"
            ? "Owners and operations teammates sign in here."
            : "This creates your household as its owner. You can invite operations teammates afterwards."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <div className="field">
              <label>Your name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya Sharma" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 6 characters" : ""} />
          </div>
          {mode === "register" && (
            <>
              <div className="field">
                <label>Household name</label>
                <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="e.g. Priya's finances" />
              </div>
              <div className="row2">
                <div className="field"><label>Your monthly take-home (₹)</label><input inputMode="numeric" value={takeHome} onChange={(e) => setTakeHome(e.target.value)} placeholder="140000" /></div>
                <div className="field"><label>Shared essentials (₹/mo)</label><input inputMode="numeric" value={essential} onChange={(e) => setEssential(e.target.value)} placeholder="rent, groceries…" /></div>
              </div>
              <div className="hint" style={{ marginTop: -6 }}>Your salary goes on you — every family member carries their own salary and spending; the household holds the shared bills.</div>
            </>
          )}
          {err && <div className="err">{err}</div>}
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </div>
        </form>
        {mode === "login" && (
          <div className="auth-toggle" style={{ marginTop: 10 }}>
            <a href="/forgot" style={{ color: "var(--accent)", fontWeight: 500 }}>Forgot password?</a>
          </div>
        )}
        <div className="auth-toggle">
          {mode === "login" ? (
            <>New here? <button onClick={() => { setMode("register"); setErr(null); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode("login"); setErr(null); }}>Sign in</button></>
          )}
        </div>
      </div>
      <p className="foot">A mirror, not an advisor. Not financial advice.</p>
    </div>
  );
}
