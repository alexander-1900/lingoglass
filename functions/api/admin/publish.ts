// POST /api/admin/publish — site-wide publish: fire the Cloudflare Pages
// deploy hook so the Git-connected project rebuilds, which runs
// `node scripts/sync-content.mjs --build` (prebuild) and republishes content/**
// from D1. Every attempt is journaled in publish_requests ('ci' mode).
//
// Graceful degradation: without the DEPLOY_HOOK_URL secret the endpoint still
// succeeds ({dispatched:false}) — the operator can run `npm run publish`
// locally instead. A failed hook call is journaled ('failed') and surfaced as
// 502 so the UI can retry.
//
// Throttling rides on publish_requests itself (one deploy per MIN_INTERVAL_S):
// no new infra, works across isolates, and the audit trail doubles as the
// rate-limit ledger.
//
// GET  /api/admin/publish — last 10 publish attempts (UI status strip).

import type { Env, AdminData } from "../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../_lib/http";
import { audit } from "../../_lib/audit";

/** Minimum seconds between deploy-hook dispatches. Cloudflare builds take
 *  ~30–60 s; hammering the hook just queues builds that supersede each other. */
const MIN_INTERVAL_S = 60;
const HISTORY_LIMIT = 10;
const HOOK_TIMEOUT_MS = 10_000;

interface PublishRequestRow {
  id: number;
  requested_at: number;
  mode: string;
  status: string;
  detail: string | null;
}

function requestJson(row: PublishRequestRow) {
  return {
    id: row.id,
    requestedAt: row.requested_at,
    mode: row.mode,
    status: row.status,
    detail: row.detail,
  };
}

async function recordRequest(env: Env, userId: number, now: number): Promise<number> {
  const inserted = await env.DB.prepare(
    "INSERT INTO publish_requests (user_id, requested_at, mode, status, detail) " +
      "VALUES (?, ?, 'ci', 'requested', NULL)"
  )
    .bind(userId, now)
    .run();
  return Number(inserted.meta.last_row_id);
}

async function markRequest(env: Env, id: number, status: string, detail: string | null): Promise<void> {
  await env.DB.prepare("UPDATE publish_requests SET status = ?, detail = ? WHERE id = ?")
    .bind(status, detail === null ? null : detail.slice(0, 4000), id)
    .run();
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data } = context;
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");
  const now = Math.floor(Date.now() / 1000);
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const page = await env.DB.prepare(
      "SELECT id, requested_at, mode, status, detail FROM publish_requests " +
        "ORDER BY requested_at DESC, id DESC LIMIT ?"
    )
      .bind(HISTORY_LIMIT)
      .all<PublishRequestRow>();
    return json({ requests: (page.results ?? []).map(requestJson) });
  }

  if (method !== "POST") return methodNotAllowed("GET", "POST");

  // Throttle BEFORE recording: a rejected click is not a publish attempt.
  const last = await env.DB.prepare(
    "SELECT id, requested_at, mode, status, detail FROM publish_requests " +
      "WHERE mode = 'ci' ORDER BY requested_at DESC, id DESC LIMIT 1"
  )
    .first<PublishRequestRow>();
  if (last && now - last.requested_at < MIN_INTERVAL_S) {
    throw new ApiError(
      429,
      "publish_throttled",
      `A site publish was already requested ${now - last.requested_at}s ago — wait ${MIN_INTERVAL_S - (now - last.requested_at)}s`,
      { "Retry-After": String(MIN_INTERVAL_S - (now - last.requested_at)) },
      { lastRequest: requestJson(last) }
    );
  }

  const requestId = await recordRequest(env, session.userId, now);
  await audit(
    env,
    { userId: session.userId, action: "site.publish", entityType: "publish_request", entityId: requestId },
    now
  );

  const hook = env.DEPLOY_HOOK_URL;
  if (!hook) {
    // Not an error: the manual path (npm run publish) still exists. Journaled
    // as 'requested' so the history strip shows why nothing was dispatched.
    await markRequest(env, requestId, "requested", "DEPLOY_HOOK_URL not configured — dispatch manually (npm run publish)");
    const fresh = await env.DB.prepare("SELECT id, requested_at, mode, status, detail FROM publish_requests WHERE id = ?")
      .bind(requestId)
      .first<PublishRequestRow>();
    return json({ ok: true, dispatched: false, request: fresh ? requestJson(fresh) : null });
  }

  let hookStatus = 0;
  let hookDetail = "";
  try {
    const res = await fetch(hook, {
      method: "POST",
      // The hook is a secret URL; send nothing else. redirect:"error" keeps a
      // misconfigured hook (3xx to elsewhere) from silently "succeeding".
      redirect: "error",
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    });
    hookStatus = res.status;
    hookDetail = (await res.text()).slice(0, 500);
  } catch (err) {
    hookDetail = err instanceof Error ? err.message : String(err);
  }

  const ok = hookStatus >= 200 && hookStatus < 300;
  const detail = `HTTP ${hookStatus}${hookDetail ? ` — ${hookDetail}` : ""}`;
  await markRequest(env, requestId, ok ? "dispatched" : "failed", detail);
  if (!ok) {
    // Journal kept; UI shows the failure and can retry once the throttle clears.
    throw new ApiError(502, "deploy_hook_failed", `Deploy hook call failed (${detail})`, undefined, {
      requestId,
    });
  }

  const fresh = await env.DB.prepare("SELECT id, requested_at, mode, status, detail FROM publish_requests WHERE id = ?")
    .bind(requestId)
    .first<PublishRequestRow>();
  return json({ ok: true, dispatched: true, request: fresh ? requestJson(fresh) : null });
};
