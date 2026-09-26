"use client";

// Last-resort boundary: replaces the root layout, so it must render its own
// <html>/<body>. Keep it fully self-contained (inline styles only).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#FAF6EE",
          color: "#2E2A26",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: 480,
            padding: 32,
            textAlign: "center",
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 10px 40px rgba(46, 42, 38, 0.08)",
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#9E8D85",
            }}
          >
            lingoglass
          </span>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "8px 0" }}>
            The app stopped unexpectedly
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#7A736C", marginBottom: 20 }}>
            Your saved words and progress are stored locally and are safe.
            Reload to continue.
          </p>
          <button
            onClick={() => reset()}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "10px 22px",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              background: "#C26D5C",
              color: "#fff",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
