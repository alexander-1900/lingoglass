// The /admin gate — mounted in functions/_middleware.ts so it runs IN FRONT OF
// STATIC FILES (Cloudflare docs: "If you want to run a middleware on your
// entire application, including in front of static files, create a
// functions/_middleware.js file"). That is load-bearing: public/admin/*.html
// is served by the static layer, and this gate must run before it — a route
// file is never involved for plain asset GETs.
//
// Public (no session): the login page + its assets only. Everything else under
// /admin requires a valid session or the request never reaches an asset.

import type { Env } from "./env";
import { loadSession } from "./session";
import { json, redirect } from "./http";

/** Exactly these paths are reachable without a session. */
const PUBLIC_PATHS = new Set([
  "/admin/login",
  "/admin/login.html",
  "/admin/login.css",
  "/admin/login.js",
]);

/** Returns a Response to short-circuit with, or null to continue to the asset. */
export async function gateAdmin(request: Request, env: Env, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const isPublic = PUBLIC_PATHS.has(path);
  // Always attempt the lookup: an unauthenticated hit costs zero DB reads
  // (no cookie → null before any query); an authenticated visit to the login
  // page must bounce to /admin/ so two sessions are never minted by accident.
  const session = await loadSession(env, request, now);

  if (isPublic) {
    if (session && (path === "/admin/login" || path === "/admin/login.html")) {
      return redirect("/admin/"); // fixed target — no open redirect
    }
    return null;
  }
  if (session) return null;

  const accepts = request.headers.get("Accept") ?? "";
  const wantsHtml =
    (request.method === "GET" || request.method === "HEAD") && accepts.includes("text/html");
  if (wantsHtml) return redirect("/admin/login");
  // Asset/script subrequests and non-GETs get a plain 401.
  return json({ error: "Authentication required" }, 401);
}
