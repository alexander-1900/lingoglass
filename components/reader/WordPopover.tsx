"use client";

import { useEffect } from "react";
import { IconClose, IconSentencePlay } from "../ui/icons";

interface Props {
  word: string;
  note?: string;
  reading?: string;
  romaji?: string;
  top: number;
  left: number;
  placeAbove: boolean;
  onReplay: () => void;
  onClose: () => void;
}

/**
 * Minimal inline definition card anchored beside the tapped word.
 * Small by design: word, reading, gloss, speaker — never a modal.
 */
export default function WordPopover({
  word,
  note,
  reading,
  romaji,
  top,
  left,
  placeAbove,
  onReplay,
  onClose,
}: Props) {
  // Escape dismisses the card; scrolling/resizing is handled by the parent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`word-pop ${placeAbove ? "word-pop--above" : ""}`}
      style={{ top, left }}
      role="dialog"
      aria-label={`Definition of ${word}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="word-pop-top">
        <span className="wp-word">{word}</span>
        <span className="word-pop-actions">
          <button
            className="word-pop-icon"
            onClick={onReplay}
            aria-label={`Hear ${word}`}
            title="Hear word"
          >
            <IconSentencePlay size={14} />
          </button>
          <button
            className="word-pop-icon"
            onClick={onClose}
            aria-label="Close definition"
            title="Close"
          >
            <IconClose size={14} />
          </button>
        </span>
      </div>
      {(reading || romaji) && <div className="wp-reading">{romaji ?? reading}</div>}
      <div className="wp-meaning">{note || "No gloss yet — the English line still helps."}</div>
    </div>
  );
}
