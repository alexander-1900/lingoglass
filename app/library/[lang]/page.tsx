import { notFound } from "next/navigation";
import { LANGS, LANG_NAMES, Lang } from "@/lib/types";
import { getAllStories, getStoriesForLevel } from "@/lib/stories";
import { LEVELS } from "@/lib/types";
import AppShell from "@/components/shell/AppShell";
import LibraryExplorer from "@/components/library/LibraryExplorer";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

// Only es/ru/ja exist — anything else 404s without an on-demand render.
export const dynamicParams = false;

export function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return params.then(({ lang }) => {
    const known = (LANGS as string[]).includes(lang);
    const name = known ? LANG_NAMES[lang as Lang] : "Graded";
    return {
      title: `${name} Graded Stories`,
      description: `Read ${name} stories by level with tap-to-define words and native read-aloud.`,
    };
  });
}

export default async function LibraryLangPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!LANGS.includes(lang as Lang)) notFound();
  const stories = LEVELS[lang as Lang].flatMap((level) =>
    getStoriesForLevel(lang as Lang, level)
  );
  return (
    <AppShell storyCount={getAllStories().length}>
      <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <LibraryExplorer stories={stories} scopeLang={lang as Lang} scopeLevel="all" mode="links" />
      </section>
    </AppShell>
  );
}
