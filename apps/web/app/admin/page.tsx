"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AdminStats, type AdminUser, type AdminActivity, type SigninEvent } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";

const fmt = (n: number) => n.toLocaleString("en-IN");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const ago = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const CLASS_LABEL: Record<string, string> = { real_estate: "real estate", mutual_fund: "mutual fund", sip: "SIP", equity: "equity", epf: "EPF", ppf: "PPF", nps: "NPS", fd: "fixed deposit", rd: "recurring deposit", bonds: "bonds", cash: "cash", gold: "gold", insurance: "insurance", other: "other" };
const ACT: Record<string, { label: (d: string) => string; dot: string }> = {
  user: { label: (d) => `New user · ${d}`, dot: "var(--good)" },
  household: { label: (d) => `New household · ${d}`, dot: "var(--accent, var(--ink))" },
  asset: { label: (d) => `${CLASS_LABEL[d] ?? d} asset added`, dot: "var(--slate)" },
};

function WeekChart({ label, data, color }: { label: string; data: { week: string; count: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((w) => w.count));
  return (
    <div className="panel">
      <div className="sec-label" style={{ marginTop: 0 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90, marginTop: 6 }}>
        {data.length === 0 && <div className="hint">No activity in the last 8 weeks.</div>}
        {data.map((w) => (
          <div key={w.week} style={{ flex: 1, textAlign: "center" }} title={`${w.week}: ${w.count}`}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{w.count}</div>
            <div style={{ height: `${(w.count / max) * 60}px`, background: color, borderRadius: 4, minHeight: 2 }} />
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{w.week.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Admin() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [signins, setSignins] = useState<SigninEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user?.isAdmin) { router.replace("/"); return; }
    Promise.all([api.adminStats(), api.adminUsers(), api.adminActivity(), api.adminSignins()])
      .then(([s, u, a, si]) => { setStats(s); setUsers(u); setActivity(a); setSignins(si); })
      .catch((e) => setErr(e.message ?? "Could not load"));
  }, [ready, user, router]);

  if (!ready || !user?.isAdmin) return <Shell><div /></Shell>;

  return (
    <Shell>
      <div className="scr-head">
        <div>
          <h2 className="scr-title">Platform</h2>
          <div className="scr-sub">Operator view — counts and accounts only. Household finances, property values and holdings stay private, even here.</div>
        </div>
      </div>

      {err && <div className="strip bad">{err}</div>}

      {stats && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>Accounts</div>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile k="Users" v={fmt(stats.users)} sub={`+${stats.newUsers7d} this week`} />
            <Tile k="Households" v={fmt(stats.households)} sub={`${stats.activeHouseholds} with assets`} />
            <Tile k="People tracked" v={fmt(stats.people)} />
            <Tile k="New (30d)" v={fmt(stats.newUsers30d)} />
          </div>

          <div className="label" style={{ marginBottom: 8 }}>Coverage <span className="muted" style={{ fontWeight: 400 }}>· counts only — no values</span></div>
          <div className="tiles" style={{ marginBottom: 16 }}>
            <Tile k="Assets" v={fmt(stats.assets)} />
            <Tile k="Properties" v={fmt(stats.properties)} sub={`${stats.rentedProperties} rented`} />
            <Tile k="Loans" v={fmt(stats.loans)} />
            <Tile k="Work orders" v={fmt(stats.workOrders)} sub={`${stats.vendors} vendors`} />
          </div>

          <div className="label" style={{ marginBottom: 8 }}>Trends · last 8 weeks</div>
          <div className="tiles" style={{ marginBottom: 16, gridTemplateColumns: "1fr 1fr" }}>
            <WeekChart label="Signups" data={stats.signupsByWeek} color="var(--brand, var(--ink))" />
            <WeekChart label="Assets added" data={stats.assetsByWeek} color="var(--good)" />
          </div>
        </>
      )}

      {activity.length > 0 && (
        <>
          <div className="sec-label">Recent activity</div>
          <div className="panel" style={{ padding: "6px 0" }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: i < activity.length - 1 ? "1px solid var(--line)" : "none" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: (ACT[a.type]?.dot ?? "var(--slate)"), flex: "none" }} />
                <span style={{ flex: 1, fontSize: 13.5 }}>{ACT[a.type]?.label(a.detail) ?? a.detail}</span>
                <span className="meta" style={{ fontSize: 12 }}>{ago(a.at)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {signins.length > 0 && (
        <>
          <div className="sec-label">Recent sign-ins · with geography</div>
          <div className="scroll">
            <table>
              <thead><tr><th>Who</th><th>Event</th><th>Where</th><th>Device</th><th>When</th></tr></thead>
              <tbody>
                {signins.slice(0, 20).map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12.5 }}>{s.email}</td>
                    <td><span className={`pill ${s.success ? (s.event === "login" ? "p-good" : "p-info") : "p-bad"}`}>{s.success ? s.event : "failed"}</span></td>
                    <td style={{ fontSize: 12.5 }}>{[s.city, s.region, s.country].filter(Boolean).join(", ") || "—"}{s.timeZone ? <span className="muted"> · {s.timeZone}</span> : null}</td>
                    <td style={{ fontSize: 12.5 }}>{[s.browser, s.os].filter(Boolean).join(" / ") || "—"}{s.device ? ` · ${s.device}` : ""}</td>
                    <td className="meta">{ago(s.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="sec-label">Users ({users.length})</div>
      <div className="scroll">
        <table>
          <thead><tr><th>User</th><th>Households</th><th>Roles</th><th>Joined</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{u.fullName || u.email}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                </td>
                <td className="tnum">{u.householdCount}</td>
                <td>{u.roles.map((r) => <span key={r} className="pill p-info" style={{ marginRight: 4 }}>{r}</span>)}</td>
                <td className="meta">{day(u.createdAt)}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={4} className="empty">No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="explain">
        This is a platform operator view. It shows how many users, households, properties and work orders exist across
        Kunatra — never their values, balances, or contents. Each household's financial picture stays visible only to that
        household's own members.
      </div>
    </Shell>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="tl">{k}</div>
      <div className="tv num" style={{ fontSize: 24, marginTop: 4 }}>{v}</div>
      {sub && <div className="meta" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
