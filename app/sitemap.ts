import type { MetadataRoute } from "next";
import { LANGS, LEVELS } from "@/lib/types";
import { getAllStories } from "@/lib/stories";
import { SITE_BASE as BASE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!process.env.SITE_URL && process.env.NODE_ENV === "production") {
    console.warn("sitemap: SITE_URL is unset — falling back to http://localhost:3000. Set SITE_URL in production.");
  }
  // /settings is a private preferences page: noindex (see its metadata),
  // so it must not be listed for crawlers here either.
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
  ];
  const library: MetadataRoute.Sitemap = LANGS.flatMap((lang) => [
    { url: `${BASE}/library/${lang}`, changeFrequency: "weekly", priority: 0.8 },
    ...LEVELS[lang].map((level) => ({
      url: `${BASE}/library/${lang}/${level}` as string,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ]);
  const stories: MetadataRoute.Sitemap = getAllStories().map((s) => ({
    url: `${BASE}/story/${s.lang}/${s.level}/${s.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...staticPages, ...library, ...stories];
}
