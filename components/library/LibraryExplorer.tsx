"use client";

import Link from "next/link";
import { useState } from "react";
import { LANG_NAMES, LEVELS, Lang, StoryMeta } from "@/lib/types";
import { StoryCover } from "../ui/StoryCover";

const FLAG: Record<Lang, string> = { es: "🇪🇸", ru: "🇷🇺", ja: "🇯🇵" };
const LANG_CODES: Lang[] = ["es", "ru", "ja"];

interface Props {
  stories: StoryMeta[];
  /** Fixed scope from the route (home passes "all"). */
  scopeLang: Lang | "all";
  scopeLevel: string | "all";
  /** Home filters in place; routes navigate (params preserved). */
  mode: "state" | "links";
}

function levelHref(lang: Lang | "all", level: string): string {
  if (level === "all") return lang === "all" ? "/" : `/library/${lang}`;
  if (lang === "all") return "/";
  return `/library/${lang}/${level}`;
}

function langHref(code: Lang | "all"): string {
  return code === "all" ? "/" : `/library/${code}`;
}

function StoryCardLink({ story }: { story: StoryMeta }) {
  const minutes = Math.max(1, story.minutes || 3);
  return (
    <Link
      href={`/story/${story.lang}/${story.level}/${story.slug}`}
      className="story-card"
    >
      {story.image ? (
        <img className="story-card-cover" src={story.image} alt={story.title} loading="lazy" />
      ) : (
        <StoryCover src={story.image} alt={story.title} lang={story.lang} size="card" />
      )}
      <div className="story-card-body">
        <div className="story-card-top-row">
          <span className="story-card-title">{story.title}</span>
          <span className={`level-badge ${story.level.toUpperCase()}`}>{story.level.toUpperCase()}</span>
        </div>
        <span className="story-card-author">
          {FLAG[story.lang]} {LANG_NAMES[story.lang]}
        </span>
        {story.titleEn && <p className="story-card-desc">{story.titleEn}</p>}
        <div className="story-card-meta">
          <span>{story.sentenceCount} sentences</span>
          <span>·</span>
          <span>~{minutes} min</span>
        </div>
      </div>
    </Link>
  );
}

export default function LibraryExplorer({ stories, scopeLang, scopeLevel, mode }: Props) {
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<Lang | "all">("all");

  // Language-first flow: levels only exist once a language is chosen, and
  // they always come from that language's own scale (CEFR for es/ru, JLPT
  // for ja) — CEFR and N-levels are never shown side-by-side.
  const activeLang = mode === "state" ? langFilter : scopeLang;
  const activeLevel = mode === "state" ? levelFilter : scopeLevel;

  const levels: string[] =
    scopeLevel !== "all"
      ? [scopeLevel]
      : activeLang !== "all"
        ? LEVELS[activeLang as Lang]
        : [];

  const filtered = stories.filter(
    (s) =>
      (activeLevel === "all" || s.level === activeLevel) &&
      (activeLang === "all" || s.lang === activeLang)
  );

  const levelPills =
    levels.length > 0 ? (
      <div className="library-filter-group" role="group" aria-label="Level filter">
        {(["all", ...levels] as string[]).map((lv) =>
          mode === "state" ? (
            <button
              key={lv}
              className={`pill-btn${activeLevel === lv ? " active" : ""}`}
              onClick={() => setLevelFilter(lv)}
            >
              {lv === "all" ? "All Levels" : lv.toUpperCase()}
            </button>
          ) : (
            <Link
              key={lv}
              className={`pill-btn${activeLevel === lv ? " active" : ""}`}
              href={levelHref(scopeLang, lv)}
            >
              {lv === "all" ? "All Levels" : lv.toUpperCase()}
            </Link>
          )
        )}
      </div>
    ) : null;

  const langPills = (
    <div className="library-filter-group" role="group" aria-label="Language filter">
      {(["all", ...LANG_CODES] as (Lang | "all")[]).map((code) =>
        mode === "state" ? (
          <button
            key={code}
            className={`pill-btn lang-pill${activeLang === code ? " active" : ""}`}
            onClick={() => {
              setLangFilter(code);
              // New language → its own level scale; reset the level filter
              // so a stale A1/N3 selection can never empty the grid.
              setLevelFilter("all");
            }}
          >
            <span className="flag">{code === "all" ? "🌐" : FLAG[code]}</span>{" "}
            {code === "all" ? "All Languages" : LANG_NAMES[code]}
          </button>
        ) : (
          <Link
            key={code}
            className={`pill-btn lang-pill${activeLang === code ? " active" : ""}`}
            href={langHref(code)}
          >
            <span className="flag">{code === "all" ? "🌐" : FLAG[code]}</span>{" "}
            {code === "all" ? "All Languages" : LANG_NAMES[code]}
          </Link>
        )
      )}
    </div>
  );

  return (
    <div className="library-view">
      <div className="library-header">
        <div className="library-header-top">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="eyebrow-label">Story Library</span>
            <h3 style={{ fontSize: "1.3rem", fontWeight: 700 }}>Choose something to read</h3>
          </div>
          {levelPills}
        </div>
        {langPills}
        {/* Step 2 prompt: levels appear only after a language is picked */}
        {mode === "state" && activeLang === "all" && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0 }}>
            Pick a language to see its levels — CEFR (A1–C2) for Español/Russian, JLPT (N5–N1) for Japanese.
          </p>
        )}
      </div>
      <div className="library-grid custom-scroll">
        {filtered.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No stories match these filters yet.
          </p>
        ) : (
          filtered.map((s) => <StoryCardLink key={`${s.lang}/${s.level}/${s.slug}`} story={s} />)
        )}
      </div>
    </div>
  );
}
