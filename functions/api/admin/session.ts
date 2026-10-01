// GET /api/admin/session — whoami + CSRF bootstrap for the admin UI.
// 401 (via middleware) when no valid session; the client then redirects to
// the login page. Never exposes session ids, hashes, or the csrf_secret.

import type { Env, AdminData } from "../../_lib/env";
import { intVar } from "../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../_lib/http";
import { issueCsrfToken } from "../../_lib/session";

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data } = context;
  if (request.method.toUpperCase() !== "GET") return methodNotAllowed("GET");
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const now = Math.floor(Date.now() / 1000);
  return json({
    username: session.username,
    csrfToken: await issueCsrfToken(session, now),
    expiresAt: session.expiresAt,
    idleMinutes: intVar(env, "ADMIN_IDLE_TTL_MINUTES", 120, 1, 43200),
  });
};
