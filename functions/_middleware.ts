// Root middleware — runs for every request routed to Functions (i.e. exactly
// the paths in public/_routes.json: /admin* and /api/admin/*), BEFORE route
// handlers and BEFORE static assets. Responsibilities:
//   1. the /admin session gate (see _lib/gate.ts — static-file rationale),
//   2. uniform security headers on every response Functions produce,
//   3. central error mapping: ApiError → its status/JSON, anything else → a
//      generic 500 with no stack (A05 — no internals leak).

import type { Env, AdminData } from "./_lib/env";
import { ApiError, json, applySecurityHeaders } from "./_lib/http";
import { gateAdmin } from "./_lib/gate";

function finalize(response: Response, pathname: string): Response {
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  applySecurityHeaders(out.headers, pathname);
  return out;
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const pathname = new URL(context.request.url).pathname;
  try {
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const blocked = await gateAdmin(context.request, context.env, Math.floor(Date.now() / 1000));
      if (blocked) return finalize(blocked, pathname);
    }
    const response = await context.next();
    return finalize(response, pathname);
  } catch (err) {
    if (err instanceof ApiError) return finalize(err.toResponse(), pathname);
    // Never echo internals: name + message only, and generic body to clients.
    console.error(
      "[fn] unhandled:",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
    return finalize(json({ error: "Internal error" }, 500), pathname);
  }
};
