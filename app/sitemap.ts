import type { MetadataRoute } from "next";
import { LANGS, LEVELS } from "@/lib/types";
import { getAllStories } from "@/lib/stories";

// Set SITE_URL in production (see .env.example) so absolute URLs are correct.
const BASE = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/settings`, changeFrequency: "yearly", priority: 0.3 },
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
