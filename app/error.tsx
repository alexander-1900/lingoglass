"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      className="glass-container"
      style={{ margin: "48px auto", maxWidth: 480, padding: 32, textAlign: "center" }}
    >
      <span className="eyebrow-label">Something broke</span>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "8px 0" }}>
        This page hit a snag
      </h1>
      <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: 8 }}>
        An unexpected error interrupted the page. Your saved words and
        progress are stored locally and are safe.
      </p>
      {error.digest && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            marginBottom: 16,
            fontFamily: "monospace",
          }}
        >
          Reference: {error.digest}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button className="pill-btn active" onClick={() => reset()} title="Reload this page">
          Try again
        </button>
        <Link href="/" className="pill-btn" style={{ justifyContent: "center" }}>
          Back to the library
        </Link>
      </div>
    </main>
  );
}
