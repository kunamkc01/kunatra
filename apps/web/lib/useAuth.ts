"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, type User, type Role } from "./api";

/**
 * Client-side auth guard. Redirects to /login when there's no session, and
 * bounces users away from pages their role can't see.
 */
/** Where a role lands / gets bounced to when it can't see a page. */
const home = (role: Role) => (role === "operations" ? "/operations" : "/");

export function useAuth(opts?: { requireRole?: Role | Role[] }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const roleKey = Array.isArray(opts?.requireRole) ? opts!.requireRole.join(",") : opts?.requireRole;

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    const allowed = opts?.requireRole
      ? (Array.isArray(opts.requireRole) ? opts.requireRole : [opts.requireRole])
      : null;
    if (allowed && !allowed.includes(u.role)) {
      router.replace(home(u.role));
      return;
    }
    setUser(u);
    setReady(true);
  }, [router, roleKey]);

  return { user, ready };
}
