"use client";

import { useEffect, useRef, useState } from "react";
import { Story, StorySentence, Token } from "@/lib/types";
import type { ParallelMode } from "@/lib/settings";
import { loadVoices, speak } from "@/lib/tts";
import { isJapaneseText, tokenWithRomaji } from "@/lib/furigana-romaji";
import WordPopover from "./WordPopover";
import { IconSentencePlay } from "../ui/icons";

type PopAlign = "center" | "left" | "right";

interface PopState {
  sentIdx: number;
  key: string;
  word: string;
  note: string;
  reading?: string;
  romaji?: string;
  align: PopAlign;
  /** Sentence translation — shown when the word has no glossary note. */
  context: string;
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
  // The definition card is absolutely positioned inside the tapped word, so it
  // scrolls WITH the text — no dismiss-on-scroll needed.

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
    key: string,
    word: string,
    sentence: StorySentence,
    anchorEl: HTMLElement | null,
    extra?: { reading?: string; romaji?: string }
  ) {
    const display = stripPunct(word);
    if (!display.trim()) return;
    // Tapping the open word closes its card.
    if (pop && pop.sentIdx === idx && pop.key === key) {
      setPop(null);
      return;
    }
    onWordTap();
    // Refresh the OS voice list on every tap so the first taps already
    // speak with the right language voice.
    void loadVoices();
    // Keep the card on screen: align to the word, flip the edge near a margin.
    let align: PopAlign = "center";
    if (anchorEl && typeof window !== "undefined") {
      const r = anchorEl.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        if (r.left < 170) align = "left";
        else if (window.innerWidth - r.right < 170) align = "right";
      }
    }
    const note = glossaryLookup(sentence, word) ?? "";
    setPop({
      sentIdx: idx,
      key,
      word: display,
      note,
      reading: extra?.reading,
      romaji: extra?.romaji,
      align,
      context: sentence.en,
    });
    speak(display, story.lang, rate);
    if (isJa && isJapaneseText(sentence.target)) void loadJaTokens(idx, sentence);
  }

  function wordNode(
    idx: number,
    sentence: StorySentence,
    key: string,
    surface: string,
    extra?: { reading?: string; romaji?: string },
    trail?: string
  ) {
    const isOpen = !!pop && pop.sentIdx === idx && pop.key === key;
    const open = (el: HTMLElement) => openWord(idx, key, surface, sentence, el, extra);
    return (
      <span className="word-wrap" key={key}>
        <span
          className="word"
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
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
          {trail}
        </span>
        {isOpen && pop && (
          <WordPopover
            word={pop.word}
            note={pop.note}
            reading={pop.reading}
            romaji={pop.romaji}
            context={pop.context}
            align={pop.align}
            onReplay={() => speak(pop.word, story.lang, rate)}
            onClose={() => setPop(null)}
          />
        )}
      </span>
    );
  }

  return (
    <div className="story-text">
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
                  ? tokens.map((t, ti) =>
                      wordNode(idx, sentence, `t${ti}`, t.surface, {
                        reading: t.reading,
                        romaji: showRomaji ? t.romaji : undefined,
                      }, " ")
                    )
                  : splitWords(sentence.target).map((w, wi) =>
                      isPunctToken(w) ? (
                        <span key={`w${wi}`}>{w}</span>
                      ) : (
                        wordNode(idx, sentence, `w${wi}`, w)
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
