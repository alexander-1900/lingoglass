// Auth middleware for EVERY /api/admin/* route (all of which have route files,
// so directory middleware semantics apply). Order:
//   1. Origin + Sec-Fetch-Site check on ALL mutations (incl. login) → A05/CSRF
//   2. session required for everything except /api/admin/login (any method —
//      the handler still 405s non-POSTs; exempting the path keeps a uniform
//      public login endpoint)
//   3. CSRF token required on mutations of authed routes
// Exceptions propagate to the root middleware's central ApiError mapping.

import type { Env, AdminData } from "../../_lib/env";
import { ApiError, assertSameOrigin } from "../../_lib/http";
import { loadSession, verifyCsrfToken } from "../../_lib/session";

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data } = context;
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";

  if (mutating) assertSameOrigin(request, env);

  if (pathname !== "/api/admin/login") {
    const now = Math.floor(Date.now() / 1000);
    const session = await loadSession(env, request, now);
    if (!session) throw new ApiError(401, "auth_required", "Authentication required");
    if (mutating) {
      const ok = await verifyCsrfToken(session, request.headers.get("X-CSRF-Token"), now);
      if (!ok) throw new ApiError(403, "csrf", "Invalid or missing CSRF token");
    }
    data.session = session;
  }

  return context.next();
};
