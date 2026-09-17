import Link from "next/link";
import { notFound } from "next/navigation";
import { LANGS, LANG_NAMES, LEVELS, Lang } from "@/lib/types";
import { getAllStoryPaths, getStory } from "@/lib/stories";
import ReaderView from "@/components/reader/ReaderView";
import PageShell from "@/components/shell/PageShell";
import { IconArrowLeft } from "@/components/ui/icons";

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

  return (
    <PageShell>
    <div className={`shell reader-shell lang-${story.lang}`}>
      <header className="topbar reveal">
        <Link href={`/library/${lang}/${level}`} className="icon-btn" aria-label="Back">
          <IconArrowLeft />
        </Link>
        <span className="brand">
          {level.toUpperCase()} · {lang}
        </span>
        <span style={{ width: 42 }} aria-hidden="true" />
      </header>

      <div className="folio reveal d1">
        <div className="corners" aria-hidden="true"><span>Index · 03</span><span>{story.sentences.length} sentences</span></div>
        <div className="folio-head">
          <span>
            <span className="swatch" aria-hidden="true" />
            {LANG_NAMES[story.lang]} · {level.toUpperCase()}
          </span>
          <span>№ {slug.split("-")[0]} · {story.sentences.length} sentences</span>
        </div>
        {/* Key by slug: ReaderView holds playback + token state that must not
            leak from the previously opened story when navigating. */}
        <ReaderView key={story.slug} story={story} />
      </div>
    </div>
    </PageShell>
  );
}

