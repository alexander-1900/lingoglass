import Link from "next/link";
import { IconArrowRight } from "../ui/icons";

interface Props {
  lang: string;
  levels: { level: string; count: number }[];
}

const KIND: Record<string, string> = {
  a1: "beginner",
  a2: "elementary",
  b1: "intermediate",
  b2: "upper-intermediate",
  c1: "advanced",
  c2: "mastery",
  n5: "beginner",
  n4: "elementary",
  n3: "intermediate",
  n2: "advanced",
  n1: "mastery",
};

/** Level picker as a progress ladder, not game badges. */
export default function LevelSelector({ lang, levels }: Props) {
  return (
    <ol className={`ladder lang-${lang}`}>
      {levels.map(({ level, count }, i) => {
        const open = count > 0;
        return (
          <li key={level} className={`rung reveal d${(i % 4) + 1}`}>
            <Link
              href={`/library/${lang}/${level}`}
              className="rung-link"
              aria-disabled={!open}
              aria-label={`${level.toUpperCase()}, ${KIND[level] ?? "graded"} — ${
                open ? `${count} ${count === 1 ? "story" : "stories"}` : "coming soon"
              }`}
            >
              <span className="rung-rail" aria-hidden="true">
                <span className={`rung-dot ${open ? "rung-dot--open" : ""}`} />
              </span>
              <span className="rung-body">
                <span className="rung-top">
                  <span className="level-name">{level.toUpperCase()}</span>
                  <span className="level-kind">{KIND[level] ?? "graded"}</span>
                </span>
                <span className="level-count">
                  {open ? `${count} ${count === 1 ? "story" : "stories"}` : "coming soon"}
                </span>
              </span>
              <IconArrowRight size={18} />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
