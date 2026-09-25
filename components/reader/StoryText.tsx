"use client";

import { useEffect, useRef, useState } from "react";
import { Story, StorySentence, Token } from "@/lib/types";
import type { ParallelMode } from "@/lib/settings";
import { ensureVoices, speak } from "@/lib/tts";
import { celebrationBurst, ghostFlight, toast } from "@/lib/juice";
import { addBookmark, isBookmarked, useBookmarks } from "@/lib/bookmarks";
import { isJapaneseText, tokenWithRomaji } from "@/lib/furigana-romaji";
import { lookupJapaneseMeaning } from "@/lib/jmdict";
import WordPopover from "./WordPopover";

type PopAlign = "center" | "left" | "right";

interface PopState {
  sentIdx: number;
  word: string;
  posPill: string;
  lemma: string;
  translation: string;
  grammar: string;
  align: PopAlign;
  /** Above the word normally; below it when the workspace top would clip. */
  vAlign: "above" | "below";
  save: () => void;
  saved: boolean;
  /** Viewport point above the word, for the save celebration burst. */
  bx: number;
  by: number;
}

interface Props {
  story: Story;
  mode: ParallelMode;
  showRomaji: boolean;
  activeIdx: number;
  highlight: boolean;
  rate: number;
  /** Precomputed Sudachi tokens (raw, romaji added client-side). */
  jaTokens?: Record<number, Token[]>;
  onWordTap: () => void;
}

