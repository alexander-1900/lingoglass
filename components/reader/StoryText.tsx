"use client";

import { useEffect, useRef, useState } from "react";
import { Story, StorySentence, Token } from "@/lib/types";
import type { ParallelMode } from "@/lib/settings";
import { speak } from "@/lib/tts";
import { isJapaneseText, tokenWithRomaji } from "@/lib/furigana-romaji";
import WordPopover from "./WordPopover";
import { IconSentencePlay } from "../ui/icons";

interface PopState {
  word: string;
  note: string;
  reading?: string;
  romaji?: string;
  top: number;
  left: number;
  placeAbove: boolean;
}

interface Props {
  story: Story;
  mode: ParallelMode;
  showRomaji: boolean;
  activeIdx: number;
  highlight: boolean;
  rate: number;
  onWordTap: () => void;
  onPlayFrom: (idx: number) => void;
}

const POP_WIDTH = 300;
const POP_GAP = 10;

/** Split a sentence into clickable units. Japanese uses the Sudachi service (with fallback). */
function splitWords(target: string): string[] {
  return target.split(/([\s.,!?;:«»"()—–…¿¡。、、「」『』・！？〈〉《》‹›-]+)/).filter(Boolean);
}

const PUNCT_CLASS = "[\\s.,!?;:«»\"()—–…¿¡。、、「」『』・！？〈〉《》‹›-]";

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

/** Position a small card beside the tapped word, flipping above when needed. */
function anchorFor(el: HTMLElement): { top: number; left: number; placeAbove: boolean } {
  const fallback = { top: 120, left: 8, placeAbove: false };
  if (typeof window === "undefined") return fallback;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return fallback;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - POP_WIDTH / 2, window.innerWidth - POP_WIDTH - 8));
  const below = r.bottom + POP_GAP;
  const placeAbove = below + 240 > window.innerHeight && r.top > 300;
  return {
    left,
    placeAbove,
    top: placeAbove ? Math.max(8, r.top - POP_GAP) : below,
  };
}

export default function StoryText({
  story,
  mode,
  showRomaji,
  activeIdx,
  highlight,
  rate,
  onWordTap,
  onPlayFrom,
}: Props) {
  const [pop, setPop] = useState<PopState | null>(null);
  const [jaTokens, setJaTokens] = useState<Record<number, Token[]>>({});
  const inFlight = useRef<Set<number>>(new Set());
  const isJa = story.lang === "ja";
  const showTarget = mode !== "english";
  const showEn = mode !== "target";

  // Free-scroll: audio tracking only highlights the active sentence via CSS.
  // No scrollIntoView / observer here so the user can scroll freely during playback.

  // A floating card can't track scrolling — dismiss it instead.
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [pop]);

  async function loadJaTokens(idx: number, sentence: StorySentence) {
    if (jaTokens[idx] || inFlight.current.has(idx)) return;
    inFlight.current.add(idx);
    try {
      const res = await fetch("/api/tokenize-ja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence.target }),
      });
      const data = await res.json();
      const toks = Array.isArray(data.tokens) ? data.tokens : [];
      setJaTokens((prev) =>
        prev[idx]
          ? prev
          : { ...prev, [idx]: toks.map((t: Token) => tokenWithRomaji(t)) }
      );
    } catch {
      // Deliberately not cached: the next tap retries.
    } finally {
      inFlight.current.delete(idx);
    }
  }

  // Japanese has no spaces: tokenize every sentence up front so the text
  // renders correctly on first paint instead of one giant blob that
  // reflows after the first tap.
  useEffect(() => {
    if (story.lang !== "ja") return;
    story.sentences.forEach((sentence, idx) => {
      if (isJapaneseText(sentence.target)) void loadJaTokens(idx, sentence);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.slug]);

  function openWord(
    idx: number,
    word: string,
    sentence: StorySentence,
    anchorEl: HTMLElement | null,
    extra?: { reading?: string; romaji?: string }
  ) {
    const display = word.replace(/[.,!?;:«»"()—–-]/g, "");
    if (!display.trim()) return;
    onWordTap();
    const note = glossaryLookup(sentence, word) ?? "";
    const anchor = anchorEl ? anchorFor(anchorEl) : { top: 120, left: 8, placeAbove: false };
    setPop({
      word: display,
      note,
      reading: extra?.reading,
      romaji: extra?.romaji,
      ...anchor,
    });
    speak(display, story.lang, rate);
    if (isJa && isJapaneseText(sentence.target)) void loadJaTokens(idx, sentence);
  }

  return (
    <div className="story-text">
      {pop && (
        <WordPopover
          word={pop.word}
          note={pop.note}
          reading={pop.reading}
          romaji={pop.romaji}
          top={pop.top}
          left={pop.left}
          placeAbove={pop.placeAbove}
          onReplay={() => speak(pop.word, story.lang, rate)}
          onClose={() => setPop(null)}
        />
      )}
      {story.sentences.map((sentence, idx) => {
        const tokens = jaTokens[idx];
        const isActive = highlight && idx === activeIdx;
        return (
          <p key={idx} className={`sentence ${isActive ? "sentence-active" : ""}`}>
            <button
              className="sentence-play"
              onClick={(e) => {
                e.stopPropagation();
                onPlayFrom(idx);
              }}
              aria-label={`Play sentence ${idx + 1} from here`}
              title={`Play from sentence ${idx + 1}`}
            >
              <IconSentencePlay />
            </button>
            <span className="sentence-body">
              {showTarget &&
                (tokens && tokens.length
                  ? tokens.map((t, ti) => (
                      <span
                        key={ti}
                        className="word"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          openWord(idx, t.surface, sentence, e.currentTarget, {
                            reading: t.reading,
                            romaji: showRomaji ? t.romaji : undefined,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openWord(idx, t.surface, sentence, e.currentTarget as HTMLElement, {
                              reading: t.reading,
                              romaji: showRomaji ? t.romaji : undefined,
                            });
                          }
                        }}
                      >
                        {t.surface}
                        {showRomaji && t.romaji && <span className="romaji">{t.romaji}</span>}{" "}
                      </span>
                    ))
                  : splitWords(sentence.target).map((w, wi) =>
                      isPunctToken(w) ? (
                        <span key={wi}>{w}</span>
                      ) : (
                        <span
                          key={wi}
                          className="word"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            openWord(idx, w, sentence, e.currentTarget);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openWord(idx, w, sentence, e.currentTarget as HTMLElement);
                            }
                          }}
                        >
                          {w}
                        </span>
                      )
                    ))}
              {showEn && sentence.en && <span className="pl-line">{sentence.en}</span>}
            </span>
          </p>
        );
      })}
    </div>
  );
}
