import { notFound } from "next/navigation";
import { LANGS, LEVELS, Lang } from "@/lib/types";
import { getAllStories, getStoriesForLevel } from "@/lib/stories";
import AppShell from "@/components/shell/AppShell";
import LibraryExplorer from "@/components/library/LibraryExplorer";

export function generateStaticParams() {
  return LANGS.flatMap((lang) =>
    LEVELS[lang].map((level) => ({ lang, level }))
  );
}

// Every lang/level combo is prerendered — anything else 404s without an
// on-demand render.
export const dynamicParams = false;

export default async function LevelPage({
  params,
}: {
  params: Promise<{ lang: string; level: string }>;
}) {
  const { lang, level } = await params;
  if (!LANGS.includes(lang as Lang) || !(LEVELS[lang as Lang] ?? []).includes(level)) {
    notFound();
  }
  const stories = getStoriesForLevel(lang as Lang, level);

  return (
    <AppShell storyCount={getAllStories().length}>
      <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <LibraryExplorer stories={stories} scopeLang={lang as Lang} scopeLevel={level} mode="links" />
      </section>
    </AppShell>
  );
}
