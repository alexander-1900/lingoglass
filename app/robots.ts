import type { MetadataRoute } from "next";
import { SITE_BASE } from "@/lib/site";

// Required by `output: export` (see next.config.mjs) — same as sitemap.ts.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // Same canonical origin as sitemap.xml (SITE_URL, see .env.example).
    sitemap: `${SITE_BASE}/sitemap.xml`,
  };
}
