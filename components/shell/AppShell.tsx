"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { initParticles, destroyParticles } from "@/lib/juice";
import { removeBookmark, useBookmarks } from "@/lib/bookmarks";

const SIDE_KEY = "lingoglass:sidebar";

function readSidePref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(SIDE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

/**
 * Master app shell: ambient orbs live in the layout; here is the
 * sidebar (brand + vocabulary queue) and the main workspace with the
 * Stories/Reels tab header. Routes and story data flow through children.
 */
export default function AppShell({
  children,
  storyCount,
}: {
  children: React.ReactNode;
  storyCount?: number;
}) {
  const [tab, setTab] = useState<"stories" | "reels">("stories");
  // Hydration-safe: render the server default (open) first, then apply the
  // stored sidebar preference after mount — reading localStorage in the
  // initializer would mismatch the statically prerendered HTML.
  const [sideOpen, setSideOpen] = useState<boolean>(true);
  const bookmarks = useBookmarks();

  useEffect(() => {
    initParticles();
    setSideOpen(readSidePref());
    // AppShell remounts on every client navigation — without this teardown
    // the canvas resize listener (and rAF loop) would pile up per route.
    return () => destroyParticles();
  }, []);

  const toggleSide = () => {
    setSideOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div id="app-container" className={sideOpen ? undefined : "side-collapsed"}>
      <aside className={sideOpen ? "sidebar-open" : undefined}>
        <div className="glass-container" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" className="brand-title" aria-label="lingoglass home">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-clay)" }} aria-hidden="true">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            lingoglass
          </Link>
          <button
            className="round-btn side-toggle"
            style={{ width: 32, height: 32 }}
            onClick={toggleSide}
            aria-expanded={sideOpen}
            aria-label={sideOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sideOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {sideOpen ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
            </svg>
          </button>
        </div>

        <div className="glass-container" style={{ flex: 1, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-ochre)" }} aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, letterSpacing: "-0.01em" }}>Vocabulary Queue</h2>
            <span id="vocab-badge-count" className="vocab-badge" aria-label={`${bookmarks.length} saved words`}>
              {bookmarks.length}
            </span>
          </div>

          <div className="custom-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
            {bookmarks.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Tap any word in a story, then Bookmark — saved words land here.
              </p>
            ) : (
              bookmarks.map((b) => (
                <div className="saved-vocab-card" key={b.id}>
                  <div className="vocab-word-row">
                    <span className="vocab-word-target">{b.word}</span>
                    {(b.reading || b.romaji) && (
                      <span className="vocab-word-reading">
                        {b.romaji ?? b.reading}
                      </span>
                    )}
                  </div>
                  {/* English meaning first (local JMdict lookup), then the
                      story's own gloss note, if the two differ. */}
                  <span className="vocab-word-translation">
                    {b.englishMeaning || b.note || "—"}
                  </span>
                  {b.note && b.englishMeaning && b.note !== b.englishMeaning && (
                    <span className="vocab-word-note">{b.note}</span>
                  )}
                  {b.context && <div className="vocab-context-sentence">{b.context}</div>}
                  {b.contextEn && (
                    <div className="vocab-context-translation">{b.contextEn}</div>
                  )}
                  <div className="vocab-meta-row">
                    <span>
                      {b.lang} · {b.level.toUpperCase()}
                    </span>
                    <button
                      onClick={() => removeBookmark(b.id)}
                      aria-label={`Remove ${b.word}`}
                      title="Remove"
                      style={{ border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700, padding: "2px 4px" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
            Saved on this device
          </div>
        </div>
      </aside>

      <main>
        <header className="glass-container">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!sideOpen && (
              <button
                className="round-btn side-toggle-restore"
                style={{ width: 36, height: 36 }}
                onClick={toggleSide}
                aria-expanded={sideOpen}
                aria-label="Show vocabulary"
                title="Show vocabulary queue"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </button>
            )}
            <button
              className="round-btn side-toggle-mobile"
              style={{ width: 36, height: 36 }}
              onClick={toggleSide}
              aria-expanded={sideOpen}
              aria-label={sideOpen ? "Hide vocabulary" : "Show vocabulary"}
              title="Vocabulary queue"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <div className="tab-group" role="tablist" aria-label="Stories or reels">
              <div
                className="tab-slider"
                aria-hidden="true"
                style={{ transform: tab === "reels" ? "translateX(100%)" : "translateX(0%)" }}
              />
              <button
                className={`tab-btn${tab === "stories" ? " active" : ""}`}
                role="tab"
                aria-selected={tab === "stories"}
                onClick={() => setTab("stories")}
              >
                Stories
              </button>
              <button
                className={`tab-btn${tab === "reels" ? " active" : ""}`}
                role="tab"
                aria-selected={tab === "reels"}
                onClick={() => setTab("reels")}
              >
                Reels Feed
              </button>
            </div>
          </div>

          {storyCount !== undefined && (
            <Link href="/" className="pill-btn active" style={{ fontWeight: 700 }} aria-label={`${storyCount} graded stories in the library`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {storyCount} stories
            </Link>
          )}
        </header>

        {tab === "stories" ? (
          children
        ) : (
          <section id="reels-platform" className="active" aria-label="Reels feed">
            <div className="reel-mockup-frame">
              <span className="eyebrow-label">Reels Feed</span>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Short clips are coming soon</h3>
              <p style={{ fontSize: "0.9rem", maxWidth: "24rem" }}>
                Video captions with tap-to-define words will live here. Until then, every story reads aloud with native-device voices.
              </p>
              <button className="pill-btn active" onClick={() => setTab("stories")}>
                Back to stories
              </button>
            </div>
          </section>
        )}

        <div id="pace-notification" className="pace-notification glass-panel-heavy" role="status" aria-live="polite">
          <div className="notification-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="notification-body">
            <h4 className="notification-title">Word Saved</h4>
            <p className="notification-desc">Added to your vocabulary queue.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
