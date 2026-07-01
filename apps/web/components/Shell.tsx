"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/",
    label: "Portfolio",
    icon: <path d="M12 3v9l6.5 3.5M21 12a9 9 0 1 1-9-9" />,
  },
  {
    href: "/operations",
    label: "Operations",
    icon: <path d="M14 6l4 4M3 21l4-1 11-11-3-3L4 17l-1 4zM18 4l2 2" />,
  },
  {
    href: "/manage",
    label: "Assets",
    icon: <path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" />,
  },
];

/** The family-office console shell: brand bar + section tabs, wrapping each screen. */
export function Shell({ office, children }: { office?: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const activeFor = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <Link href="/" className="mark">K</Link>
          <Link href="/" className="wordmark">Kunatra</Link>
          {office ? <span className="office">{office}</span> : <span className="office">your money, honestly</span>}
        </div>
        <span className="rolepill"><span className="dot" /> Owner view</span>
      </div>

      <nav className="tabs" role="tablist" aria-label="Kunatra sections">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`tab ${activeFor(t.href) ? "active" : ""}`}
            role="tab"
            aria-selected={activeFor(t.href)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{t.icon}</svg>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="content">{children}</div>
    </div>
  );
}
