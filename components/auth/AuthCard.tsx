"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/lib/use-auth-user";
import GoogleButton from "./GoogleButton";

const ERROR_COPY: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email is already linked to another sign-in method. Try the option you used first.",
  AccessDenied: "Google did not approve the sign-in. Please try again.",
  Configuration:
    "Sign-in is not configured on this server yet. Reading still works — everything stays on this device.",
};

/**
 * The card shown on /login and /signup. Mode only changes the copy — both
 * modes start the same Google OAuth flow (Auth.js auto-provisions new users,
 * so "signup" needs no separate backend).
 */
export default function AuthCard({
  mode,
  callbackUrl,
  error,
}: {
  mode: "login" | "signup";
  callbackUrl?: string;
  error?: string | null;
}) {
  const { user, status } = useAuthUser();
  const router = useRouter();
  // Only allow relative redirects — never bounce to an external URL.
  const next =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";
  const toggleHref =
    mode === "login"
      ? `/signup${next === "/" ? "" : `?callbackUrl=${encodeURIComponent(next)}`}`
      : `/login${next === "/" ? "" : `?callbackUrl=${encodeURIComponent(next)}`}`;

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  // Signed in already (redirect is on its way) — never flash the form.
  if (user) {
    return (
      <div className="auth-wrap">
        <div className="glass-container auth-card" role="status">
          <span className="eyebrow-label">Account</span>
          <h1>Signed in{user.name ? ` as ${user.name}` : ""}</h1>
          <p className="auth-sub">Taking you back to your stories…</p>
        </div>
      </div>
    );
  }

  // Still probing /api/auth-status + /api/auth/session — avoid flicker.
  if (status === null && !error) {
    return (
      <div className="auth-wrap">
        <div className="glass-container auth-card" aria-busy="true">
          <span className="eyebrow-label">Account</span>
          <h1>{mode === "login" ? "Log in" : "Create your account"}</h1>
          <p className="auth-sub">Checking sign-in availability…</p>
        </div>
      </div>
    );
  }

  // Google credentials or database missing on the server: explain instead of
  // showing a dead button (anonymous reading is unaffected).
  if (status && (!status.google || !status.db)) {
    return (
      <div className="auth-wrap">
        <div className="glass-container auth-card">
          <span className="eyebrow-label">Account</span>
          <h1>Sign-in is unavailable</h1>
          <p className="auth-sub">
            The site owner has not connected Google sign-in
            {!status.google && " (missing Google credentials)"}
            {status.google && !status.db && " (missing sync database)"} yet. You
            can keep reading — bookmarks and preferences stay on this device.
          </p>
          <Link href="/" className="pill-btn" style={{ justifyContent: "center" }}>
            Back to the library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="glass-container auth-card">
        <span className="eyebrow-label">
          {mode === "login" ? "Welcome back" : "Join the reading room"}
        </span>
        <h1>{mode === "login" ? "Log in to lingoglass" : "Create your account"}</h1>
        <p className="auth-sub">
          {mode === "login"
            ? "Pick up your vocabulary queue and reading position on any device."
            : "One account syncs your bookmarks and progress across devices. Signup and login both use Google — no password to remember."}
        </p>
        {error && (
          <p className="auth-error" role="alert">
            {ERROR_COPY[error] ?? "Something went wrong signing in. Please try again."}
          </p>
        )}
        <GoogleButton
          callbackUrl={next}
          label={mode === "login" ? "Continue with Google" : "Sign up with Google"}
        />
        <p className="auth-toggle">
          {mode === "login" ? (
            <>
              New to lingoglass? <Link href={toggleHref}>Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href={toggleHref}>Log in</Link>
            </>
          )}
        </p>
        <p className="auth-note">
          Signing in only enables sync — reading, audio, and saving words work
          without an account.
        </p>
      </div>
    </div>
  );
}
