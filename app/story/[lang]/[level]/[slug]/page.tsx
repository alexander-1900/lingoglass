import { notFound } from "next/navigation";
import { LANGS, Lang } from "@/lib/types";
import { getAllStories, getAllStoryPaths, getStory } from "@/lib/stories";
import { loadJaTokensForStory } from "@/lib/ja-tokens";
import AppShell from "@/components/shell/AppShell";
import ReaderView from "@/components/reader/ReaderView";

export function generateStaticParams() {
  return getAllStoryPaths();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; level: string; slug: string }>;
}) {
  const { lang, level, slug } = await params;
  const story = getStory(lang as Lang, level, slug);
  if (!story) return { title: "Story" };
  return {
    title: `${story.title} (${level.toUpperCase()} ${lang})`,
    description: story.sentences[0]?.en ?? "Read a graded story on lingoglass.",
  };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ lang: string; level: string; slug: string }>;
}) {
  const { lang, level, slug } = await params;
  if (!LANGS.includes(lang as Lang)) notFound();
  const story = getStory(lang as Lang, level, slug);
  if (!story) notFound();

  // Precomputed Sudachi tokens (build artifact) — no runtime tokenizer.
  const jaTokens = story.lang === "ja"
    ? loadJaTokensForStory(story.lang, story.level, story.slug)
    : undefined;

  return (
    <AppShell storyCount={getAllStories().length}>
      <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ReaderView key={story.slug} story={story} jaTokens={jaTokens} />
      </section>
    </AppShell>
  );
}
