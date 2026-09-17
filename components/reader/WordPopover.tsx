"use client";

import { useEffect } from "react";
import { IconClose, IconSentencePlay } from "../ui/icons";

type PopAlign = "center" | "left" | "right";

interface Props {
  word: string;
  note?: string;
  reading?: string;
  romaji?: string;
  /** Sentence translation — fallback meaning when the word has no gloss. */
  context?: string;
  align?: PopAlign;
  onReplay: () => void;
  onClose: () => void;
}

/**
 * Definition card rendered directly ON TOP of the tapped word (absolutely
 * positioned inside the word wrapper, so it scrolls with the text).
 * Shows the glossary definition, or the sentence translation when the
 * word itself has no gloss — never an empty card.
 */
export default function WordPopover({
  word,
  note,
  reading,
  romaji,
  context,
  align = "center",
  onReplay,
  onClose,
}: Props) {
  // Escape dismisses the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <span
      className={`word-pop word-pop--${align}`}
      role="dialog"
      aria-label={`Definition of ${word}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="word-pop-top">
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
      </span>
      {(reading || romaji) && <span className="wp-reading">{romaji ?? reading}</span>}
      {note ? (
        <span className="wp-meaning">{note}</span>
      ) : context ? (
        <span className="wp-meaning">
          <span className="wp-ctx">Sentence · </span>
          {context}
        </span>
      ) : (
        <span className="wp-meaning">No gloss yet — the English line still helps.</span>
      )}
    </span>
  );
}
