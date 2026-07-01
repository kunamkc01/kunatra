"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getUser, clearSession, type Role } from "@/lib/api";

const TABS: { href: string; label: string; roles: Role[]; icon: React.ReactNode }[] = [
  { href: "/", label: "Portfolio", roles: ["owner"], icon: <path d="M12 3v9l6.5 3.5M21 12a9 9 0 1 1-9-9" /> },
  { href: "/operations", label: "Operations", roles: ["owner", "operations"], icon: <path d="M14 6l4 4M3 21l4-1 11-11-3-3L4 17l-1 4zM18 4l2 2" /> },
  { href: "/manage", label: "Assets", roles: ["owner", "operations"], icon: <path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" /> },
  { href: "/team", label: "Team", roles: ["owner"], icon: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /> },
];

export function Shell({ office, children }: { office?: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);

  useEffect(() => { setUser(getUser()); }, []);

  const activeFor = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const tabs = TABS.filter((t) => !user || t.roles.includes(user.role));

  function logout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <Link href="/" className="mark">K</Link>
          <Link href="/" className="wordmark">Kunatra</Link>
          <span className="office">{office ?? "your money, honestly"}</span>
        </div>
        {user && (
          <div className="userchip">
            <span className="who"><b>{user.fullName || user.email}</b><span className="rolepill" style={{ marginTop: 2 }}><span className="dot" /> {user.role === "owner" ? "Owner" : "Operations"}</span></span>
            <button className="btn small" onClick={logout}>Sign out</button>
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
