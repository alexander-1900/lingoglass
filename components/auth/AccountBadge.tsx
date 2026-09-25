"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useAuthUser } from "@/lib/use-auth-user";

/**
 * Sidebar account control. Rendered inside AppShell's vocabulary panel.
 * Graceful degradation: with no Google credentials or no database on the
 * server, the whole badge renders nothing and the app behaves exactly as
 * the pre-auth build (localStorage only).
 */
export default function AccountBadge() {
  const { user, status } = useAuthUser();

  // Unknown yet → render nothing (avoids sign-in flicker on every page).
  if (status === null) return null;
  if (!status.google || !status.db) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="pill-btn"
        style={{ width: "100%", justifyContent: "center" }}
        title="Log in to sync your bookmarks and reading progress across devices"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
        </svg>
        Log in / Sign up
      </Link>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {user.image ? (
        <img
          src={user.image}
          alt=""
          width={28}
          height={28}
          style={{ borderRadius: 99, border: "1px solid var(--border-strong)" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            borderRadius: 99,
            background: "var(--accent-clay)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
            fontWeight: 700,
            flex: "none",
          }}
        >
          {(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span
        className="story-card-author"
        style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={user.email ?? user.name ?? undefined}
      >
        {user.name ?? user.email}
      </span>
      <button
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out — bookmarks stay on this device"
        style={{
          border: "none",
          background: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "0.7rem",
          fontWeight: 700,
          padding: "2px 4px",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
