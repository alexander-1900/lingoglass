"use client";

import { useEffect, useState } from "react";
import type { Lang } from "@/lib/types";

const MONO: Record<Lang, string> = { es: "Ñ", ru: "Я", ja: "文" };

interface Props {
  src?: string;
  alt: string;
  lang: Lang;
  size?: "sm" | "lg" | "card";
}

/**
 * Story cover with graceful fallback.
 * Drop a file at `public/images/stories/<slug>.jpg` (or set `image:` in
 * frontmatter) and it appears automatically. Otherwise a branded
 * organic placeholder shows, so empty slots still look designed.
 */
export function StoryCover({ src, alt, lang, size = "sm" }: Props) {
  const [failed, setFailed] = useState(false);
  // A 404 on one story must not condemn later stories to placeholders.
  useEffect(() => setFailed(false), [src]);
  const showImg = src && !failed;

  if (!showImg) {
    return (
      <span className={`story-cover story-cover--placeholder lang-${lang} story-cover--${size}`} aria-hidden="true">
        <span className="story-cover-mono">{MONO[lang] ?? "❦"}</span>
        <span className="story-cover-hint">photo slot</span>
      </span>
    );
  }

  return (
    <span className={`story-cover story-cover--${size}`}>
      {/* plain img keeps zero Next image-config requirements */}
      <img
        src={src}
        alt={alt}
        width={320}
        height={160}
        loading="lazy"
        onError={() => setFailed(true)}
        className="story-cover-img"
      />
    </span>
  );
}
