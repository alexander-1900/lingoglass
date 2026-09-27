/** Canonical origin for absolute URLs (sitemap.xml, robots.txt).
 *  Set SITE_URL in production — see .env.example. */
export const SITE_BASE = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
