"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type AdminStats, type AdminUser } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";

const fmt = (n: number) => n.toLocaleString("en-IN");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function Admin() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user?.isAdmin) { router.replace("/"); return; }
    Promise.all([api.adminStats(), api.adminUsers()])
      .then(([s, u]) => { setStats(s); setUsers(u); })
      .catch((e) => setErr(e.message ?? "Could not load"));
  }, [ready, user, router]);

  if (!ready || !user?.isAdmin) return <Shell><div /></Shell>;

  const maxWeek = Math.max(1, ...(stats?.signupsByWeek.map((w) => w.count) ?? [1]));

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

          {stats.signupsByWeek.length > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="sec-label" style={{ marginTop: 0 }}>Signups · last 8 weeks</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90, marginTop: 6 }}>
                {stats.signupsByWeek.map((w) => (
                  <div key={w.week} style={{ flex: 1, textAlign: "center" }} title={`${w.week}: ${w.count}`}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{w.count}</div>
                    <div style={{ height: `${(w.count / maxWeek) * 60}px`, background: "var(--brand, var(--ink))", borderRadius: 4, minHeight: 2 }} />
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{w.week.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
