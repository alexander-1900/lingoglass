// POST /api/admin/logout — CSRF-protected (api middleware): revokes the
// session row server-side (a stolen cookie is dead even before expiry) and
// clears the cookie. Always 200 for a valid session, regardless of state.

import type { Env, AdminData } from "../../_lib/env";
import { ApiError, json, methodNotAllowed } from "../../_lib/http";
import { revokeSession, clearSessionCookie } from "../../_lib/session";
import { audit } from "../../_lib/audit";

export const onRequest: PagesFunction<Env, string, AdminData> = async (context) => {
  const { request, env, data } = context;
  if (request.method.toUpperCase() !== "POST") return methodNotAllowed("POST");
  const session = data.session;
  if (!session) throw new ApiError(401, "auth_required", "Authentication required");

  const now = Math.floor(Date.now() / 1000);
  await revokeSession(env, session.id, now);
  await audit(
    env,
    { userId: session.userId, action: "logout", entityType: "session", entityId: session.id },
    now
  );
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
};
