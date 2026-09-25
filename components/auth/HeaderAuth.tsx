"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthUser } from "@/lib/use-auth-user";

/**
 * Login / Signup buttons in the AppShell header. Hidden while auth state is
 * unknown (no flicker), when the server offers no auth, on the auth pages
 * themselves, and — once signed in — replaced by a small avatar chip
 * (sign-out lives in the sidebar AccountBadge).
 */
export default function HeaderAuth() {
  const { user, status } = useAuthUser();
  const pathname = usePathname();

  if (pathname === "/login" || pathname === "/signup") return null;
  if (status === null) return null;
  if (!status.google || !status.db) return null;

  if (user) {
    const initial = (user.name ?? user.email ?? "U").slice(0, 1).toUpperCase();
    return (
      <span
        className="header-avatar"
        title={user.email ?? user.name ?? "Signed in"}
        aria-label={`Signed in as ${user.name ?? user.email ?? "you"}`}
      >
        {user.image ? (
          // Plain img: remote Google avatar, no next/image remote config needed.
          <img src={user.image} alt="" width={30} height={30} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </span>
    );
  }

  return (
    <nav className="header-auth" aria-label="Account">
      <Link href="/login" className="pill-btn header-login">
        Log in
      </Link>
      <Link href="/signup" className="pill-btn header-signup">
        Sign up
      </Link>
    </nav>
  );
}
