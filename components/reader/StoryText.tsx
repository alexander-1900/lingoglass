"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Story, StorySentence, Token } from "@/lib/types";
import type { ParallelMode } from "@/lib/settings";
import { ensureVoices, speak } from "@/lib/tts";
import { celebrationBurst, ghostFlight, toast } from "@/lib/juice";
import { addBookmark, isBookmarked, useBookmarks } from "@/lib/bookmarks";
import {
  glossaryLookup,
  hasWordChar,
  SEPARATORS,
  stripPunct,
  tokenRange,
  trimmedRange,
} from "@/lib/glossary";
import { tokenWithRomaji } from "@/lib/furigana-romaji";
import { lookupJapaneseDetail } from "@/lib/jmdict";
import type { WordTap } from "@/lib/story-audio";
import {
  affixCandidates,
  nextOccurrence,
  posLabel,
  resolveMeaning,
  tokenRole,
  type AffixCandidate,
  type MeaningSource,
} from "@/lib/ja-morphology";
import WordPopover from "./WordPopover";

type PopAlign = "center" | "left" | "right";

interface PopState {
  sentIdx: number;
  /** 0-based occurrence of this word within its sentence — UI identity only,
   *  so tapping the second 桃 moves the card instead of stacking a second one.
   *  Bookmarks keep storing sentence + word (unchanged). */
  occ: number;
  word: string;
  /** Where that word sits in its sentence — what studio audio speaks. */
  tap: WordTap;
  posPill: string;
  lemma: string;
  translation: string;
  /** "none" = no gloss anywhere: the card says so and shows the sentence as
   *  context instead of passing it off as a definition. */
  meaningSource: MeaningSource;
  /** The tapped sentence + its translation, under the "In this sentence" label. */
  contextTarget: string;
  contextEn: string;
  align: PopAlign;
  /** Above the word normally; below it when the workspace top would clip. */
  vAlign: "above" | "below";
  save: () => void;
  saved: boolean;
  /** Viewport point above the word, for the save celebration burst. */
  bx: number;
  by: number;
}

/** Per-token facts re-captured on every render, so an open card picks up a
 *  fresh lemma/reading/POS when tokens or settings change. */
interface WordExtra {
  reading?: string;
  romaji?: string;
  lemma?: string;
  pos?: string;
  /** Host words rebuilt from split affixes (おじいさん for おじい + さん). */
  affix?: AffixCandidate[];
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
  /** Speak a tapped word with studio audio. Returns true when it played, so the
   *  device voice is skipped instead of talking over it. */
  onWordSpeak?: (tap: WordTap) => boolean;
}

/** Split a sentence into clickable units (words kept, separators kept as
 *  their own tokens for rendering). Shares the SEPARATORS class with gloss
 *  matching and TTS. */
const SPLIT_RE = new RegExp(`([${SEPARATORS}]+)`);
function splitWords(target: string): string[] {
  return target.split(SPLIT_RE).filter(Boolean);
}

