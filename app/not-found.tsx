import Link from "next/link";

export default function NotFound() {
  return (
    <main
      className="glass-container"
      style={{ margin: "48px auto", maxWidth: 480, padding: 32, textAlign: "center" }}
    >
      <span className="eyebrow-label">Missing page</span>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "8px 0" }}>
        Nothing here
      </h1>
      <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: 20 }}>
        Accounts were removed — reading is anonymous now. Head back to the
        library.
      </p>
      <Link href="/" className="pill-btn active" style={{ justifyContent: "center" }}>
        Back to the library
      </Link>
    </main>
  );
}
