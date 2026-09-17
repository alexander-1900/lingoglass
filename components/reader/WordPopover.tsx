"use client";

import { useEffect } from "react";

type PopAlign = "center" | "left" | "right";

interface Props {
  word: string;
  posPill: string;
  lemma?: string;
  translation: string;
  grammar?: string;
  align?: PopAlign;
  saved: boolean;
  onSave: () => void;
  onSpeak: () => void;
  onClose: () => void;
}

/**
 * Definition card rendered directly ON TOP of the tapped word (absolutely
 * positioned inside the word token, so it scrolls with the text).
 */
export default function WordPopover({
  word,
  posPill,
  lemma,
  translation,
  grammar,
  align = "center",
  saved,
  onSave,
  onSpeak,
  onClose,
}: Props) {
  // Escape dismisses the card (outside clicks are handled by the workspace).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const alignClass = align === "center" ? "" : ` align-${align}`;

  return (
    <span
      className={`word-popover glass-panel-heavy in-word active${alignClass}`}
      role="dialog"
      aria-label={`Definition of ${word}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="popover-header">
        <span className="popover-target-word">{word}</span>
        <span className="popover-pos">{posPill}</span>
      </span>
      {lemma ? <span className="popover-lemma">{lemma}</span> : null}
      <span className="popover-translation">{translation}</span>
      {grammar ? <span className="popover-grammar-notes">{grammar}</span> : null}
      <span className="popover-actions">
        <button className="popover-btn btn-pronounce" onClick={onSpeak} aria-label={`Hear ${word}`} title="Speak native pronunciation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          Speak
        </button>
        <button
          className={`popover-btn btn-save-vocab${saved ? " saved" : ""}`}
          onClick={onSave}
          aria-pressed={saved}
          aria-label={saved ? `${word} saved` : `Bookmark ${word}`}
          title={saved ? "Saved to vocabulary queue" : "Bookmark to vocabulary queue"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {saved ? "Saved" : "Bookmark"}
        </button>
      </span>
      <span className="popover-arrow" aria-hidden="true" />
    </span>
  );
}
