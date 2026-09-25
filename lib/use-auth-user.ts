"use client";

import { useEffect, useState } from "react";
import { mergeOnLogin } from "./sync";

export interface AuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface AuthStatus {
  /** Google credentials present on the server. */
  google: boolean;
  /** Sync database configured. */
  db: boolean;
}

interface SessionResponse {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

// One-shot merge per page load: AppShell remounts on every client
// navigation, and the LWW full-state merge is redundant after the first.
let didInitialSync = false;

/**
 * Client-side auth probe. Reads Auth.js's own /api/auth/session endpoint
 * (no SessionProvider needed) plus /api/auth-status for capability flags.
 * Triggers the login merge exactly once when a session appears.
 */
export function useAuthUser(): { user: AuthUser | null; status: AuthStatus | null } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessionRes, statusRes] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/auth-status"),
        ]);
        const session = (await sessionRes.json()) as SessionResponse;
        const st = (await statusRes.json()) as AuthStatus;
        if (cancelled) return;
        setStatus(st);
        const u = session?.user;
        if (u?.id) {
          setUser({ id: u.id, name: u.name, email: u.email, image: u.image });
          if (!didInitialSync && st.db) {
            didInitialSync = true;
            void mergeOnLogin();
          }
        } else {
          setUser(null);
          didInitialSync = false;
        }
      } catch {
        if (!cancelled) setStatus({ google: false, db: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, status };
}
