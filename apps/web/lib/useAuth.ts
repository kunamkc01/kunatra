"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, type User, type Role } from "./api";

/**
 * Client-side auth guard. Redirects to /login when there's no session, and
 * bounces users away from pages their role can't see.
 */
export function useAuth(opts?: { requireRole?: Role }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    if (opts?.requireRole && u.role !== opts.requireRole) {
      router.replace(u.role === "operations" ? "/operations" : "/");
      return;
    }
    setUser(u);
    setReady(true);
  }, [router, opts?.requireRole]);

  return { user, ready };
}
