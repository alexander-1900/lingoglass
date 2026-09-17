import Link from "next/link";
import { notFound } from "next/navigation";
import { LANGS, LANG_NAMES, LEVELS, Lang } from "@/lib/types";
import { getStoriesForLevel } from "@/lib/stories";
import { StoryCard } from "@/components/ui/StoryCard";
import PageShell from "@/components/shell/PageShell";
import { IconArrowLeft } from "@/components/ui/icons";

export function generateStaticParams() {
  return LANGS.flatMap((lang) =>
    LEVELS[lang].map((level) => ({ lang, level }))
  );
}

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
    <PageShell>
      <div className={`shell lang-${lang}`}>
        <header className="topbar reveal">
          <Link href={`/library/${lang}`} className="icon-btn" aria-label="Back">
            <IconArrowLeft />
          </Link>
          <span className="brand">
            {LANG_NAMES[lang as Lang]} · {level.toUpperCase()}
          </span>
          <span style={{ width: 42 }} aria-hidden="true" />
        </header>

        <section className="page-head">
          <div className="corners reveal d1" aria-hidden="true"><span>Index · 02</span><span>{stories.length} stories</span></div>
          <p className="kicker reveal d1">
            {LANG_NAMES[lang as Lang]} · {level.toUpperCase()}
          </p>
          <h1 className="reveal d2">The reading list</h1>
          <p className="lede reveal d3">
            {stories.length} {stories.length === 1 ? "story" : "stories"} at this level —
            open one and begin.
          </p>
        </section>

        {stories.length ? (
          <div className="story-list">
            {stories.map((s, i) => (
              <StoryCard key={s.slug} story={s} index={i + 1} />
            ))}
          </div>
        ) : (
          <div className="empty reveal d2">
            No stories at this level yet. Check back soon — or explore{" "}
            <Link href={`/library/${lang}`}>other levels</Link>.
          </div>
        )}
      </div>
    </PageShell>
  );
}
