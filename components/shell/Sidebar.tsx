"use client";

import Link from "next/link";
import { removeBookmark, useBookmarks } from "@/lib/bookmarks";

interface Props {
  open: boolean;
  onToggle: () => void;
}

/** Collapsible brand + vocabulary-queue sidebar (local bookmarks only). */
export default function Sidebar({ open, onToggle }: Props) {
  const bookmarks = useBookmarks();

  return (
    <aside className="lg-sidebar" aria-label="Sidebar">
      <div className="lg-side-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-clay)" }} aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        {open && (
          <Link href="/" className="brand-title" style={{ fontSize: "1.25rem" }}>
            lingoglass
          </Link>
        )}
        <span style={{ marginLeft: "auto" }}>
          <button
            className="round-btn"
            style={{ width: 32, height: 32 }}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {open ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
            </svg>
          </button>
        </span>
      </div>

      {open && (
        <div className="lg-vocab lg-side-panel">
          <div className="lg-vocab-head">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-ochre)" }} aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <h2>Vocabulary Queue</h2>
            <span className="vocab-badge" aria-label={`${bookmarks.length} saved words`}>
              {bookmarks.length}
            </span>
          </div>

          <div className="lg-vocab-list custom-scroll">
            {bookmarks.length === 0 ? (
              <p className="lg-vocab-empty">
                Tap any word in a story, then Bookmark — saved words land here.
              </p>
            ) : (
              bookmarks.map((b) => (
                <div className="saved-vocab-card" key={b.id}>
                  <div className="vocab-word-row">
                    <span className="vocab-word-target">{b.word}</span>
                    <span className="vocab-word-translation">
                      {b.note || b.romaji || b.reading || "—"}
                    </span>
                  </div>
                  {b.context && <div className="vocab-context-sentence">{b.context}</div>}
                  <div className="vocab-meta-row">
                    <span>
                      {b.lang} · {b.level.toUpperCase()}
                    </span>
                    <button
                      className="bm-remove"
                      onClick={() => removeBookmark(b.id)}
                      aria-label={`Remove ${b.word}`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="lg-vocab-foot">Saved on this device</div>
        </div>
      )}
    </aside>
  );
}
