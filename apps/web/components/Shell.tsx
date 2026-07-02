"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getUser, saveSession, clearSession, api, USER_EVENT, type Role } from "@/lib/api";

const roleLabel = (r: Role) =>
  r === "owner" ? "Owner"
  : r === "manager" ? "Manager"
  : r === "member" ? "Member"
  : r === "advisor" ? "Advisor"
  : "Operations";

const TABS: { href: string; label: string; roles: Role[]; icon: React.ReactNode }[] = [
  { href: "/", label: "Portfolio", roles: ["owner", "manager", "member", "advisor"], icon: <path d="M12 3v9l6.5 3.5M21 12a9 9 0 1 1-9-9" /> },
  { href: "/operations", label: "Operations", roles: ["owner", "manager", "member", "operations"], icon: <path d="M14 6l4 4M3 21l4-1 11-11-3-3L4 17l-1 4zM18 4l2 2" /> },
  { href: "/manage", label: "Assets", roles: ["owner", "manager", "member", "operations", "advisor"], icon: <path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" /> },
  { href: "/team", label: "Team", roles: ["owner"], icon: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /> },
  { href: "/activity", label: "Activity", roles: ["owner"], icon: <path d="M12 8v4l3 2M12 3a9 9 0 1 0 9 9" /> },
];

export function Shell({ office, children }: { office?: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    // Update live when the profile changes (same tab) or another tab signs in/out.
    window.addEventListener(USER_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(USER_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  // Close the user menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  // Close it whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const activeFor = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const roleTabs = TABS.filter((t) => !user || t.roles.includes(user.role));
  // Platform admin is a flag (email allowlist), not a household role.
  const tabs = user?.isAdmin
    ? [...roleTabs, { href: "/admin", label: "Admin", roles: [] as Role[], icon: <path d="M12 2l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V6l7-4zM9.5 12l2 2 4-4" /> }]
    : roleTabs;

  function logout() {
    clearSession();
    router.replace("/login");
  }

  async function switchTo(householdId: string) {
    if (!user || householdId === user.householdId) { setMenuOpen(false); return; }
    try {
      const s = await api.switchHousehold(householdId);
      saveSession(s);
      setMenuOpen(false);
      // Hard navigation so every page refetches under the new household + role
      // (a client-side route change wouldn't re-run the per-page auth/data load).
      window.location.assign("/");
    } catch {
      // stay put; the 401 handler in api.ts covers auth failures
    }
  }

  async function newHousehold() {
    const name = window.prompt("Name your new household (you'll be its owner):", "My household");
    if (name == null) return;
    try {
      const s = await api.createHousehold({ displayName: name.trim() || "My household" });
      saveSession(s);
      setMenuOpen(false);
      window.location.assign("/");
    } catch {
      // stay put; the 401 handler in api.ts covers auth failures
    }
  }

  const households = user?.households ?? [];

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <Link href="/" className="mark">K</Link>
          <Link href="/" className="wordmark">Kunatra</Link>
          <span className="office">{office ?? "your money, honestly"}</span>
        </div>
        {user && (
          <div className="usermenu" ref={menuRef}>
            <button className="usermenu-trigger" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              {user.avatar
                ? <img className="avatar" src={user.avatar} alt="" />
                : <span className="avatar avatar-fallback" style={{ fontSize: 13 }}>{(user.fullName || user.email).charAt(0).toUpperCase()}</span>}
              <span className="usermenu-name">{user.fullName || user.email}</span>
              <svg className="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <div className="menu-head">
                  <div className="menu-name">{user.fullName || "—"}</div>
                  <div className="menu-email">{user.email}</div>
                  <span className="rolepill" style={{ marginTop: 6 }}><span className="dot" /> {roleLabel(user.role)}</span>
                </div>
                <div className="menu-section">
                  {households.length > 1 && <>
                    <div className="menu-section-label">Households</div>
                    {households.map((h) => (
                      <button
                        key={h.householdId}
                        className={`menu-item ${h.householdId === user.householdId ? "is-active" : ""}`}
                        role="menuitemradio"
                        aria-checked={h.householdId === user.householdId}
                        onClick={() => switchTo(h.householdId)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg>
                        <span className="menu-item-text">{h.householdName}</span>
                        <span className="menu-item-meta">{roleLabel(h.role)}</span>
                        {h.householdId === user.householdId && (
                          <svg className="menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    ))}
                  </>}
                  <button className="menu-item" role="menuitem" onClick={newHousehold}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>
                    New household
                  </button>
                </div>
                <Link href="/profile" className="menu-item" role="menuitem">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
                  Profile &amp; password
                </Link>
                <button className="menu-item" role="menuitem" onClick={logout}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="tabs" role="tablist" aria-label="Kunatra sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={`tab ${activeFor(t.href) ? "active" : ""}`} role="tab" aria-selected={activeFor(t.href)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{t.icon}</svg>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="content">{children}</div>
    </div>
  );
}