/** Split a sentence into clickable units. Japanese uses the Sudachi service (with fallback). */
function splitWords(target: string): string[] {
  return target.split(/([\s.,!?;:«»"'’‘“”„()—–…¿¡。、、「」『』・！？〈〉《》‹›-]+)/).filter(Boolean);
}

const PUNCT_CLASS = "[\\s.,!?;:«»\"'’‘“”„()—–…¿¡。、、「」『』・！？〈〉《》‹›-]";

function isPunctToken(w: string): boolean {
  return new RegExp(`^${PUNCT_CLASS}+$`).test(w);
}

function stripPunct(s: string): string {
  return s.replace(new RegExp(PUNCT_CLASS, "g"), "");
}

function glossaryLookup(sentence: StorySentence, word: string): string | undefined {
  const clean = stripPunct(word).toLowerCase();
  if (!clean) return undefined;
  const norm = (s: string) => stripPunct(s).toLowerCase();
  // Exact match first. (The old bidirectional startsWith matched 「в」→「вместе」.)
  const exact = sentence.glossary.find((g) => norm(g.surface) === clean);
  if (exact) return exact.note;
  // Conservative fallback: the word appears inside a multi-word gloss phrase.
  const phrase = sentence.glossary.find((g) =>
    norm(g.surface).split(/\s+/).includes(clean)
  );
  return phrase?.note;
}

/** Tiny pronounce visualizer under the word: three pulsing bars. */
function flashVisualizer(el: HTMLElement): void {
  const wave = document.createElement("span");
  wave.className = "pronounce-visualizer";
  wave.setAttribute("aria-hidden", "true");
  wave.innerHTML = "<span></span><span></span><span></span>";
  el.appendChild(wave);
  window.setTimeout(() => wave.remove(), 1200);
}

export default function StoryText({
  story,
  mode,
  showRomaji,
  activeIdx,
  highlight,
  rate,
  jaTokens: jaTokensProp,
  onWordTap,
}: Props) {
  const [pop, setPop] = useState<PopState | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  // Tokens come precomputed from the build (data/ja-tokens.generated.json —
  // the old /api/tokenize-ja route can't run on serverless hosts). Romaji is
  // still derived client-side from the katakana readings.
  const [jaTokens] = useState<Record<number, Token[]>>(() => {
    if (!jaTokensProp) return {};
    const out: Record<number, Token[]> = {};
    for (const [k, toks] of Object.entries(jaTokensProp)) {
      out[Number(k)] = toks.map((t: Token) => tokenWithRomaji(t));
    }
    return out;
  });
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const bookmarks = useBookmarks();
  const closeTimer = useRef<number | undefined>(undefined);
  const isJa = story.lang === "ja";

  // Smooth dismiss: hide the card first (exit transition), then unmount.
  function closePop() {
    setPopOpen(false);
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined;
      setPop(null);
    }, 220);
  }

  function cancelPopClose() {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  }

  // Clear the pending unmount when the reader unmounts.
  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    },
    []
  );

  // Keep the card's saved state in sync with the store: removing the word
  // from the sidebar while its card is open used to leave a stale
  // "Saved" button until the card was closed and reopened (bug #5).
  useEffect(() => {
    setPop((prev) => {
      if (!prev) return prev;
      const ref = {
        lang: story.lang,
        level: story.level,
        slug: story.slug,
        sentIdx: prev.sentIdx,
        word: prev.word,
      };
      const saved = isBookmarked(bookmarks, ref);
      return saved === prev.saved ? prev : { ...prev, saved };
    });
  }, [bookmarks, story.lang, story.level, story.slug]);

  // Free-scroll: audio tracking only highlights the active sentence via CSS.
  // No scrollIntoView / observer here so the user can scroll freely during playback.
  // The definition card is absolutely positioned inside the tapped word, so it
  // scrolls WITH the text — no dismiss-on-scroll needed.

  async function openWord(
    idx: number,
    word: string,
    sentence: StorySentence,
    anchorEl: HTMLElement | null,
    extra?: { reading?: string; romaji?: string; lemma?: string }
  ) {
    const display = stripPunct(word);
    if (!display.trim()) return;
    // Tapping the open word closes its card (smoothly). Identity is the
    // sentence + stripped word — stable across tokenizer swaps — NOT the
    // React key: JA keys re-map from w{n} to t{n} when Sudachi answers,
    // and keying on the key unmounted an open card mid-read (bug #1).
    if (pop && pop.sentIdx === idx && pop.word === display) {
      if (popOpen) {
        closePop();
      } else {
        // Card is mid-exit — cancel the unmount and reopen instantly.
        cancelPopClose();
        setPopOpen(true);
      }
      return;
    }
    onWordTap();
    // Pick the right language voice BEFORE the first utterance: on a cold
    // start the voice list is still loading, and speaking immediately used
    // the OS default (often English) voice for ES/RU/JA text (bug #2).
    // Cached runs resolve in a microtask; the 800ms cap bounds the worst case.
    await ensureVoices();
    // Keep the card on screen: align to the word, flip the edge near a margin.
    // The workspace scrolls, so a card above a top-row word would be clipped:
    // flip those below the word instead.
    let align: PopAlign = "center";
    let vAlign: "above" | "below" = "above";
    let bx = typeof window !== "undefined" ? window.innerWidth / 2 : 0;
    let by = 200;
    if (anchorEl && typeof window !== "undefined") {
      const r = anchorEl.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        // Edge-aware vs the WORKSPACE (not the window): the 290px card needs ~160px each side to sit centered; near an edge it pins to the inward side so it never clips.
        const ws = anchorEl.closest(".reader-workspace")?.getBoundingClientRect();
        if (ws) {
          const spaceLeft = r.left - ws.left;
          const spaceRight = ws.right - r.right;
          if (spaceLeft >= 160 && spaceRight >= 160) align = "center";
          else align = spaceRight >= spaceLeft ? "left" : "right";
          if (r.top - ws.top < 320) vAlign = "below";
        } else {
          if (r.left < 170) align = "left";
          else if (window.innerWidth - r.right < 170) align = "right";
        }
        bx = r.left + r.width / 2;
        by = r.top;
      }
      flashVisualizer(anchorEl);
    }
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(10);
      } catch {
        /* unsupported — ignore */
      }
    }
    const note = glossaryLookup(sentence, word) ?? "";
    // Japanese words get an English meaning from the local JMdict lookup
    // (lemma from Sudachi is the dictionary form: 飲みます → 飲む).
    const englishMeaning =
      story.lang === "ja" ? lookupJapaneseMeaning(extra?.lemma, display) : undefined;
    const translation = note || englishMeaning || sentence.en || "—";
    const lemmaDisplay = [
      extra?.lemma && extra.lemma !== display ? extra.lemma : "",
      extra?.reading ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    const ref = {
      lang: story.lang,
      level: story.level,
      slug: story.slug,
      sentIdx: idx,
      word: display,
    };
    // Opening a different word cancels any pending dismiss from a recent
    // workspace click — otherwise the 220ms unmount timer would kill the
    // card that is about to open.
    cancelPopClose();
    setPop({
      sentIdx: idx,
      word: display,
      posPill: story.level.toUpperCase(),
      lemma: lemmaDisplay,
      translation,
      grammar: sentence.target,
      align,
      vAlign,
      saved: isBookmarked(bookmarks, ref),
      bx,
      by,
      save: () => {
        const result = addBookmark({
          ...ref,
          note,
          englishMeaning,
          reading: extra?.reading,
          romaji: extra?.romaji,
          context: sentence.target,
          contextEn: sentence.en,
        });
        setPop((prev) =>
          prev && prev.sentIdx === idx && prev.word === display
            ? { ...prev, saved: result !== "failed" }
            : prev
        );
        celebrationBurst(bx, by);
        ghostFlight(display, bx, by);
        if (result === "failed") {
          toast(
            "Storage Full",
            `Couldn't save '${display}' — remove some old words from the queue.`
          );
        } else {
          toast(
            result === "saved" ? "Word Bookmarked" : "Already Bookmarked",
            result === "saved"
              ? `'${display}' was added to your vocabulary queue.`
              : `'${display}' is already in your review queue!`
          );
        }
      },
    });
    setPopOpen(true);
    speak(display, story.lang, rate);
  }

  function toggleReveal(idx: number): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function wordNode(
    idx: number,
    sentence: StorySentence,
    key: string,
    surface: string,
    extra?: { reading?: string; romaji?: string; lemma?: string; refIndex?: number }
  ) {
    // Identity = sentence + stripped surface: stable across the w{n} → t{n}
    // re-key that happens when JA tokens arrive (bug #1). The extra is
    // re-captured on re-render, so the card picks up fresh lemma/reading.
    const isOpen = !!pop && popOpen && pop.sentIdx === idx && pop.word === stripPunct(surface);
    const open = (el: HTMLElement) => {
      void openWord(idx, surface, sentence, el, extra);
    };
    return (
      // The card is a SIBLING of the token (not a child): a dialog nested
      // inside a role=button is invalid ARIA and breaks focus order (#12).
      <span key={key} className={`word-wrap${isOpen ? " has-open" : ""}`}>
        <span
          className={`word-token${isOpen ? " active-word" : ""}`}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`Define ${stripPunct(surface) || surface}`}
          onClick={(e) => {
            e.stopPropagation();
            open(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(e.currentTarget as HTMLElement);
            }
          }}
        >
          {surface}
          {extra?.romaji && showRomaji && <span className="romaji">{extra.romaji}</span>}
        </span>
        {isOpen && pop && (
          <WordPopover
            word={pop.word}
            posPill={pop.posPill}
            lemma={pop.lemma}
            translation={pop.translation}
            grammar={pop.grammar}
            align={pop.align}
            vAlign={pop.vAlign}
            open={popOpen}
            saved={pop.saved}
            onSave={pop.save}
            onSpeak={() => speak(pop.word, story.lang, rate)}
            onClose={closePop}
          />
        )}
      </span>
    );
  }

  return (
    <div
      id="reader-workspace"
      className={`glass-container reader-workspace reading-mode-${mode}`}
      data-lang={story.lang}
      onClick={closePop}
    >
      {story.sentences.map((sentence, idx) => {
        const tokens = jaTokens[idx];
        const isActive = highlight && idx === activeIdx;
        const isRevealed = mode !== "interactive" || revealed.has(idx);
        const popIsHere = !!pop && pop.sentIdx === idx;
        return (
          <div
            key={idx}
            className={`sentence-block${isActive ? " active" : ""}${popIsHere ? " has-open-popover" : ""}${mode === "interactive" && revealed.has(idx) ? " revealed" : ""}`}
            onClick={() => {
              if (mode === "interactive") toggleReveal(idx);
            }}
          >
            <div className="target-line">
              {(() => {
                // Index into the RAW token array (counting empty surfaces)
                // so a word's position — not its rendered slot — is what
                // survives the token list swapping between the regex and
                // Sudachi shapes (bug #1).
                let rawIdx = 0;
                return tokens && tokens.length
                  ? tokens.map((t, ti) => {
                      const refIndex = rawIdx;
                      rawIdx += 1;
                      if (!t.surface) return null;
                      return wordNode(idx, sentence, `t${ti}`, t.surface, {
                        reading: t.reading,
                        romaji: showRomaji ? t.romaji : undefined,
                        lemma: t.lemma,
                        refIndex,
                      });
                    })
                  : splitWords(sentence.target).map((w, wi) =>
                      isPunctToken(w) ? (
                        <span key={`w${wi}`}>{w}</span>
                      ) : (
                        wordNode(idx, sentence, `w${wi}`, w)
                      )
                    );
              })()}
            </div>
            {isRevealed && sentence.en && (
              <div className="translation-line">{sentence.en}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