// Word-splitting + gloss matching live in lib/glossary.ts (pure + unit-tested).

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
  onWordSpeak,
}: Props) {
  const [pop, setPop] = useState<PopState | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  // Tokens come precomputed from the build (data/ja-tokens.generated.json).
  // Romaji is still derived client-side from the katakana readings.
  // Memoized on the prop (not frozen in useState) so navigating between
  // stories sharing a component instance picks up fresh tokens.
  const jaTokens = useMemo<Record<number, Token[]>>(() => {
    if (!jaTokensProp) return {};
    const out: Record<number, Token[]> = {};
    for (const [k, toks] of Object.entries(jaTokensProp)) {
      out[Number(k)] = toks.map((t: Token) => tokenWithRomaji(t));
    }
    return out;
  }, [jaTokensProp]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const bookmarks = useBookmarks();
  const closeTimer = useRef<number | undefined>(undefined);

  // Smooth dismiss: hide the card first (exit transition), then unmount.
  // The delay must outlast the CSS exit (opacity 0.3s / transform 0.4s) or
  // the card is cut mid-fade — hence 420ms, not the old 220ms.
  function closePop() {
    setPopOpen(false);
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined;
      setPop(null);
    }, 420);
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
    occ: number,
    sentence: StorySentence,
    anchorEl: HTMLElement | null,
    tap: WordTap,
    extra?: WordExtra
  ) {
    const display = stripPunct(word);
    if (!display.trim()) return;
    // Tapping the SAME occurrence closes its card (smoothly). Identity is
    // sentence + stripped word + occurrence ordinal: stable across tokenizer
    // swaps (JA keys re-map from w{n} → t{n}), and the ordinal keeps two 桃 of
    // one sentence apart — tapping the other one MOVES the card instead of
    // closing it. React keys are never part of identity (bug #1).
    if (pop && pop.sentIdx === idx && pop.word === display && pop.occ === occ) {
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
    // Studio audio can speak this exact word (or the phrase it sits in). Called
    // synchronously — still inside the tap's gesture window — and its answer
    // decides whether the device voice speaks on top (Phase 3).
    const spoken = onWordSpeak?.(tap) ?? false;
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
    // (lemma from Sudachi is the dictionary form: 飲みます → 飲む). The lookup
    // also tries kanji-lemma aliases (為る → する) and the host word of a
    // split affix (the tapped さん inside おじいさん → おじいさん).
    const jp =
      story.lang === "ja"
        ? lookupJapaneseDetail(extra?.lemma, display, extra?.affix, extra?.reading)
        : undefined;
    const englishMeaning = jp?.gloss;
    // A missing gloss must NOT fall back to the sentence translation: that
    // printed "A fox saw a crane." as the definition of 狐 on 63% of taps.
    const meaning = resolveMeaning({ note, englishMeaning });
    // Show the key that actually matched — the alias target (為る → する) or
    // the affixed host (おじいさん) — otherwise Sudachi's lemma.
    const matchedLemma = jp && jp.key !== display ? jp.key : extra?.lemma;
    const matchedReading = jp?.via === "affix" && jp.reading ? jp.reading : extra?.reading;
    const lemmaDisplay = [
      matchedLemma && matchedLemma !== display ? matchedLemma : "",
      matchedReading ?? "",
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
    // workspace click — otherwise the unmount timer would kill the
    // card that is about to open.
    cancelPopClose();
    // Real part of speech from Sudachi, prefixed by the reading level (the
    // pill used to show the level alone, e.g. "N4").
    const posLabelText = posLabel(extra?.pos);
    setPop({
      sentIdx: idx,
      occ,
      word: display,
      tap,
      posPill: posLabelText
        ? `${story.level.toUpperCase()} · ${posLabelText}`
        : story.level.toUpperCase(),
      lemma: lemmaDisplay,
      translation: meaning.text,
      meaningSource: meaning.source,
      contextTarget: sentence.target,
      contextEn: sentence.en ?? "",
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
          prev && prev.sentIdx === idx && prev.word === display && prev.occ === occ
            ? { ...prev, saved: result !== "failed" }
            : prev
        );
        // Celebrate only when the word was actually stored — a duplicate or a
        // failed save must not burst confetti or fly a ghost at the badge.
        if (result === "saved" || result === "trimmed") {
          try {
            celebrationBurst(bx, by);
            ghostFlight(display, bx, by);
          } catch {
            /* decoration only — never break the save flow */
          }
        }
        if (result === "failed") {
          toast(
            "Storage Full",
            `Couldn't save '${display}' — remove some old words from the queue.`
          );
        } else if (result === "trimmed") {
          toast(
            "Storage Full",
            `Saved '${display}' — your oldest words were dropped to make room.`
          );
        } else if (result === "duplicate") {
          toast("Already Bookmarked", `'${display}' is already in your review queue!`);
        } else {
          toast("Word Bookmarked", `'${display}' was added to your vocabulary queue.`);
        }
      },
    });
    setPopOpen(true);
    if (!spoken) speak(display, story.lang, rate);
  }

  function toggleReveal(idx: number): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  /** Roving tabindex state for ONE sentence: exactly one word is a Tab stop —
   *  the open word while its card is up, otherwise the first word. Arrows
   *  move focus between words without Tab. `claimed` is set during render as
   *  tokens are emitted left-to-right. */
  interface Rover {
    wantOpen: boolean;
    claimed: boolean;
    /** Occurrence tally for duplicate words in THIS sentence (fresh per
     *  render): the n-th 桃 needs an ordinal to be a distinct tap target. */
    seen: Map<string, number>;
  }

  function wordNode(
    idx: number,
    sentence: StorySentence,
    key: string,
    surface: string,
    rover: Rover,
    range: { start: number; end: number },
    extra?: WordExtra
  ) {
    // Identity = sentence + stripped surface + occurrence ordinal: stable
    // across the w{n} → t{n} re-key when JA tokens arrive (bug #1), and it
    // tells duplicate words apart so only the tapped occurrence owns the
    // card. The extra is re-captured on re-render, so the card picks up a
    // fresh lemma/reading.
    // `isTapped` keeps the card MOUNTED while pop points at this exact
    // occurrence (even after closePop flips popOpen) so the exit transition
    // can play before the 420ms unmount; `isOpen` = fully open (highlight +
    // aria + card visible); `isRepeat` = same word elsewhere, highlight only.
    const clean = stripPunct(surface);
    // Tap range for studio audio: this token's own word characters — the spaces
    // and punctuation around it belong to no audio boundary (see trimmedRange).
    const trim = trimmedRange(surface);
    const tap: WordTap = {
      sentenceIdx: idx,
      charStart: range.start + trim.start,
      charEnd: range.start + trim.end,
      text: clean,
    };
    const occ = nextOccurrence(rover.seen, clean);
    const role = tokenRole(
      pop ? { word: pop.word, sentIdx: pop.sentIdx, occ: pop.occ } : null,
      { word: clean, sentIdx: idx, occ },
      extra?.pos
    );
    const isTapped = role === "tapped";
    const isRepeat = role === "repeat";
    const isOpen = isTapped && popOpen;
    // One Tab stop per sentence (roving tabindex): the tapped word, else the
    // first word. `isTapped` is true for exactly one occurrence, so duplicate
    // words can never add a second Tab stop; others stay mouse-clickable and
    // focus()-able (tabIndex -1).
    const isStop = rover.wantOpen ? isTapped : !rover.claimed;
    if (isStop) rover.claimed = true;
    const open = (el: HTMLElement) => {
      void openWord(idx, surface, occ, sentence, el, tap, extra);
    };
    return (
      // The card is a SIBLING of the token (not a child): a dialog nested
      // inside a role=button is invalid ARIA and breaks focus order (#12).
      // z-index lift stays on while the card plays its exit (matches), so it
      // never paints under sibling tokens mid-transition.
      <span key={key} className={`word-wrap${isTapped ? " has-open" : ""}`}>
        <span
          className={`word-token${isOpen ? " active-word" : ""}${isRepeat ? " repeat-match" : ""}`}
          role="button"
          tabIndex={isStop ? 0 : -1}
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
        {isTapped && pop && (
          <WordPopover
            word={pop.word}
            posPill={pop.posPill}
            lemma={pop.lemma}
            translation={pop.translation}
            meaningSource={pop.meaningSource}
            contextTarget={pop.contextTarget}
            contextEn={pop.contextEn}
            align={pop.align}
            vAlign={pop.vAlign}
            open={popOpen}
            saved={pop.saved}
            onSave={pop.save}
            onSpeak={() => {
              // Stop a running story first: without this the story loop's
              // next kick cancels the word mid-sentence and the card's Speak
              // button appears dead.
              onWordTap();
              // Re-speak the SAME occurrence: studio audio replays just that
              // word (or phrase), otherwise the device voice takes over.
              if (!(onWordSpeak?.(pop.tap) ?? false)) speak(pop.word, story.lang, rate);
            }}
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
        // Fresh per render (StrictMode double-render safe): open word owns
        // the Tab stop while its card is up, else the first word claims it.
        const rover: Rover = { wantOpen: popIsHere && popOpen, claimed: false, seen: new Map() };
        return (
          <div
            key={idx}
            className={`sentence-block${isActive ? " active" : ""}${popIsHere ? " has-open-popover" : ""}${mode === "interactive" && revealed.has(idx) ? " revealed" : ""}`}
            onClick={() => {
              if (mode === "interactive") toggleReveal(idx);
            }}
          >
            <div
              className="target-line"
              onKeyDown={(e) => {
                // Arrow-key nav between words in this sentence (roving
                // tabindex). Delegated here so one handler covers every
                // token; Enter/Space stays on the token itself.
                const k = e.key;
                if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
                // The definition card is inside this line too — its buttons
                // keep their own keyboard behaviour.
                if ((e.target as HTMLElement).closest(".word-popover")) return;
                const words = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(".word-token")
                );
                if (!words.length) return;
                e.preventDefault();
                const cur = words.indexOf(document.activeElement as HTMLElement);
                let next: number;
                if (k === "Home") next = 0;
                else if (k === "End") next = words.length - 1;
                else if (k === "ArrowRight") next = cur === -1 ? 0 : Math.min(words.length - 1, cur + 1);
                else next = cur === -1 ? words.length - 1 : Math.max(0, cur - 1);
                words[next]?.focus();
              }}
            >
              {(() => {
                // Token ORDER is fixed by the build-time token array (or by the
                // separator split), so the array index is a stable React key —
                // it never shifts with which tokens happen to be words.
                // `cursor` walks the sentence text so every token knows its
                // character range — that is what maps a tap onto the audio's own
                // word boundaries (Phase 3), for JA tokens and split words alike.
                let cursor = 0;
                const withRange = (surface: string) => {
                  const range = tokenRange(sentence.target, surface, cursor);
                  cursor = range.end;
                  return range;
                };
                return tokens && tokens.length
                  ? tokens.map((t, ti) => {
                      const range = withRange(t.surface ?? "");
                      if (!t.surface) return null;
                      // Symbol-only tokens (、。「」・！) carry nothing to look up:
                      // render them as plain text, exactly like the ES/RU path.
                      // Making them role="button" chips created dead Tab stops —
                      // 8 JA sentences open with 「, so the one roving Tab stop
                      // of those sentences focused something that did nothing.
                      if (!hasWordChar(t.surface))
                        return <span key={`t${ti}`}>{t.surface}</span>;
                      return wordNode(idx, sentence, `t${ti}`, t.surface, rover, range, {
                        reading: t.reading,
                        romaji: showRomaji ? t.romaji : undefined,
                        lemma: t.lemma,
                        pos: t.pos,
                        affix: affixCandidates(tokens, ti),
                      });
                    })
                  : splitWords(sentence.target).map((w, wi) => {
                      const range = withRange(w);
                      return !hasWordChar(w) ? (
                        <span key={`w${wi}`}>{w}</span>
                      ) : (
                        wordNode(idx, sentence, `w${wi}`, w, rover, range)
                      );
                    });
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
