import { LANGS, LANG_NAMES } from "@/lib/types";
import { getLevelsForLang, getAllStories, getStoriesForLevel } from "@/lib/stories";
import LandingClient from "@/components/landing/LandingClient";

export default function Home() {
  const totals = LANGS.map((lang) => {
    const levels = getLevelsForLang(lang);
    const count = levels.reduce((n, l) => n + l.count, 0);
    return {
      lang,
      name: LANG_NAMES[lang],
      count,
      range: lang === "ja" ? "N5 → N1 · JLPT" : "A1 → C2 · CEFR",
      href: `/library/${lang}`,
    };
  });
  const featured = LANGS.map((lang) => {
    const firstLevel = lang === "ja" ? "n5" : "a1";
    const s = getStoriesForLevel(lang, firstLevel)[0] ?? getAllStories().find((x) => x.lang === lang);
    return s
      ? { ...s }
      : { lang, level: firstLevel, slug: "", title: LANG_NAMES[lang], titleEn: "", minutes: 3, sentenceCount: 8 };
  });
  const all = getAllStories().length;
  return <LandingClient totals={totals} featured={featured} all={all} />;
}
