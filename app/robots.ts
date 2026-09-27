import type { MetadataRoute } from "next";
import { SITE_BASE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    // Same canonical origin as sitemap.xml (SITE_URL, see .env.example).
    sitemap: `${SITE_BASE}/sitemap.xml`,
  };
}
