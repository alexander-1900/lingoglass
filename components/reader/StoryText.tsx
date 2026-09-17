"use client";

import { useEffect, useRef, useState } from "react";
import { Story, StorySentence, Token } from "@/lib/types";
import type { ParallelMode } from "@/lib/settings";
import { loadVoices, speak } from "@/lib/tts";
import { celebrationBurst, ghostFlight, toast } from "@/lib/juice";
import { addBookmark, isBookmarked, useBookmarks } from "@/lib/bookmarks";
import { isJapaneseText, tokenWithRomaji } from "@/lib/furigana-romaji";
import WordPopover from "./WordPopover";

type PopAlign = "center" | "left" | "right";

interface PopState {
  sentIdx: number;
  key: string;
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
  onWordTap: () => void;
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

/** Tiny pronounce visualizer under the word, like the reference design. */
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
  onWordTap,
}: Props) {
  const [pop, setPop] = useState<PopState | null>(null);
  const [jaTokens, setJaTokens] = useState<Record<number, Token[]>>({});
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const bookmarks = useBookmarks();
  const inFlight = useRef<Set<number>>(new Set());
  const isJa = story.lang === "ja";

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
    // The workspace scrolls, so a card above a top-row word would be clipped:
    // flip those below the word instead.
    let align: PopAlign = "center";
    let vAlign: "above" | "below" = "above";
    let bx = typeof window !== "undefined" ? window.innerWidth / 2 : 0;
    let by = 200;
    if (anchorEl && typeof window !== "undefined") {
      const r = anchorEl.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        if (r.left < 170) align = "left";
        else if (window.innerWidth - r.right < 170) align = "right";
        const ws = anchorEl.closest(".reader-workspace")?.getBoundingClientRect();
        if (ws && r.top - ws.top < 320) vAlign = "below";
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
    const ref = {
      lang: story.lang,
      level: story.level,
      slug: story.slug,
      sentIdx: idx,
      word: display,
    };
    setPop({
      sentIdx: idx,
      key,
      word: display,
      posPill: story.level.toUpperCase(),
      lemma: extra?.reading || extra?.romaji || "",
      translation: note || sentence.en || "—",
      grammar: sentence.target,
      align,
      vAlign,
      saved: isBookmarked(bookmarks, ref),
      bx,
      by,
      save: () => {
        const added = addBookmark({
          ...ref,
          note,
          reading: extra?.reading,
          romaji: extra?.romaji,
          context: sentence.target,
          contextEn: sentence.en,
        });
        setPop((prev) =>
          prev && prev.sentIdx === idx && prev.key === key ? { ...prev, saved: true } : prev
        );
        celebrationBurst(bx, by);
        ghostFlight(display, bx, by);
        toast(
          added ? "Word Bookmarked" : "Already Bookmarked",
          added
            ? `'${display}' was added to your vocabulary queue.`
            : `'${display}' is already in your review queue!`
        );
      },
    });
    speak(display, story.lang, rate);
    if (isJa && isJapaneseText(sentence.target)) void loadJaTokens(idx, sentence);
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
    extra?: { reading?: string; romaji?: string }
  ) {
    const isOpen = !!pop && pop.sentIdx === idx && pop.key === key;
    const open = (el: HTMLElement) => openWord(idx, key, surface, sentence, el, extra);
    return (
      <span
        key={key}
        className="word-token"
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
        {isOpen && pop && (
          <WordPopover
            word={pop.word}
            posPill={pop.posPill}
            lemma={pop.lemma}
            translation={pop.translation}
            grammar={pop.grammar}
            align={pop.align}
            vAlign={pop.vAlign}
            saved={pop.saved}
            onSave={pop.save}
            onSpeak={() => speak(pop.word, story.lang, rate)}
            onClose={() => setPop(null)}
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
      onClick={() => setPop(null)}
    >
      {story.sentences.map((sentence, idx) => {
        const tokens = jaTokens[idx];
        const isActive = highlight && idx === activeIdx;
        const isRevealed = mode !== "interactive" || revealed.has(idx);
        return (
          <div
            key={idx}
            className={`sentence-block${isActive ? " active" : ""}${mode === "interactive" && revealed.has(idx) ? " revealed" : ""}`}
            onClick={() => {
              if (mode === "interactive") toggleReveal(idx);
            }}
          >
            <div className="target-line">
              {tokens && tokens.length
                ? tokens.map((t, ti) =>
                    wordNode(idx, sentence, `t${ti}`, t.surface, {
                      reading: t.reading,
                      romaji: showRomaji ? t.romaji : undefined,
                    })
                  )
                : splitWords(sentence.target).map((w, wi) =>
                    isPunctToken(w) ? (
                      <span key={`w${wi}`}>{w}</span>
                    ) : (
                      wordNode(idx, sentence, `w${wi}`, w)
                    )
                  )}
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
