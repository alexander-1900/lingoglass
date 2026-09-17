import Link from "next/link";
import { notFound } from "next/navigation";
import { LANGS, LANG_NAMES, Lang } from "@/lib/types";
import { getLevelsForLang } from "@/lib/stories";
import LevelSelector from "@/components/level/LevelSelector";
import PageShell from "@/components/shell/PageShell";
import { IconArrowLeft } from "@/components/ui/icons";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  return params.then(({ lang }) => ({
    title: `${LANG_NAMES[lang as Lang] ?? "Library"}`,
  }));
}

export default async function LibraryLangPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!LANGS.includes(lang as Lang)) notFound();
  const levels = getLevelsForLang(lang as Lang);
  const range = lang === "ja" ? "N5 → N1 · JLPT" : "A1 → C2 · CEFR";

  return (
    <PageShell>
      <div className={`shell lang-${lang}`}>
        <header className="topbar reveal">
          <Link href="/" className="icon-btn" aria-label="Back to languages">
            <IconArrowLeft />
          </Link>
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">❖</span>
            {LANG_NAMES[lang as Lang]}
          </span>
          <span style={{ width: 42 }} aria-hidden="true" />
        </header>

        <section className="page-head">
          <div className="corners reveal d1" aria-hidden="true"><span>Index · 01</span><span>{levels.length} levels</span></div>
          <p className="kicker reveal d1">Catalogue · {LANG_NAMES[lang as Lang]}</p>
          <h1 className="reveal d2">Choose your level</h1>
          <p className="lede reveal d3">
            {range} — stories grow in depth as the levels rise.
          </p>
        </section>

        <LevelSelector lang={lang} levels={levels} />
      </div>
    </PageShell>
  );
}