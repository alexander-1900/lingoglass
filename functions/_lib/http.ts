// HTTP plumbing shared by every admin endpoint: uniform JSON errors, a single
// ApiError → Response mapping (handled centrally by the root middleware),
// security headers, origin/CSRF-adjacent request guards, and strict body reads.

import type { Env } from "./env";

/** Thrown anywhere in the chain; root middleware maps it to a clean JSON body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly headers?: Record<string, string>
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }

  toResponse(): Response {
    return json({ error: this.message ?? this.code }, this.status, this.headers);
  }
}

export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function methodNotAllowed(...allowed: string[]): Response {
  return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
}

export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** Admin UI: no inline script/style anywhere, same-origin only. */
export const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

/** API responses must never be rendered as a document (A03 belt). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Security headers for every response that passes through Functions
 * (public static assets keep their existing public/_headers block).
 */
export function applySecurityHeaders(headers: Headers, pathname: string): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cache-Control", "no-store");
  headers.append("Vary", "Cookie");
  if (pathname.startsWith("/api/")) headers.set("Content-Security-Policy", API_CSP);
  else if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    headers.set("Content-Security-Policy", ADMIN_CSP);
  }
}

/**
 * A05/CSRF guard for MUTATING requests: browsers always send Origin on
 * non-GET fetches, so a missing Origin is rejected outright. Allowed origins:
 * the configured site origin AND the request's own origin (local dev runs on
 * http://localhost:8788 where ADMIN_SITE_ORIGIN still names production).
 */
export function assertSameOrigin(request: Request, env: Env): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return;
  const origin = request.headers.get("Origin")?.replace(/\/$/, "");
  if (!origin) {
    throw new ApiError(403, "origin_required", "Missing Origin header");
  }
  const expected = new URL(request.url).origin;
  const configured = env.ADMIN_SITE_ORIGIN?.replace(/\/$/, "");
  if (origin !== expected && origin !== configured) {
    throw new ApiError(403, "origin_mismatch", "Cross-origin request rejected");
  }
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") {
    throw new ApiError(403, "fetch_site", "Cross-origin request rejected");
  }
}

/** Strict JSON body read: content-type + size caps BEFORE parsing. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json");
  }
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "too_large", "Request body too large");
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, "too_large", "Request body too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "Malformed JSON body");
  }
}
