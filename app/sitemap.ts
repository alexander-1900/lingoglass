import type { MetadataRoute } from "next";
import { LANGS, LEVELS } from "@/lib/types";
import { getAllStories } from "@/lib/stories";
import { SITE_BASE as BASE } from "@/lib/site";

// Required by `output: export` (see next.config.mjs): metadata routes must
// declare themselves static or the export build fails collecting them.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  // Build-time guard (this route is statically generated): shipping a sitemap
  // full of localhost URLs is a production bug — fail the build instead.
  if (!process.env.SITE_URL && process.env.NODE_ENV === "production") {
    throw new Error(
      "SITE_URL must be set in production (sitemap would otherwise point at http://localhost:3000)."
    );
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
