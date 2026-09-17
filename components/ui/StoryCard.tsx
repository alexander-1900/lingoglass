import Link from "next/link";
import { StoryMeta, LANG_NAMES, Lang } from "@/lib/types";
import { IconArrowRight } from "./icons";
import { StoryCover } from "./StoryCover";

const FLAG: Record<Lang, string> = { es: "🇪🇸", ru: "🇷🇺", ja: "🇯🇵" };

export function StoryCard({
  story,
  progress = 0,
  index = 0,
}: {
  story: StoryMeta;
  progress?: number;
  index?: number;
}) {
  return (
    <Link
      href={`/story/${story.lang}/${story.level}/${story.slug}`}
      className={`story-card reveal lang-${story.lang}`}
    >
      <span className="story-card-img">
        <StoryCover src={story.image} alt={story.title} lang={story.lang} size="card" />
      </span>
      <span className="story-meta">
        <span className="story-card-top-row">
          <span className="story-title">{story.title}</span>
          <span className={`level-badge ${story.level}`}>{story.level.toUpperCase()}</span>
        </span>
        <span className="story-card-author">
          {FLAG[story.lang]} {LANG_NAMES[story.lang]}
          {index > 0 && (
            <span className="story-idx" aria-hidden="true">
              {" "}· № {String(index).padStart(2, "0")}
            </span>
          )}
        </span>
        {story.titleEn && <span className="story-sub">{story.titleEn}</span>}
        <span className="story-foot">
          <span>
            {story.sentenceCount} {story.sentenceCount === 1 ? "sentence" : "sentences"} · {story.minutes} min
          </span>
          <IconArrowRight size={18} />
        </span>
        {progress > 0 && (
          <span className="story-progress">
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
    </Link>
  );
}
