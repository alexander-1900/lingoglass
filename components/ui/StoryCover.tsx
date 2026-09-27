import type { Lang } from "@/lib/types";

const MONO: Record<Lang, string> = { es: "Ñ", ru: "Я", ja: "文" };

/**
 * Designed placeholder for a story without cover art, so empty slots still
 * look editorial. The actual photo (frontmatter `image:` or
 * `public/images/stories/<slug>.*`) is rendered directly by the library
 * card, which owns its own error fallback.
 */
export function StoryCover({ lang }: { lang: Lang }) {
  return (
    <span
      className={`story-cover story-cover--placeholder lang-${lang} story-cover--card`}
      aria-hidden="true"
    >
      <span className="story-cover-mono">{MONO[lang] ?? "❦"}</span>
      <span className="story-cover-hint">photo slot</span>
    </span>
  );
}
