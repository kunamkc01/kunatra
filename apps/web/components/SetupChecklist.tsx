"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type User } from "@/lib/api";

interface Item { key: string; label: string; hint: string; href: string; done: boolean; }

const hideKey = (hh: string) => `kunatra.setup.hidden.${hh}`;

/**
 * "Build your mirror" — the owner's guided path from empty account to a live
 * mirror. Every item deep-links to the exact spot; the panel disappears on its
 * own once everything is done (or when dismissed).
 */
export function SetupChecklist({ user, refreshKey = 0 }: { user: User; refreshKey?: number }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (user.role !== "owner") return;
    setHidden(typeof window !== "undefined" && localStorage.getItem(hideKey(user.householdId)) === "1");
    (async () => {
      try {
        const [assets, members, household, team] = await Promise.all([
          api.listAssets(user.householdId),
          api.listMembers(user.householdId),
          api.getHousehold(user.householdId),
          api.listUsers(user.householdId).catch(() => null), // owner-only; tolerate
        ]);
        const me = members.find((m) => m.id === user.memberId) ?? null;
        const properties = assets.filter((a) => a.assetClass === "real_estate");
        const out: Item[] = [
          {
            key: "salary", href: "/profile", done: me?.monthlyNet != null,
            label: "Add your salary & spending",
            hint: "On your profile — it drives surplus, runway and EMI strain.",
          },
          {
            key: "asset", href: "/manage", done: assets.length > 0,
            label: "Add what you own",
            hint: "Your home, properties, funds, FDs, gold, cash — start with one.",
          },
        ];
        if (properties.length > 0) {
          out.push({
            key: "propdetails", href: "/manage",
            done: properties.every((p) => p.realEstate?.city && p.realEstate?.sqft),
            label: "Complete your property details",
            hint: "City, locality, size and type unlock the free AI value estimate.",
          });
        }
        out.push({
          key: "essentials", href: "/manage", done: household.monthlyEssential != null,
          label: "Set the household's shared essentials",
          hint: "Rent, groceries, utilities — the shared spend behind runway.",
        });
        if (team) {
          out.push({
            key: "invite", href: "/team", done: team.length > 1,
            label: "Invite your family",
            hint: "Your spouse manages their own salary & assets with a member login.",
          });
        }
        setItems(out);
      } catch { /* leave the checklist unrendered on failure */ }
    })();
  }, [user, refreshKey]);

  if (user.role !== "owner" || hidden || !items) return null;
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null; // mirror built — get out of the way

  return (
    <div className="panel setup" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h3 style={{ margin: 0 }}>Build your mirror</h3>
        <span className="meta">{done}/{items.length} done
          <button className="setup-hide" type="button" title="Hide this checklist"
            onClick={() => { localStorage.setItem(hideKey(user.householdId), "1"); setHidden(true); }}>hide</button>
        </span>
      </div>
      <div className="setup-bar"><div style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <div className="setup-items">
        {items.map((i) => (
          <Link key={i.key} href={i.href} className={`setup-item ${i.done ? "is-done" : ""}`}>
            <span className="setup-check">{i.done
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
              : <span className="setup-dot" />}</span>
            <span>
              <span className="setup-label">{i.label}</span>
              {!i.done && <span className="setup-hint">{i.hint}</span>}
            </span>
            {!i.done && <span className="setup-go">→</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
